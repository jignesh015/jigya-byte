import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readConfig, generationBatchSize } from './config.ts';
import { Store } from './storage/store.ts';
import { Failure, TOPICS } from './contracts/index.ts';
import { cloudGenerator } from './providers/cloud.ts';
import type { ProviderDiagnostic } from './providers/cloud.ts';
import { outputSchema, prepare, prompt } from './preparation/cards.ts';
import { distributedTopics } from './preparation/topics.ts';
import { NEWS_TOPICS } from './sources/live.ts';

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
  // Isolate model availability from source availability, using random evergreen topics.
  const topics = distributedTopics(TOPICS.filter(topic => !NEWS_TOPICS.includes(topic)), generationBatchSize(config), store.topicCounts());
  const excluded = store.cards().slice(-15).map(c => c.title);
  const inputLimit = Math.min(config.maxInput, config.tokenLimit - store.usage().tokens - config.maxOutput);
  let text = prompt(topics, excluded);
  while (Buffer.byteLength(text + JSON.stringify(outputSchema)) > inputLimit && topics.length > 1) { topics.pop(); text = prompt(topics, excluded); }
  const inputBytes = Buffer.byteLength(text + JSON.stringify(outputSchema));
  if (inputBytes > inputLimit) throw new Error('Diagnostic input exceeds the remaining configured budget.');
  const id = store.queue(`gemini-diagnostic-${randomUUID()}`, topics.length);
  let diagnostic: ProviderDiagnostic | undefined;
  try {
    store.reserveBudget(store.job(id)!, config, inputBytes);
    const raw = await cloudGenerator(config)(text, value => {
      diagnostic = value;
      store!.db.prepare('UPDATE jobs SET diagnostics=? WHERE id=?').run(JSON.stringify(value), id);
    });
    const cards = prepare(raw, config, topics.length);
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
