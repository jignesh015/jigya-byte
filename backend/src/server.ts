import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readConfig, providerRoutes } from './config.ts';
import type { Config } from './config.ts';
import { array, Failure, history, object, snapshot, string } from './contracts/index.ts';
import { Store } from './storage/store.ts';
import { Worker } from './jobs/worker.ts';
import { cloudGenerator } from './providers/cloud.ts';
import { wikipediaRetriever } from './retrieval/wikipedia.ts';

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Failure('request_too_large', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Failure('invalid_json'); }
}
export function createBackend(config: Config, store = new Store(config.database), worker?: Worker) {
  const jobs = worker ?? new Worker(config, store, cloudGenerator(config), wikipediaRetriever(config, store));
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, data: unknown) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') { send(200, { service: 'JigyaByte', protocolVersion: 1, ready: true }); return; }
      const auth = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${config.token}`);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) throw new Failure('unauthorized', 401);
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const routes = providerRoutes(config), uncertain = store.jobs().filter(job => job.state === 'uncertain');
        const freeRetryRoute = (index: number) => routes[index]?.provider === 'gemini' && routes[index].freeConfirmed && !routes[index].paid;
        send(200, { protocolVersion: 1, provider: config.provider, model: config.provider === 'disabled' ? null : config.model,
          contentMode: config.mode, cacheCards: store.cards().length, usage: store.usage(),
          retryUncertainAllowed: uncertain.length ? uncertain.every(job => freeRetryRoute(job.provider_index) && (!job.diagnostics || JSON.parse(job.diagnostics).provider === 'gemini')) : freeRetryRoute(0),
          fallbackChain: routes.map(route => ({ provider: route.provider, model: route.model })),
          openaiFallbackEnabled: config.openaiFallbackEnabled,
          limits: { requests: config.requestLimit, reservedTokens: config.tokenLimit, reservedCost: config.costLimit },
          inventory: { minimum: config.unreadMin, refillAt: config.refillAt, target: config.target, readNonFavoriteLimit: config.readLimit },
          jobs: store.jobs() }); return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/sync') { send(200, store.sync(snapshot(await body(request)), config)); return; }
      const ack = url.pathname.match(/^\/v1\/deliveries\/([a-zA-Z0-9-]+)\/ack$/);
      if (request.method === 'POST' && ack) {
        const b = object(await body(request));
        send(200, store.acknowledge(ack[1], snapshot(b.inventory), array(b.acceptedIds, 10).map(id => string(id)), array(b.rejectedIds, 10).map(id => string(id)))); return;
      }
      const job = url.pathname.match(/^\/v1\/jobs\/([a-zA-Z0-9-]+)$/);
      if (request.method === 'GET' && job) {
        const result = store.job(job[1]);
        if (!result) throw new Failure('job_not_found', 404);
        send(200, result); return;
      }
      const retry = url.pathname.match(/^\/v1\/jobs\/([a-zA-Z0-9-]+)\/retry$/);
      if (request.method === 'POST' && retry) {
        const result = store.job(retry[1]);
        if (!result) throw new Failure('job_not_found', 404);
        // Only an explicit user retry can replace an ambiguous free-tier request.
        // Keep its original reservation; the worker reserves the new attempt separately.
        const selected = providerRoutes(config)[result.provider_index];
        const previousProvider = result.diagnostics ? JSON.parse(result.diagnostics).provider : config.provider;
        const freeUncertain = result.state === 'uncertain' && selected?.provider === 'gemini' && selected.freeConfirmed && !selected.paid && previousProvider === 'gemini';
        if (result.state !== 'failed' && !freeUncertain) throw new Failure('job_cannot_retry', 409);
        const active = store.activeJob(result.device_id);
        if (active && active.id !== result.id) throw new Failure('refill_already_active', 409);
        // Explicit manual retry after fixing a configuration/quota issue. Budgets are not reset.
        store.markJob(result.id, 'queued');
        store.db.prepare("UPDATE jobs SET attempts=0, provider_index=0, diagnostics=NULL, attempt_log='[]' WHERE id=?").run(result.id);
        send(200, { jobId: result.id, state: 'queued' }); return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/history/batches') {
        const b = object(await body(request));
        if (b.protocolVersion !== 1) throw new Failure('unsupported_protocol');
        const deviceId = string(b.deviceId), events = history(b.events);
        store.transaction(() => store.addHistory(deviceId, events));
        send(200, { protocolVersion: 1, acknowledgedEventIds: events.map(e => e.eventId) }); return;
      }
      throw new Failure('not_found', 404);
    } catch (error) {
      // Never echo request text, env values, provider payloads or upstream errors.
      send(error instanceof Failure ? error.status : 500, { error: error instanceof Failure ? error.code : 'internal_error' });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const timer = setInterval(() => { void jobs.tick().catch(() => {}); }, 1000);
  timer.unref();
  return { server, store, worker: jobs, close: async () => {
    jobs.stopped = true; clearInterval(timer);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    // Let an already dispatched request finish before closing SQLite.
    while (jobs.active) await new Promise(r => setTimeout(r, 50));
    store.close();
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readConfig(); const backend = createBackend(config);
    backend.server.listen(config.port, config.host, () => console.log(`JigyaByte backend listening on ${config.host}:${config.port}; provider=${config.provider}`));
    backend.server.on('error', () => { console.error('Backend could not bind its configured address.'); process.exitCode = 1; backend.store.close(); });
    for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { void backend.close(); });
  } catch (e) { console.error(e instanceof Error ? e.message : 'Backend configuration failed'); process.exitCode = 1; }
}
