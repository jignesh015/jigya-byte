import type { ContentCard, Topic } from './cardContent';

export interface DiscoveryProvider {
  readonly id: string;
  discover(topic: Topic, existingCardIds: ReadonlySet<string>): Promise<ContentCard | null>;
}

export type DiscoveryFailureKind = 'offline' | 'rate-limited' | 'provider';

export class DiscoveryFailure extends Error {
  constructor(readonly kind: DiscoveryFailureKind, message: string) {
    super(message);
    this.name = 'DiscoveryFailure';
  }
}
