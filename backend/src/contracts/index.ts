export const TOPICS = ['game-design', 'science', 'history', 'geography', 'space', 'economics', 'psychology', 'technology', 'philosophy', 'biology',
  'literature', 'tech-tips', 'game-industry-stories', 'ai-updates', 'agentic-coding', 'game-industry-news', 'indie-games', 'current-affairs', 'general-knowledge', 'cinema'];
export class Failure extends Error {
  code: string; status: number; retryAfter: number;
  constructor(code: string, status = 400, retryAfter = 0) { super(code); this.code = code; this.status = status; this.retryAfter = retryAfter; }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Failure('invalid_object');
  return value as Record<string, unknown>;
}
export function string(value: unknown, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Failure('invalid_string');
  return value.trim();
}
export function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1e9) throw new Failure('invalid_count');
  return value as number;
}
export function array(value: unknown, max = 2000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Failure('invalid_array');
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new Failure('invalid_boolean'); return value; }
export type Ref = { id: string; contentHash: string; read: boolean; favorite: boolean; ideaFingerprint?: string };
export type History = { eventId: string; id: string; contentHash: string; primaryTopicId: string; seen: boolean; expanded: boolean; ideaFingerprint?: string };
export function history(value: unknown): History[] {
  return array(value).map(raw => {
    const v = object(raw); const primaryTopicId = string(v.primaryTopicId);
    if (!TOPICS.includes(primaryTopicId)) throw new Failure('invalid_topic');
    return { eventId: string(v.eventId), id: string(v.id), contentHash: string(v.contentHash), primaryTopicId,
      seen: bool(v.seen), expanded: bool(v.expanded), ideaFingerprint: v.ideaFingerprint === undefined ? undefined : string(v.ideaFingerprint) };
  });
}
export function snapshot(value: unknown) {
  const v = object(value);
  if (v.protocolVersion !== 1) throw new Failure('unsupported_protocol');
  // Complete snapshots are required in v1; incomplete pages never authorize generation.
  if (v.snapshotComplete !== true) throw new Failure('complete_snapshot_required');
  const c = object(v.counts);
  const counts = { unread: count(c.unread), readNonFavorite: count(c.readNonFavorite), favorites: count(c.favorites) };
  const retainedCards: Ref[] = array(v.retainedCards).map(raw => {
    const r = object(raw);
    return { id: string(r.id), contentHash: string(r.contentHash), read: bool(r.read), favorite: bool(r.favorite),
      ideaFingerprint: r.ideaFingerprint === undefined ? undefined : string(r.ideaFingerprint) };
  });
  if (new Set(retainedCards.map(r => r.id)).size !== retainedCards.length || new Set(retainedCards.map(r => r.contentHash)).size !== retainedCards.length) throw new Failure('duplicate_references');
  if (retainedCards.filter(r => !r.read).length !== counts.unread || retainedCards.filter(r => r.read && !r.favorite).length !== counts.readNonFavorite || retainedCards.filter(r => r.favorite).length !== counts.favorites) throw new Failure('inventory_count_mismatch');
  const interestTopicIds = array(v.interestTopicIds, TOPICS.length).map(t => string(t));
  if (interestTopicIds.some(t => !TOPICS.includes(t))) throw new Failure('invalid_topic');
  return { protocolVersion: 1, deviceId: string(v.deviceId), inventoryVersion: count(v.inventoryVersion), snapshotComplete: true,
    counts, retainedCards, interestTopicIds, historyEvents: history(v.historyEvents ?? []),
    pendingDeliveryIds: array(v.pendingDeliveryIds ?? [], 100).map(id => string(id)) };
}
export type Snapshot = ReturnType<typeof snapshot>;
export type SourceRef = { id: string; name: string; title: string; url: string; publishedAt: string; retrievedAt: string; dateKind: 'published' | 'observed' };
export type Card = { id: string; schemaVersion: 1; contentHash: string; ideaFingerprint: string; title: string; summary: string; explanation: string;
  primaryTopicId: string; topicIds: string[]; contentMode: 'ai-only'; providerId: string; modelId: string;
  promptVersion: string; generatedAt: string; sources: SourceRef[] };
