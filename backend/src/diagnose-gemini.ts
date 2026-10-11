import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readConfig } from './config.ts';
import { Store } from './storage/store.ts';
import { Failure, TOPICS } from './contracts/index.ts';
import { cloudGenerator } from './providers/cloud.ts';
import type { ProviderDiagnostic } from './providers/cloud.ts';
import { outputSchema, prepare, prompt } from './preparation/cards.ts';
import type { Reference } from './retrieval/wikipedia.ts';

// One bounded real preparation request, never an automatic retry loop.
// Hold the backend port so this cannot race the running service or its worker.
const config = readConfig();
if (config.provider !== 'gemini' || !config.freeConfirmed || config.paid) throw new Error('Diagnostic requires confirmed free Gemini with paid calls disabled.');
const guard = createServer();
await new Promise<void>((resolve, reject) => {
  guard.once('error', () => reject(new Error('Stop the backend before running diagnose:gemini.')));
  guard.listen(config.port, config.host, resolve);
});
let store: Store | undefined;
try {
  store = new Store(config.database);
  const references = (store.db.prepare('SELECT body FROM sources').all() as { body: string }[]).map(r => JSON.parse(r.body) as Reference);
  if (config.mode !== 'source-grounded' || !references.length) throw new Error('Diagnostic requires already fetched, licensed sources.');
  const topics = TOPICS.slice(0, config.batch);
  const text = prompt(topics, references.map(r => ({ ...r, excerpt: r.excerpt.slice(0, 800) })), store.cards().slice(-15).map(c => c.title));
  if (Buffer.byteLength(text + JSON.stringify(outputSchema)) > config.maxInput) throw new Error('Diagnostic input exceeds the configured budget.');
  const id = store.queue(`gemini-diagnostic-${randomUUID()}`, topics.length);
  let diagnostic: ProviderDiagnostic | undefined;
  try {
    store.reserveBudget(store.job(id)!, config);
    const raw = await cloudGenerator(config)(text, value => {
      diagnostic = value;
      store!.db.prepare('UPDATE jobs SET diagnostics=? WHERE id=?').run(JSON.stringify(value), id);
    });
    const cards = prepare(raw, config, references, topics.length);
    const added = store.addCards(cards, config.cacheLimit);
    store.markJob(id, 'completed');
    console.log(JSON.stringify({ state: 'completed', requestedCards: topics.length, addedCards: added, diagnostic, usage: store.usage() }));
  } catch (error) {
    const code = error instanceof Failure ? error.code : 'diagnostic_preparation_failed';
    store.markJob(id, code === 'upstream_timeout_or_network' ? 'uncertain' : 'failed', code);
    console.log(JSON.stringify({ state: 'failed', error: code, diagnostic, usage: store.usage() }));
    process.exitCode = 1;
  }
} finally {
  store?.close();
  await new Promise<void>(resolve => guard.close(() => resolve()));
}
