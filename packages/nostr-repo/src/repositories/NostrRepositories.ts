import type {
  Repositories,
  MintRepository,
  KeysetRepository,
  CounterRepository,
  ProofRepository,
  MintQuoteRepository,
  MeltQuoteRepository,
  HistoryRepository,
} from 'coco-cashu-core';
import { MemoryKeysetRepository, MemoryMeltQuoteRepository, MemoryMintQuoteRepository, MemoryMintRepository } from 'coco-cashu-core';
import { NostrCounterRepository } from './NostrCounterRepository';
import { NostrProofRepository } from './NostrProofRepository';
import { NostrHistoryRepository } from './NostrHistoryRepository';
import NDK from '@nostr-dev-kit/ndk';

export class NostrRepositories implements Repositories {
  mintRepository: MintRepository;
  counterRepository: CounterRepository;
  keysetRepository: KeysetRepository;
  proofRepository: ProofRepository;
  mintQuoteRepository: MintQuoteRepository;
  meltQuoteRepository: MeltQuoteRepository;
  historyRepository: HistoryRepository;

  constructor(ndk: NDK, seedHex: string) {
    this.mintRepository = new MemoryMintRepository();
    this.counterRepository = new NostrCounterRepository(ndk, seedHex);
    this.keysetRepository = new MemoryKeysetRepository();
    this.proofRepository = new NostrProofRepository(ndk);
    this.mintQuoteRepository = new MemoryMintQuoteRepository();
    this.meltQuoteRepository = new MemoryMeltQuoteRepository();
    this.historyRepository = new NostrHistoryRepository();
  }
}
