# What is it?

It is Coco on Nostr. Nip-60/61 are the foundation for Cashu wallets storing its state in the Nostr network. The Cashu wallet Nips are implemented meanwhile in the nostr-dev-kit (ndk) and some applications have Cashu wallet built in. Thus why not implement a coco repository using Nostr as the persistence technology?

## One challenge

The Nostr Cashu wallet Nips don't cover deterministic wallet (NUT-13), this is the most important missing piece in the protocol. Due to this Nostr users face the potential risk of loosing funds at the event of relay failures. This is an unlikely scenario, because users commonly store event on several relays, but it is still possible. Moreover, it is imaginable a mental burden for some users to use their Nostr Cashu wallets extensively.

## Deterministic Cashu Wallet Event

To bridge the gap in the Nips for deterministic wallets and inspired by the still ongoing development in [Satshoot NUT-13 Support](https://github.com/rodant/satshoot/tree/cashu-mnemonic-gen) this module uses the following nostr event to persist the relevant information for deterministic secrets.

```json
{
    "kind": 17376,
    "content": nip44_encrypt({
        "bip39seed": "hexkey",
        "counters": {
            "<normalized-mint1-url>|<keyset=keyset-id-1>": "<counter-1>",
            "<normalized-mint1-url>|<keyset=keyset-id-2>": "<counter-2>",
            "<normalized-mint2-url>|<keyset=keyset-id-3>": "<counter-3>",
        }
    }),
    "tags": []
}
```
The ideas are still work in progress and the Satshoot dev team around Five (npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw) is eager to get feedback on the ideas. Contact us directly here on Github or on Nostr. rodant (npub1w80jzxf36fhwgyfp622m6s7tcl3cy5z7xva4cy75q9kwm92zm8tsclzqjv) is a good contact partner for sending feedback.