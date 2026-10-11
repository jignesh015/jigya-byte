import { contentHash, topics } from './cardContent';
export type BackendSource = { id: string; title: string; url: string; attribution: string; license: string; licenseUrl: string; retrievedAt: string; providerId: string };
export type BackendCard = { id: string; schemaVersion: 1; contentHash: string; ideaFingerprint: string; title: string; summary: string; explanation: string;
  primaryTopicId: string; topicIds: string[]; contentMode: 'source-grounded' | 'ai-only'; providerId: string; modelId: string; promptVersion: string; generatedAt: string; sources: BackendSource[] };
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
function https(v: unknown) { try { const u = new URL(v as string); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
export async function validateBackendCard(value: unknown): Promise<BackendCard | null> {
  if (!value || typeof value !== 'object') return null;
  const c = value as BackendCard;
  if (c.schemaVersion !== 1 || !text(c.id, 160) || !text(c.title, 100) || !text(c.summary, 240) || !text(c.explanation, 4000)
    || !text(c.providerId, 160) || !text(c.modelId, 160) || !text(c.promptVersion, 30) || !Number.isFinite(Date.parse(c.generatedAt))
    || !topics.some(t => t.id === c.primaryTopicId) || !Array.isArray(c.topicIds) || c.topicIds.length > 10 || !c.topicIds.includes(c.primaryTopicId)
    || c.topicIds.some(id => !topics.some(t => t.id === id)) || !['source-grounded', 'ai-only'].includes(c.contentMode)
    || !Array.isArray(c.sources) || c.sources.length > 5 || (c.contentMode === 'source-grounded' ? !c.sources.length : c.sources.length > 0)) return null;
  for (const s of c.sources) {
    if (!s || !text(s.id, 160) || !text(s.title, 500) || !https(s.url) || !text(s.attribution, 2000) || !text(s.license, 500)
      || !https(s.licenseUrl) || !text(s.providerId, 160) || !Number.isFinite(Date.parse(s.retrievedAt))) return null;
  }
  const hash = await contentHash(normalize(`${c.title}\n${c.summary}\n${c.explanation}`));
  if (hash !== c.contentHash || c.id !== `card-${hash}` || await contentHash(normalize(c.title)) !== c.ideaFingerprint) return null;
  return c;
}
