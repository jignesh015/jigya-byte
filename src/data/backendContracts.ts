import { contentHash, topics } from './cardContent';
export type SourceRef = { id: string; name: string; title: string; url: string; publishedAt: string; retrievedAt: string; dateKind: 'published' | 'observed' };
export type BackendCard = { id: string; schemaVersion: 1; contentHash: string; ideaFingerprint: string; title: string; summary: string; explanation: string;
  primaryTopicId: string; topicIds: string[]; contentMode: 'ai-only'; providerId: string; modelId: string; promptVersion: string; generatedAt: string; sources: SourceRef[] };
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
function validSource(value: unknown): value is SourceRef {
  if (!value || typeof value !== 'object') return false;
  const s = value as SourceRef;
  if (!text(s.id, 160) || !text(s.name, 160) || !text(s.title, 200) || !text(s.url, 2048)
    || !Number.isFinite(Date.parse(s.publishedAt)) || !Number.isFinite(Date.parse(s.retrievedAt))
    || !['published', 'observed'].includes(s.dateKind)) return false;
  try { const u = new URL(s.url); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
    && /^[a-z][a-z0-9.-]*\.[a-z]{2,}$/i.test(u.hostname) && !/(^|\.)(localhost|local|internal|test|invalid)$/i.test(u.hostname); } catch { return false; }
}
export async function validateBackendCard(value: unknown): Promise<BackendCard | null> {
  if (!value || typeof value !== 'object') return null;
  const c = value as BackendCard;
  if (c.schemaVersion !== 1 || !text(c.id, 160) || !text(c.title, 100) || !text(c.summary, 180) || !text(c.explanation, 700)
    || !text(c.providerId, 160) || !text(c.modelId, 160) || !text(c.promptVersion, 30) || !Number.isFinite(Date.parse(c.generatedAt))
    || !topics.some(t => t.id === c.primaryTopicId) || !Array.isArray(c.topicIds) || c.topicIds.length > 10 || !c.topicIds.includes(c.primaryTopicId)
    || c.topicIds.some(id => !topics.some(t => t.id === id)) || c.contentMode !== 'ai-only'
    || !Array.isArray(c.sources) || c.sources.length > 2 || c.sources.some(s => !validSource(s))
    || new Set(c.sources.map(s => s.id)).size !== c.sources.length) return null;
  const hash = await contentHash(normalize(`${c.title}\n${c.summary}\n${c.explanation}`));
  if (hash !== c.contentHash || c.id !== `card-${hash}` || await contentHash(normalize(c.title)) !== c.ideaFingerprint) return null;
  return c;
}
