import { contentHash, topics } from './cardContent';
export type BackendCard = { id: string; schemaVersion: 1; contentHash: string; ideaFingerprint: string; title: string; summary: string; explanation: string;
  primaryTopicId: string; topicIds: string[]; contentMode: 'ai-only'; providerId: string; modelId: string; promptVersion: string; generatedAt: string; sources: [] };
export type HistoryEvent = { eventId: string; id: string; contentHash: string; primaryTopicId: string; seen: boolean; expanded: boolean; ideaFingerprint?: string };
export type Inventory = { protocolVersion: 1; deviceId: string; inventoryVersion: number; snapshotComplete: true;
  counts: { unread: number; readNonFavorite: number; favorites: number }; interestTopicIds: string[];
  retainedCards: { id: string; contentHash: string; read: boolean; favorite: boolean; ideaFingerprint?: string }[];
  historyEvents: HistoryEvent[]; pendingDeliveryIds: string[] };
export type DeliveryAck = { acceptedIds: string[]; rejectedIds: string[]; inventory: Inventory };
export type SyncReply = { protocolVersion: 1; deliveryId: string | null; forInventoryVersion: number; cards: unknown[];
  acknowledgedEventIds: string[]; refillJobId: string | null; reportedUnread: number; refillState: string; refillReason?: string | null };
const normalize = (v: string) => v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function text(v: unknown, max: number): v is string { return typeof v === 'string' && v.trim().length > 0 && v.length <= max; }
export async function validateBackendCard(value: unknown): Promise<BackendCard | null> {
  if (!value || typeof value !== 'object') return null;
  const c = value as BackendCard;
  if (c.schemaVersion !== 1 || !text(c.id, 160) || !text(c.title, 100) || !text(c.summary, 180) || !text(c.explanation, 700)
    || !text(c.providerId, 160) || !text(c.modelId, 160) || !text(c.promptVersion, 30) || !Number.isFinite(Date.parse(c.generatedAt))
    || !topics.some(t => t.id === c.primaryTopicId) || !Array.isArray(c.topicIds) || c.topicIds.length > 10 || !c.topicIds.includes(c.primaryTopicId)
    || c.topicIds.some(id => !topics.some(t => t.id === id)) || c.contentMode !== 'ai-only'
    || !Array.isArray(c.sources) || c.sources.length !== 0) return null;
  const hash = await contentHash(normalize(`${c.title}\n${c.summary}\n${c.explanation}`));
  if (hash !== c.contentHash || c.id !== `card-${hash}` || await contentHash(normalize(c.title)) !== c.ideaFingerprint) return null;
  return c;
}
