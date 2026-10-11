import type { BackendSettings } from './backendConnection';
import type { SyncReply } from './backendContracts';
import { acknowledgeHistory, clearDeliveryOutbox, getDeliveryOutbox, getInventory, importBackendDelivery } from './database';
export type BackendStatus = { state: string; message: string; unread: number; provider?: string; model?: string; contentMode?: string;
  connection: 'disabled' | 'checking' | 'connected' | 'offline'; connectionMessage?: string; lastHandshakeAt?: string };
type BackendServerStatus = { protocolVersion: number; provider: string; model?: string; contentMode: string;
  retryUncertainAllowed?: boolean; jobs?: { id: string; device_id: string; state: string }[] };
type Dependencies = { getInventory: typeof getInventory; getDeliveryOutbox: typeof getDeliveryOutbox; acknowledgeHistory: typeof acknowledgeHistory;
  clearDeliveryOutbox: typeof clearDeliveryOutbox; importBackendDelivery: typeof importBackendDelivery; fetch: typeof fetch };
const defaults: Dependencies = { getInventory, getDeliveryOutbox, acknowledgeHistory, clearDeliveryOutbox, importBackendDelivery, fetch };
export class BackendSync {
  private settings: BackendSettings = { enabled: false, serviceUrl: '', pairingToken: '' };
  private inFlight = false; private pending = false; private active = true; private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private controller: AbortController | undefined; private handshakeController: AbortController | undefined; private generation = 0;
  private handshakePromise: Promise<BackendServerStatus> | null = null;
  private currentStatus: BackendStatus = { state: 'disabled', message: 'Backend connection is optional.', unread: 0, connection: 'disabled' };
  private retryRequested = false;
  private refreshWaiters: (() => void)[] = [];
  private finishRefresh() { for (const resolve of this.refreshWaiters.splice(0)) resolve(); }
  constructor(private readonly update: (status: BackendStatus) => void, private readonly changed: () => Promise<void>, private readonly deps: Dependencies = defaults) {}
  private publish(patch: Partial<BackendStatus>) { this.currentStatus = { ...this.currentStatus, ...patch }; this.update(this.currentStatus); }
  private stopHeartbeat() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
  private startHeartbeat() {
    this.stopHeartbeat();
    if (!this.active || this.settings.pairingToken.length < 32) return;
    void this.handshake().catch(() => {});
    this.heartbeatTimer = setInterval(() => { void this.handshake().catch(() => {}); }, 10_000);
  }
  configure(settings: BackendSettings) {
    this.settings = settings; this.generation++; this.controller?.abort(); this.handshakeController?.abort();
    this.handshakePromise = null;
    if (this.timer) clearTimeout(this.timer);
    if (settings.pairingToken.length >= 32) this.startHeartbeat();
    else { this.stopHeartbeat(); this.publish({ connection: 'disabled', connectionMessage: 'Backend connection is disabled.' }); this.finishRefresh(); }
    this.request();
  }
  foreground(active: boolean) {
    this.active = active;
    if (!active) {
      this.generation++;
      this.controller?.abort(); this.handshakeController?.abort(); this.stopHeartbeat();
      this.handshakePromise = null;
      if (this.timer) clearTimeout(this.timer); this.finishRefresh();
    } else { this.startHeartbeat(); this.request(); }
  }
  dispose() { this.active = false; this.generation++; this.controller?.abort(); this.handshakeController?.abort(); this.stopHeartbeat(); if (this.timer) clearTimeout(this.timer); this.finishRefresh(); }
  refresh(): Promise<void> {
    if (!this.active || !this.settings.enabled) return Promise.resolve();
    const completion = new Promise<void>(resolve => this.refreshWaiters.push(resolve));
    void this.handshake().catch(() => {});
    this.request();
    return completion;
  }
  retry() { this.retryRequested = true; void this.handshake().catch(() => {}); this.request(); }
  handshake(): Promise<BackendServerStatus> {
    if (this.handshakePromise) return this.handshakePromise;
    const promise = this.performHandshake();
    this.handshakePromise = promise;
    void promise.then(() => { if (this.handshakePromise === promise) this.handshakePromise = null; },
      () => { if (this.handshakePromise === promise) this.handshakePromise = null; });
    return promise;
  }
  private async performHandshake(): Promise<BackendServerStatus> {
    if (!this.active || this.settings.pairingToken.length < 32) throw new Error('Backend connection is not configured.');
    const settings = this.settings, generation = this.generation;
    const valid = () => this.active && generation === this.generation;
    const controller = new AbortController(); this.handshakeController = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    this.publish({ connection: 'checking', connectionMessage: 'Checking backend connection…' });
    try {
      const response = await this.deps.fetch(`${settings.serviceUrl}/v1/status`, { method: 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${settings.pairingToken}` } });
      if (!response.ok) throw new Error(response.status === 401 ? 'Pairing failed. Check the backend pairing token.' : 'Backend did not respond to its status check.');
      const text = await response.text();
      if (text.length > 512 * 1024) throw new Error('Backend response exceeds the limit.');
      const status = JSON.parse(text) as BackendServerStatus;
      if (status.protocolVersion !== 1 || typeof status.provider !== 'string') throw new Error('Backend protocol mismatch.');
      if (valid()) this.publish({ connection: 'connected', connectionMessage: 'Authenticated with backend.', lastHandshakeAt: new Date().toISOString(),
        provider: status.provider, model: status.model, contentMode: status.contentMode });
      return status;
    } catch (error) {
      if (valid()) this.publish({ connection: 'offline', connectionMessage: error instanceof Error && /^(Pairing|Backend|Backend protocol)/.test(error.message)
        ? error.message : 'Could not reach the backend.', lastHandshakeAt: new Date().toISOString() });
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.handshakeController === controller) this.handshakeController = undefined;
    }
  }
  request() {
    if (!this.active || !this.settings.enabled) return;
    this.pending = true;
    if (!this.inFlight) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.run(); }, 250); }
  }
  async run(): Promise<void> {
    if (this.inFlight || !this.active || !this.settings.enabled) return;
    this.inFlight = true; this.pending = false;
    const settings = this.settings, generation = this.generation;
    const manualRetry = this.retryRequested; this.retryRequested = false;
    const valid = () => this.active && generation === this.generation;
    const call = async (path: string, payload?: unknown): Promise<unknown> => {
      this.controller = new AbortController();
      const timeout = setTimeout(() => this.controller?.abort(), 15000);
      try {
        const response = await this.deps.fetch(`${settings.serviceUrl}${path}`, { method: payload === undefined ? 'GET' : 'POST', signal: this.controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.pairingToken}` }, body: payload === undefined ? undefined : JSON.stringify(payload) });
        if (!response.ok) throw new Error(response.status === 401 ? 'Pairing failed. Check the backend pairing token.' : response.status === 409 ? 'Inventory changed. Retry synchronization.' : 'Backend unavailable. Saved cards remain readable.');
        const text = await response.text(); if (text.length > 512 * 1024) throw new Error('Backend response exceeds the limit.');
        return JSON.parse(text);
      } finally { clearTimeout(timeout); }
    };
    let unread = 0;
    try {
      unread = (await this.deps.getInventory()).counts.unread;
      const status = await this.handshake();
      if (manualRetry) {
        const inventory = await this.deps.getInventory();
        const failed = status.jobs?.find(job => job.device_id === inventory.deviceId && (job.state === 'failed' || job.state === 'uncertain' && status.retryUncertainAllowed));
        if (failed) await call(`/v1/jobs/${encodeURIComponent(failed.id)}/retry`, {});
      }
      for (let round = 0; round < 20 && valid(); round++) {
        let inventory = await this.deps.getInventory(); unread = inventory.counts.unread;
        // Backfill compact history before any delivery/generation is requested.
        while (inventory.historyEvents.length && valid()) {
          const ids = inventory.historyEvents.map(e => e.eventId);
          const response = await call('/v1/history/batches', { protocolVersion: 1, deviceId: inventory.deviceId, events: inventory.historyEvents }) as { acknowledgedEventIds?: string[] };
          if (!Array.isArray(response.acknowledgedEventIds) || !ids.every(id => response.acknowledgedEventIds!.includes(id))) throw new Error('Backend did not acknowledge history. Retry synchronization.');
          await this.deps.acknowledgeHistory(ids); inventory = await this.deps.getInventory();
        }
        for (const item of await this.deps.getDeliveryOutbox()) {
          if (!valid()) return;
          const fresh = await this.deps.getInventory();
          const result = await call(`/v1/deliveries/${encodeURIComponent(item.id)}/ack`, { ...item.ack, inventory: fresh }) as { acknowledged?: boolean; deliveryId?: string };
          if (result.acknowledged !== true || result.deliveryId !== item.id) throw new Error('Backend did not acknowledge the import. Retry synchronization.');
          await this.deps.clearDeliveryOutbox(item.id);
        }
        if (!valid()) return;
        inventory = await this.deps.getInventory();
        const reply = await call('/v1/sync', inventory) as SyncReply;
        if (!valid()) return;
        if (reply.protocolVersion !== 1 || !Array.isArray(reply.cards) || reply.cards.length > 10 || !Array.isArray(reply.acknowledgedEventIds)) throw new Error('Backend protocol mismatch. Saved cards remain readable.');
        await this.deps.acknowledgeHistory(reply.acknowledgedEventIds.filter(id => inventory.historyEvents.some(e => e.eventId === id)));
        if (reply.cards.length) {
          if (typeof reply.deliveryId !== 'string' || reply.deliveryId.length > 160) throw new Error('Backend delivery has no valid identity.');
          await this.deps.importBackendDelivery(reply.deliveryId, reply.cards);
          await this.changed();
          continue;
        }
        unread = inventory.counts.unread;
        const messages: Record<string,string> = { disabled: 'Backend generation is disabled. Cached reading is available.', quota_exhausted: 'Provider quota reached. Keep reading cached cards.', budget_exhausted: 'Daily generation limit reached. Keep reading cached cards.', degraded: 'Refill needs attention on the backend. Cached reading is available.', pending: 'Preparing more cards…', ready: 'Offline library is up to date.' };
        const timeout = reply.refillReason === 'upstream_timeout_or_network' || reply.refillReason === 'interrupted_request_requires_reconciliation';
        const reasons: Record<string,string> = {
          upstream_unavailable: 'Gemini returned a server error. Retry later; saved cards remain readable.',
          provider_credentials_or_access: 'The provider rejected its credentials or access. Check the backend configuration.',
          provider_configuration: 'The provider rejected the backend request configuration.',
          provider_refused_or_incomplete: 'The provider could not complete this batch. Retry to request another.',
          duplicate_generation: 'The generated batch contained no new ideas. Retry to request another batch.',
        };
        const message = reply.refillState === 'degraded' && timeout
          ? status.retryUncertainAllowed ? 'Gemini request timed out. Tap Retry to request another batch.' : 'Model request outcome is unknown. Refill is paused for reconciliation.'
          : reply.refillState === 'degraded' && reply.refillReason ? reasons[reply.refillReason] ?? messages.degraded : messages[reply.refillState] ?? 'Backend connected.';
        this.publish({ state: reply.refillState, unread, message, provider: status.provider, model: status.model, contentMode: status.contentMode });
        if (reply.refillState === 'pending' && valid()) this.timer = setTimeout(() => { void this.run(); }, 5000);
        return;
      }
      if (valid()) this.timer = setTimeout(() => { void this.run(); }, 5000);
    } catch (error) {
      if (valid()) this.publish({ state: 'offline', unread, message: error instanceof Error && /^(Pairing|Inventory|Backend)/.test(error.message) ? error.message : 'Could not reach the backend. Saved cards remain readable.' });
    } finally {
      this.inFlight = false;
      if (this.pending && valid()) this.request();
      else if (this.pending && this.active && this.settings.enabled) this.request();
      else this.finishRefresh();
    }
  }
}
