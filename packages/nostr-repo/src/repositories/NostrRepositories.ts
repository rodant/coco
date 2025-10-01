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

export class NostrRepositories implements Repositories {
  mintRepository: MintRepository;
  counterRepository: CounterRepository;
  keysetRepository: KeysetRepository;
  proofRepository: ProofRepository;
  mintQuoteRepository: MintQuoteRepository;
  meltQuoteRepository: MeltQuoteRepository;
  historyRepository: HistoryRepository;

  constructor() {
    this.mintRepository = new MemoryMintRepository();
    this.counterRepository = new NostrCounterRepository();
    this.keysetRepository = new MemoryKeysetRepository();
    this.proofRepository = new NostrProofRepository();
    this.mintQuoteRepository = new MemoryMintQuoteRepository();
    this.meltQuoteRepository = new MemoryMeltQuoteRepository();
    this.historyRepository = new NostrHistoryRepository();
  }
}
