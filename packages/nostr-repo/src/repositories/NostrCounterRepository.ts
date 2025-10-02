import type { Counter, CounterRepository } from "coco-cashu-core";
import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { normalizeMintUrl } from "./utils";

type SnapshotSchema = {
  bip39seed: string;
  counters: Record<string, string>;
};

/**
 * Nostr-backed CounterRepository
 *
 * Event kind: 17376
 * Content (NIP-44 encrypted to self):
 * {
 *   "bip39seed": "<hex seed>",
 *   "counters": {
 *     "<normalized-mint>|keyset=<keyset-id>": "<counter as string>"
 *   }
 * }
 *
 * Notes:
 * - We append ordinary events (not replaceable). Latest event with matching bip39seed wins.
 * - No tags are used.
 * - Encryption/decryption via NDKEvent.encrypt()/decrypt() assuming ndk has a signer.
 */
export class NostrCounterRepository implements CounterRepository {
  private readonly ndk: NDK;
  private readonly seedHex: string;

  // In-memory view
  private counters = new Map<string, number>();

  // Hydration flags
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  // Serialize publishes
  private publishLock: Promise<void> = Promise.resolve();

  constructor(ndk: NDK, seedHex: string) {
    this.ndk = ndk;
    this.seedHex = seedHex;
  }

  private key(mintUrl: string, keysetId: string): string {
    return `${normalizeMintUrl(mintUrl)}|keyset=${keysetId}`;
  }

  async getCounter(mintUrl: string, keysetId: string): Promise<Counter | null> {
    await this.ensureHydrated();
    const normMint = normalizeMintUrl(mintUrl);
    const k = this.key(normMint, keysetId);
    const val = this.counters.get(k);
    if (val == null) return null;
    return { mintUrl: normMint, keysetId, counter: val };
  }

  async setCounter(mintUrl: string, keysetId: string, counter: number): Promise<void> {
    await this.ensureHydrated();
    const normMint = normalizeMintUrl(mintUrl);
    const k = this.key(normMint, keysetId);
    this.counters.set(k, counter);
    await this.publishSnapshot();
  }

  // ----------------- Hydration -----------------

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydrating) {
      await this.hydrating;
      return;
    }
    this.hydrating = this.hydrateFromNostr();
    await this.hydrating;
  }

  private async hydrateFromNostr(): Promise<void> {
    const authorPubkey = await this.getSignerPubkey();

    const events = await this.ndk.fetchEvents({
      kinds: [17376 as unknown as number],
      authors: [authorPubkey],
    } as any);

    // take the latest snapshot authored by us
    let latest: NDKEvent | undefined;
    for (const ev of events.values()) {
      if (!latest || ((ev.created_at || 0) > (latest.created_at || 0))) latest = ev;
    }

    if (latest) {
      try {
        await latest.decrypt();
      } catch {
        // Decryption failed; treat as empty
      }
      try {
        const parsed = JSON.parse(latest.content) as SnapshotSchema;
        if (parsed?.bip39seed === this.seedHex && parsed.counters && typeof parsed.counters === "object") {
          this.counters.clear();
          for (const [k, v] of Object.entries(parsed.counters)) {
            const num = typeof v === "string" ? parseInt(v, 10) : (v as unknown as number);
            if (Number.isFinite(num)) this.counters.set(k, num);
          }
        }
      } catch {
        // ignore malformed
      }
    }

    this.hydrated = true;
    this.hydrating = null;
  }

  // ----------------- Publishing -----------------

  private serializeCounters(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.counters) obj[k] = String(v);
    return obj;
  }

  private async publishSnapshot(): Promise<void> {
    const run = async () => {
      const e = new NDKEvent(this.ndk);
      e.kind = 17376;
      e.tags = [];
      e.content = JSON.stringify({
        bip39seed: this.seedHex,
        counters: this.serializeCounters(),
      });

      await e.encrypt(); // NIP-44 to self (requires signer)
      const id = await e.publish();
      if (!id) throw new Error("Failed to publish counter snapshot");
    };

    // chain to ensure ordering
    const prev = this.publishLock;
    this.publishLock = prev.then(run, run);
    await this.publishLock;
  }

  // ----------------- Utils -----------------

  private async getSignerPubkey(): Promise<string> {
    const signer = this.ndk.signer;
    if (!signer) throw new Error("NDK signer is required for NostrCounterRepository");
    const user = await signer.user();
    if (!user?.pubkey) throw new Error("Failed to resolve signer pubkey");
    return user.pubkey;
  }
}
