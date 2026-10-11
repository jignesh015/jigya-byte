import type { Config } from '../config.ts';
import { providerRoutes } from '../config.ts';
import { Failure, TOPICS } from '../contracts/index.ts';
import { outputSchema, prepare, prompt } from '../preparation/cards.ts';
import { cloudGenerator } from '../providers/cloud.ts';
import type { Generate } from '../providers/cloud.ts';
import type { Store } from '../storage/store.ts';

export class Worker {
  config: Config; store: Store; generate: Generate; active = 0; stopped = false;
  generateFor: (config: Config) => Generate;
  constructor(config: Config, store: Store, generate: Generate, generateFor = cloudGenerator) {
    this.config = config; this.store = store; this.generate = generate;
    this.generateFor = generateFor;
  }
  async tick() {
    if (this.stopped || this.config.provider === 'disabled' || this.active >= this.config.concurrency) return;
    const job = this.store.db.prepare("SELECT * FROM jobs WHERE state='queued' AND next_at<=? ORDER BY rowid LIMIT 1").get(Date.now()) as import('../storage/store.ts').Job | undefined;
    if (!job) return;
    this.active++;
    // Claim before awaiting generation to keep timer invocations single-flight.
    this.store.markJob(job.id, 'running');
    let dispatched = false;
    const routes = providerRoutes(this.config), selected = routes[job.provider_index];
    try {
      if (!selected) throw new Failure('provider_configuration');
      let s = this.store.getSnapshot(job.device_id);
      if (!s || !this.store.isRefilling(job.device_id) || s.counts.unread >= this.config.target || this.store.pending(job.device_id) || this.store.candidates(s).length || this.store.cards().length >= this.config.cacheLimit) {
        this.store.markJob(job.id, 'cancelled'); return;
      }
      let n = Math.min(job.count, this.config.batch, this.config.target - s.counts.unread, this.config.cacheLimit - this.store.cards().length);
      const cached = this.store.cards();
      const availableTopics = TOPICS;
      n = Math.min(n, availableTopics.length);
      const topics = Array.from({ length: n }, (_, i) => {
        // Broad topic rotation; two out of ten supply slots prefer user interests.
        const index = cached.length + i;
        const defaultTopic = availableTopics[index % availableTopics.length];
        const interest = index % 10 >= 7 && index % 10 < 9 && s!.interestTopicIds.length
          ? s!.interestTopicIds[index % s!.interestTopicIds.length] : null;
        return interest && availableTopics.includes(interest) ? interest : defaultTopic;
      });
      // Inventory may have changed while the model request is being prepared.
      s = this.store.getSnapshot(job.device_id);
      if (!s || !this.store.isRefilling(job.device_id) || s.counts.unread >= this.config.target || this.store.pending(job.device_id) || this.store.candidates(s).length) { this.store.markJob(job.id, 'cancelled'); return; }
      n = Math.min(n, this.config.target - s.counts.unread);
      topics.length = n;
      const text = prompt(topics, cached.slice(-15).map(c => c.title));
      if (Buffer.byteLength(text + JSON.stringify(outputSchema)) > this.config.maxInput) throw new Failure('input_budget_exceeded');
      this.store.reserveBudget(job, selected);
      dispatched = true;
      const generate = job.provider_index === 0 ? this.generate : this.generateFor(selected);
      const raw = await generate(text, diagnostic => {
        this.store.db.prepare("UPDATE jobs SET diagnostics=?, attempt_log=json_insert(attempt_log, '$[#]', json(?)) WHERE id=?").run(JSON.stringify(diagnostic), JSON.stringify(diagnostic), job.id);
      });
      const cards = prepare(raw, selected, n);
      const added = this.store.addCards(cards, this.config.cacheLimit);
      if (!added) throw new Failure('duplicate_generation');
      this.store.markJob(job.id, 'completed');
    } catch (error) {
      const code = error instanceof Failure ? error.code : 'preparation_failed';
      const providerFailureCodes = ['quota_exhausted', 'upstream_unavailable', 'upstream_timeout_or_network',
        'provider_configuration', 'provider_credentials_or_access', 'provider_refused_or_incomplete',
        'invalid_provider_output', 'invalid_upstream_json', 'empty_upstream_response', 'upstream_response_too_large'];
      const providerFailure = dispatched && providerFailureCodes.includes(code);
      const retryable = providerFailure;
      const nextRoute = providerFailure && job.provider_index + 1 < routes.length;
      if (retryable && job.attempts < 2 && (!providerFailure || routes.length === 1 || nextRoute)) {
        const wait = Math.max(10000 * 2 ** job.attempts + Math.random() * 1000, error instanceof Failure ? error.retryAfter : 0);
        if (nextRoute) this.store.db.prepare('UPDATE jobs SET provider_index=provider_index+1 WHERE id=?').run(job.id);
        this.store.markJob(job.id, 'queued', code, Date.now() + wait);
      } else {
        this.store.markJob(job.id, code === 'upstream_timeout_or_network' ? 'uncertain' : 'failed', code);
      }
    } finally { this.active--; }
  }
}
