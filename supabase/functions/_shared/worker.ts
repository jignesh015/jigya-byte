import { Buffer } from 'node:buffer';
import { randomInt } from 'node:crypto';
import { providerRoutes, generationBatchSize } from '../../../backend/src/config.ts';
import type { Config } from '../../../backend/src/config.ts';
import { Failure, TOPICS } from '../../../backend/src/contracts/index.ts';
import { outputSchema, prepare, prepareBatch, prompt } from '../../../backend/src/preparation/cards.ts';
import { cloudGenerator } from '../../../backend/src/providers/cloud.ts';
import type { Generate, ProviderDiagnostic } from '../../../backend/src/providers/cloud.ts';
import { LiveSources, NEWS_TOPICS } from '../../../backend/src/sources/live.ts';
import { distributedTopics } from '../../../backend/src/preparation/topics.ts';
import type { PostgresStore } from './store.ts';

// One claim and at most one provider call per scheduled invocation. Backoff is durable.
export async function runWorker(config: Config, store: PostgresStore,
  generatorFor: (config: Config) => Generate = cloudGenerator, live = new LiveSources(store)) {
  if (config.provider === 'disabled' || !await store.ready()) return { state: 'disabled' };
  const job = await store.claim();
  if (!job) return { state: 'idle' };
  const routes = providerRoutes(config), selected = routes[job.provider_index];
  let dispatched = false;
  const diagnostics: ProviderDiagnostic[] = [];
  try {
    if (!selected) throw new Failure('provider_configuration');
    await store.expireNews(config.liveSources);
    const needed = async () => {
      const s = await store.getSnapshot(job.device_id);
      return s && await store.isRefilling(job.device_id) && s.counts.unread < config.target
        && !await store.pending(job.device_id) && !(await store.candidates(s, config.liveSources)).length;
    };
    const cached = await store.cards();
    if (!await needed() || cached.length >= config.cacheLimit) {
      await store.finish(job,'cancelled'); return { state:'cancelled' };
    }
    const usage = await store.usage();
    if (usage.requests >= selected.requestLimit || usage.tokens >= selected.tokenLimit) throw new Failure('budget_exhausted');
    const used = await store.usedSourceIds();
    let evidence = config.liveSources ? (await live.collect()).filter(s => !used.has(s.id)) : [];
    await store.db.prepare("INSERT INTO settings VALUES ('last_source_status',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(live.status));
    const available = TOPICS.filter(t => !config.liveSources || !NEWS_TOPICS.includes(t) || evidence.some(s => s.topicIds.includes(t)));
    const count = Math.min(job.count,generationBatchSize(selected),config.cacheLimit-cached.length);
    const topics = distributedTopics(available,count,await store.topicCounts());
    const assigned = new Set<string>();
    evidence = topics.flatMap(topic => {
      const options = evidence.filter(s => s.topicIds.includes(topic) && !assigned.has(s.id));
      if (!options.length || !(NEWS_TOPICS.includes(topic) || ['agentic-coding','indie-games'].includes(topic))) return [];
      const source = options[randomInt(options.length)]; assigned.add(source.id); return [source];
    });
    const excluded = cached.slice(-15).map(c => c.title);
    let text = prompt(topics,excluded,new Date(),evidence);
    const remaining = selected.tokenLimit - (await store.usage()).tokens;
    const bytes = () => Buffer.byteLength(text+JSON.stringify(outputSchema));
    const fits = () => bytes() <= selected.maxInput && remaining-bytes() >= Math.min(selected.maxOutput,topics.length*350+512);
    while (!fits() && topics.length>1) {
      topics.pop(); evidence=evidence.filter(s=>topics.some(t=>s.topicIds.includes(t)));
      text=prompt(topics,excluded,new Date(),evidence);
    }
    if (!fits()) throw new Failure(bytes()>selected.maxInput ? 'input_budget_exceeded' : 'budget_exhausted');
    const maxOutput = Math.min(selected.maxOutput,remaining-bytes());
    const reserved = await store.owned(job,async () => {
      if (!await needed()) return false;
      await store.reserveBudget(job,{...selected,maxOutput},bytes()); return true;
    });
    if (!reserved) { await store.finish(job,'cancelled'); return { state:'cancelled' }; }
    dispatched=true;
    const raw=await generatorFor(selected)(text,d=>diagnostics.push(d),{maxOutputTokens:maxOutput});
    const prepared=config.liveSources ? prepareBatch(raw,selected,topics,evidence)
      : {cards:prepare(raw,selected,topics.length,evidence),rejected:0};
    // Commit generated bodies and job completion together: retries cannot double-insert them.
    await store.owned(job,async () => {
      for (const diagnostic of diagnostics) await store.diagnostic(job,diagnostic);
      const added=await store.addCards(prepared.cards,config.cacheLimit);
      if (!added) throw new Failure('duplicate_generation');
      if (prepared.rejected) {
        const prior=await store.job(job.id);
        await store.db.prepare('UPDATE jobs SET diagnostics=? WHERE id=?').run(JSON.stringify({
          ...JSON.parse(prior?.diagnostics ?? '{}'),preparedCards:prepared.cards.length,rejectedCards:prepared.rejected}),job.id);
      }
      await store.finish(job,'completed');
    });
    return {state:'completed',cards:prepared.cards.length};
  } catch (error) {
    const code=error instanceof Failure ? error.code : 'preparation_failed';
    if (code==='job_lease_lost') return {state:'uncertain'};
    const retryable=dispatched && ['quota_exhausted','upstream_unavailable','upstream_timeout_or_network','provider_configuration'].includes(code);
    const nextRoute=job.provider_index+1<routes.length;
    await store.owned(job,async () => {
      for (const diagnostic of diagnostics) await store.diagnostic(job,diagnostic);
      if (retryable && (nextRoute || (routes.length===1 && job.attempts<2 && code!=='upstream_timeout_or_network'))) {
        const wait=Math.max(10000*2**job.attempts+Math.random()*1000,error instanceof Failure ? error.retryAfter : 0);
        await store.finish(job,'queued',code,Date.now()+wait,nextRoute);
      } else await store.finish(job,code==='upstream_timeout_or_network' ? 'uncertain' : 'failed',code);
    });
    return {state:'degraded',error:code};
  }
}
