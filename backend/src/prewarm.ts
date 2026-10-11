import { readConfig } from './config.ts';
import { snapshot } from './contracts/index.ts';
import { Store } from './storage/store.ts';
import { Worker } from './jobs/worker.ts';
import { cloudGenerator } from './providers/cloud.ts';
const config = readConfig();
const store = new Store(config.database);
try {
  if (config.provider === 'disabled') throw new Error('Generation is disabled.');
  if (store.cards().length) console.log(JSON.stringify({ state: 'cached', cards: store.cards().length }));
  else {
    const deviceId = 'backend-cache-prewarm';
    const existing = store.getSnapshot(deviceId);
    const inventory = snapshot({ protocolVersion: 1, deviceId, inventoryVersion: (existing?.inventoryVersion ?? 0) + 1,
      snapshotComplete: true, counts: { unread: 0, readNonFavorite: 0, favorites: 0 }, retainedCards: [], interestTopicIds: [], historyEvents: [], pendingDeliveryIds: [] });
    const reply = store.sync(inventory, config);
    if (!reply.refillJobId) throw new Error('No prewarm job available; inspect backend status.');
    const worker = new Worker(config,store,cloudGenerator(config));
    await worker.tick();
    const job = store.job(reply.refillJobId);
    console.log(JSON.stringify({ state: job?.state, error: job?.error, cards: store.cards().length, usage: store.usage() }));
    if (job?.state !== 'completed') process.exitCode = 1;
  }
} finally { store.close(); }
