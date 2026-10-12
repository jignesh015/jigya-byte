import { Store } from './storage/store.ts';
import { LiveSources } from './sources/live.ts';

// Source-only probe: no environment secrets, model calls, persistent cards or usage changes.
const store = new Store(':memory:');
try {
  const live = new LiveSources(store);
  const evidence = await live.collect();
  console.log(JSON.stringify({ sources: live.status, evidenceItems: evidence.length,
    topics: Object.fromEntries(['current-affairs', 'ai-updates', 'agentic-coding', 'game-industry-news', 'indie-games']
      .map(topic => [topic, evidence.filter(item => item.topicIds.includes(topic)).length])), modelRequests: 0 }));
} finally { store.close(); }
