import { IndexedDbRepositories } from 'coco-cashu-indexeddb';
import './style.css';
import { ConsoleLogger, getDecodedToken, getEncodedToken, Manager } from 'coco-cashu-core';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { bytesToHex } from '@noble/hashes/utils';
import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { NostrRepositories } from 'coco-cashu-nostr-repo';

declare global {
  interface Window {
    coco: Manager;
    cocoUtils: { getEncodedToken: typeof getEncodedToken; getDecodedToken: typeof getDecodedToken };
    setMnemonic: (mnemonic: string) => void;
    getMnemonic: () => string | null;
  }
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <h1>Coco-Cashu</h1>
    <p class="read-the-docs">
      Open your console and use window.coco to interact with coco-cashu
    </p>
  </div>
`;

let seed: Uint8Array;
const cachedMnemonic = localStorage.getItem('coco-mnemonic');
if (!cachedMnemonic) {
  const newMnemonic = bip39.generateMnemonic(wordlist);
  localStorage.setItem('coco-mnemonic', newMnemonic);
  seed = bip39.mnemonicToSeedSync(newMnemonic);
} else {
  seed = bip39.mnemonicToSeedSync(cachedMnemonic);
}

window.setMnemonic = (mnemonic: string) => {
  localStorage.setItem('coco-mnemonic', mnemonic);
  seed = bip39.mnemonicToSeedSync(mnemonic);
};

window.getMnemonic = () => {
  return localStorage.getItem('coco-mnemonic');
};

const repo = new IndexedDbRepositories({});
await repo.init();

const seedHex = bytesToHex(seed);
const userNsec = "nsec12ym7e30344nd6208v2zjv49h4vtakv7npg7uaqrl58sxz6uneyysa848d5";// Testr2
const signer = new NDKPrivateKeySigner(userNsec);
const ndk = new NDK({
  signer,
  explicitRelayUrls: ["wss://relay.cypherflow.ai/", "wss://nostr.einundzwanzig.space", "wss://nos.lol", "wss://sendit.nosflare.com/"]
});

await ndk.connect();
const user = ndk.activeUser;
console.log(`*** Wallet of user: ${user?.profile?.displayName}, npub: ${user?.npub}, seed: ${seedHex}`);
const nostrRepo = new NostrRepositories(ndk, seedHex);

window.coco = new Manager(nostrRepo, async () => seed, new ConsoleLogger(undefined, { level: 'debug' }));
window.cocoUtils = { getEncodedToken, getDecodedToken };
