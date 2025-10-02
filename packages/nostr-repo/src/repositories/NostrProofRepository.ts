import type { CoreProof, ProofRepository } from "coco-cashu-core";
import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { normalizeMintUrl } from "./utils";

type ProofState = "inflight" | "ready" | "spent";

interface StoredProof extends CoreProof {}

type Nip60Proof = {
  secret: string;
  amount: number;
  C: string;
  id: string;
};

type Nip60TokenDelta = {
  mint: string;
  proofs: Nip60Proof[];
  del?: string[];
};

/**
 * Nostr-backed ProofRepository using NIP-60 token events (kind 7375).
 *
 * Design decisions per user spec:
 * - Encryption: NIP-44 encrypt-to-self (content MUST be encrypted; this implementation provides hook methods that
 *   currently pass-through and should be wired to NDK nip44 helpers in your environment).
 * - Event granularity: one event per mint batch (kind 7375). Each event is an ordinary event (not replaceable).
 * - Tags/indexing: do not use tags. We fetch by author + kind only, decrypt content, then filter by mint.
 * - State transitions:
 *     * saveProofs: publish a delta event containing the new proofs in "token[{mint, proofs}]" and no "del".
 *     * setProofState: "inflight" is local-only. "spent" publishes a delta event with "del" listing secrets to remove.
 *     * deleteProofs: publishes a delta event with "del" listing secrets to remove.
 *   Local cache is updated after successful publish.
 * - NDK wiring: NDK is injected via constructor; relays/signers are managed by the caller.
 * - Caching: no persistent cache; in-memory only. Hydration pulls author-kind events and replays in chronological order.
 */
export class NostrProofRepository implements ProofRepository {
  private readonly ndk: NDK;

  // In-memory store: mintUrl -> secret -> StoredProof
  private proofsByMint: Map<string, Map<string, StoredProof>> = new Map();

  // Simple per-mint mutex to serialize publishes and local mutations
  private mintLocks: Map<string, Promise<void>> = new Map();

  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  constructor(ndk: NDK) {
    this.ndk = ndk;
  }

  // -------------- Public API (ProofRepository) --------------

  async saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void> {
    if (!proofs?.length) return;
    await this.ensureHydrated();

    const normalizedMint = normalizeMintUrl(mintUrl);

    await this.runMintLocked(normalizedMint, async () => {
      const map = this.getMintMap(normalizedMint);

      // Pre-check for collisions against local cache
      for (const p of proofs) {
        if (map.has(p.secret)) {
          throw new Error(`Proof with secret already exists: ${p.secret}`);
        }
      }

      // Build and publish NIP-60 token delta with additions only
      const delta: Nip60TokenDelta = {
        mint: normalizedMint,
        proofs: proofs.map(this.toNip60Proof),
      };

      await this.publishTokenDelta(delta);

      // Update local cache after publish
      for (const p of proofs) {
        map.set(p.secret, {
          ...p,
          mintUrl: normalizedMint,
          state: p.state ?? "ready",
        });
      }
    });
  }

  async getReadyProofs(mintUrl: string): Promise<CoreProof[]> {
    await this.ensureHydrated();
    const normalizedMint = normalizeMintUrl(mintUrl);
    const map = this.getMintMap(normalizedMint);
    return Array.from(map.values())
      .filter((p) => p.state === "ready")
      .map((p) => p as CoreProof);
  }

  async getAllReadyProofs(): Promise<CoreProof[]> {
    await this.ensureHydrated();
    const all: CoreProof[] = [];
    console.log("All Proofs -> \n", this.proofsByMint);
    for (const map of this.proofsByMint.values()) {
      for (const p of map.values()) {
        if (p.state === "ready") {
          all.push(p as CoreProof);
        }
      }
    }
    return all;
  }

  async getProofsByKeysetId(mintUrl: string, keysetId: string): Promise<CoreProof[]> {
    await this.ensureHydrated();
    const normalizedMint = normalizeMintUrl(mintUrl);
    const map = this.getMintMap(normalizedMint);
    const results: CoreProof[] = [];
    for (const p of map.values()) {
      if (p.state === "ready" && p.id === keysetId) {
        results.push(p as CoreProof);
      }
    }
    return results;
  }

  async setProofState(mintUrl: string, secrets: string[], state: ProofState): Promise<void> {
    if (!secrets?.length) return;
    await this.ensureHydrated();

    const normalizedMint = normalizeMintUrl(mintUrl);
    await this.runMintLocked(normalizedMint, async () => {
      const map = this.getMintMap(normalizedMint);

      if (state === "spent") {
        // Gather only secrets present and ready/inflight (if already spent, ignore)
        const existing = secrets.filter((s) => {
          const p = map.get(s);
          return !!p && p.state !== "spent";
        });

        if (!existing.length) return;

        const delta: Nip60TokenDelta = {
          mint: normalizedMint,
          proofs: [], // no additions
          del: existing,
        };

        await this.publishTokenDelta(delta);

        // Mark spent locally and remove from ready set
        for (const s of existing) {
          const p = map.get(s);
          if (!p) continue;
          map.set(s, { ...p, state: "spent" });
          // Depending on desired semantics, we can also delete spent proofs from cache entirely:
          map.delete(s);
        }
        return;
      }

      // inflight/ready are local-only state transitions (no publish)
      for (const s of secrets) {
        const p = map.get(s);
        if (p) map.set(s, { ...p, state });
      }
    });
  }

  async deleteProofs(mintUrl: string, secrets: string[]): Promise<void> {
    if (!secrets?.length) return;
    await this.ensureHydrated();

    const normalizedMint = normalizeMintUrl(mintUrl);
    await this.runMintLocked(normalizedMint, async () => {
      const map = this.getMintMap(normalizedMint);
      const existing = secrets.filter((s) => map.has(s));
      if (!existing.length) return;

      const delta: Nip60TokenDelta = {
        mint: normalizedMint,
        proofs: [], // no additions
        del: existing,
      };

      await this.publishTokenDelta(delta);

      for (const s of existing) map.delete(s);
    });
  }

  async wipeProofsByKeysetId(mintUrl: string, keysetId: string): Promise<void> {
    await this.ensureHydrated();

    const normalizedMint = normalizeMintUrl(mintUrl);
    await this.runMintLocked(normalizedMint, async () => {
      const map = this.getMintMap(normalizedMint);
      const del: string[] = [];
      for (const [secret, p] of Array.from(map.entries())) {
        if (p.id === keysetId) {
          del.push(secret);
        }
      }
      if (!del.length) return;

      const delta: Nip60TokenDelta = {
        mint: normalizedMint,
        proofs: [],
        del,
      };

      await this.publishTokenDelta(delta);

      for (const s of del) map.delete(s);
    });
  }

  // -------------- Hydration (read from Nostr) --------------

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
    // Fetch all token events (kind 7375) authored by us
    const events = await this.ndk.fetchEvents({
      kinds: [7375],
      authors: [authorPubkey],
    });

    // Sort by created_at ascending to replay deltas
    const ordered = Array.from(events.values()).sort((a, b) => {
      const ta = a.created_at || 0;
      const tb = b.created_at || 0;
      return ta - tb;
    });

    for (const ev of ordered) {
      const payload = await this.parseNip60TokenDelta(ev);
      if (!payload) continue;
      
      const normalizedMint = normalizeMintUrl(payload.mint);
      const map = this.getMintMap(normalizedMint);
      for (const proof of payload.proofs) {

        // Apply additions (mark as ready)
        // id/amount/secret/C, others passthrough
        const stored: StoredProof = {
          ...(proof as unknown as StoredProof),
          mintUrl: normalizedMint,
          state: "ready",
        };
        map.set(proof.secret, stored);
        
        // Apply deletions (spent)
        const dels = payload.del || [];
        for (const s of dels) {
          const p = map.get(s);
          if (p) {
            // mark spent then remove from cache
            map.set(s, { ...p, state: "spent" });
            map.delete(s);
          }
        }
      }
    }

    this.hydrated = true;
  }

  // -------------- NIP-60 helpers --------------

  private toNip60Proof(p: CoreProof): Nip60Proof {
    const { state: _state, mintUrl: _mintUrl, ...rest } = p;
    // rest is based on cashu-ts Proof; ensure required fields exist
    return rest as unknown as Nip60Proof;
  }

  private async parseNip60TokenDelta(ev: NDKEvent): Promise<Nip60TokenDelta | null> {
    try {
      await ev.decrypt();
    } catch {
      console.log("Couldn't decrypt token event: \n", ev);
      return null;
    }

    try {
      const parsed = JSON.parse(ev.content) as Nip60TokenDelta;
      if (!parsed.proofs) return null;
      return parsed;
    } catch {
      console.log("Couldn't parse content of token event: \n", ev.content);
      return null;
    }
  }

  private async publishTokenDelta(delta: Nip60TokenDelta): Promise<void> {
    const e = new NDKEvent(this.ndk);
    e.kind = 7375;
    e.content = JSON.stringify(delta);
    e.tags = []; // no tags per spec
    await e.encrypt();
    const id = await e.publish();
    if (!id) {
      throw new Error("Failed to publish NIP-60 token event");
    }
  }

  // -------------- Utilities --------------

  private getMintMap(mintUrl: string): Map<string, StoredProof> {
    if (!this.proofsByMint.has(mintUrl)) {
      this.proofsByMint.set(mintUrl, new Map());
    }
    return this.proofsByMint.get(mintUrl)!;
  }

  private async runMintLocked(mintUrl: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.mintLocks.get(mintUrl) ?? Promise.resolve();
    let release: (value: void | PromiseLike<void>) => void = () => {};
    const next = new Promise<void>((res) => (release = res));
    this.mintLocks.set(
      mintUrl,
      prev.then(async () => {
        try {
          await fn();
        } finally {
          release();
        }
      }),
    );
    await next;
  }

  private async getSignerPubkey(): Promise<string> {
    const signer = this.ndk.signer;
    if (!signer) throw new Error("NDK signer is required for NostrProofRepository");
    const user = await signer.user();
    if (!user?.pubkey) throw new Error("Failed to resolve signer pubkey");
    return user.pubkey;
  }
}
