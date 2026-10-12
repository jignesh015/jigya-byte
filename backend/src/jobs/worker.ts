import type { Config } from '../config.ts';
import { providerRoutes, generationBatchSize } from '../config.ts';
import { Failure, TOPICS } from '../contracts/index.ts';
import { outputSchema, prepare, prepareBatch, prompt } from '../preparation/cards.ts';
import { cloudGenerator } from '../providers/cloud.ts';
import type { Generate } from '../providers/cloud.ts';
import type { Store } from '../storage/store.ts';
import { LiveSources, NEWS_TOPICS } from '../sources/live.ts';
import type { Evidence } from '../sources/live.ts';
import { distributedTopics } from '../preparation/topics.ts';
import { randomInt } from 'node:crypto';

export class Worker {
  config: Config; store: Store; generate: Generate; active = 0; stopped = false;
  generateFor: (config: Config) => Generate;
  live: LiveSources;
  constructor(config: Config, store: Store, generate: Generate, generateFor = cloudGenerator, live = new LiveSources(store)) {
    this.config = config; this.store = store; this.generate = generate;
    this.generateFor = generateFor;
    this.live = live;
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
      this.store.expireNews(this.config.liveSources);
      let s = this.store.getSnapshot(job.device_id);
      if (!s || !this.store.isRefilling(job.device_id) || s.counts.unread >= this.config.target || this.store.pending(job.device_id) || this.store.candidates(s, this.config.liveSources).length || this.store.cards().length >= this.config.cacheLimit) {
        this.store.markJob(job.id, 'cancelled'); return;
      }
      // Fill an output-sized batch, even for a small phone deficit; surplus stays in cache.
      let n = Math.min(job.count, generationBatchSize(selected), this.config.cacheLimit - this.store.cards().length);
      const cached = this.store.cards();
      const use = this.store.usage();
      if (use.requests >= selected.requestLimit || use.tokens >= selected.tokenLimit) throw new Failure('budget_exhausted');
      const usedSources = this.store.usedSourceIds();
      let evidence = this.config.liveSources ? (await this.live.collect()).filter(source => !usedSources.has(source.id)) : [];
      const availableTopics = TOPICS.filter(topic => !this.config.liveSources || !NEWS_TOPICS.includes(topic) || evidence.some(source => source.topicIds.includes(topic)));
      const topics = distributedTopics(availableTopics, n, this.store.topicCounts());
      const chosen: Evidence[] = []; const assigned = new Set<string>();
      for (let i = 0; i < topics.length; i++) {
        const options = evidence.filter(source => source.topicIds.includes(topics[i]) && !assigned.has(source.id));
        if (options.length && (NEWS_TOPICS.includes(topics[i]) || topics[i] === 'agentic-coding' || topics[i] === 'indie-games')) {
          const source = options[randomInt(options.length)]; assigned.add(source.id); chosen.push(source);
        } else if (this.config.liveSources && NEWS_TOPICS.includes(topics[i])) {
          topics[i] = distributedTopics(availableTopics.filter(topic => !NEWS_TOPICS.includes(topic)), 1, this.store.topicCounts())[0];
        }
      }
      evidence = chosen;
      // Inventory may have changed while the model request is being prepared.
      s = this.store.getSnapshot(job.device_id);
      if (!s || !this.store.isRefilling(job.device_id) || s.counts.unread >= this.config.target || this.store.pending(job.device_id) || this.store.candidates(s, this.config.liveSources).length) { this.store.markJob(job.id, 'cancelled'); return; }
      const excluded = cached.slice(-15).map(c => c.title);
      let text = prompt(topics, excluded, new Date(), evidence);
      const remainingTokens = selected.tokenLimit - this.store.usage().tokens;
      const bytes = () => Buffer.byteLength(text + JSON.stringify(outputSchema));
      const fits = () => bytes() <= selected.maxInput && remainingTokens - bytes() >= Math.min(selected.maxOutput, topics.length * 350 + 512);
      while (!fits() && topics.length > 1) {
        topics.pop(); evidence = evidence.filter(source => topics.some(topic => source.topicIds.includes(topic)));
        text = prompt(topics, excluded, new Date(), evidence);
      }
      n = topics.length;
      const inputBytes = bytes();
      if (!fits()) throw new Failure(inputBytes > selected.maxInput ? 'input_budget_exceeded' : 'budget_exhausted');
      const outputBudget = Math.min(selected.maxOutput, remainingTokens - inputBytes);
      this.store.reserveBudget(job, { ...selected, maxOutput: outputBudget }, inputBytes);
      dispatched = true;
      const generate = job.provider_index === 0 ? this.generate : this.generateFor(selected);
      const raw = await generate(text, diagnostic => {
        this.store.db.prepare("UPDATE jobs SET diagnostics=?, attempt_log=json_insert(attempt_log, '$[#]', json(?)) WHERE id=?").run(JSON.stringify(diagnostic), JSON.stringify(diagnostic), job.id);
      }, { maxOutputTokens: outputBudget });
      const prepared = this.config.liveSources ? prepareBatch(raw, selected, topics, evidence)
        : { cards: prepare(raw, selected, n, evidence), rejected: 0 };
      const cards = prepared.cards;
      if (prepared.rejected) {
        const row = this.store.db.prepare('SELECT diagnostics FROM jobs WHERE id=?').get(job.id) as { diagnostics: string | null };
        this.store.db.prepare('UPDATE jobs SET diagnostics=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.diagnostics ?? '{}'), preparedCards: cards.length, rejectedCards: prepared.rejected }), job.id);
      }
      const added = this.store.addCards(cards, this.config.cacheLimit);
      if (!added) throw new Failure('duplicate_generation');
      this.store.markJob(job.id, 'completed');
    } catch (error) {
      const code = error instanceof Failure ? error.code : 'preparation_failed';
      // Bad output and incomplete responses must not burn more requests automatically.
      const providerFailureCodes = ['quota_exhausted', 'upstream_unavailable', 'upstream_timeout_or_network', 'provider_configuration'];
      const providerFailure = dispatched && providerFailureCodes.includes(code);
      const ambiguous = code === 'upstream_timeout_or_network';
      const retryable = providerFailure && (!ambiguous || job.provider_index + 1 < routes.length);
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
