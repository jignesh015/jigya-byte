import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const topicNames = {
  'game-design': 'Game Design', science: 'Science', history: 'History', geography: 'Geography',
  space: 'Space', economics: 'Economics', psychology: 'Psychology', technology: 'Technology',
  philosophy: 'Philosophy', biology: 'Biology',
};

export function createCardService({ model = process.env.OLLAMA_MODEL, request = fetch,
  cacheFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache/cards.json') } = {}) {
  let busy = false;
  let cached = [];
  const loaded = readFile(cacheFile, 'utf8').then(text => {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) cached = parsed.slice(-100);
  }).catch(() => {});

  async function localModelAvailable() {
    if (!model || /cloud|https?:|\//i.test(model)) throw new Error('Set OLLAMA_MODEL to an installed local model.');
    const response = await request('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Ollama is unavailable.');
    const { models } = await response.json();
    const installed = models?.find(item => item.name === model || item.name === `${model}:latest`);
    if (!installed || installed.remote_host || installed.remote_model || !installed.size) throw new Error('An installed local model is required.');
    const show = await request('http://127.0.0.1:11434/api/show', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(3000),
    });
    if (!show.ok) throw new Error('Could not inspect the local model.');
    const info = await show.json();
    if (info.remote_host || info.remote_model || /REMOTE\s+/i.test(info.modelfile ?? '')) throw new Error('Remote models are disabled.');
  }

  return createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    await loaded;
    if (req.method === 'GET' && req.url === '/health') {
      try { await localModelAvailable(); send(200, { status: 'ready', mode: 'local-only', model }); }
      catch { send(503, { status: 'unavailable', mode: 'local-only' }); }
      return;
    }
    if (req.method === 'GET' && req.url === '/cards') { send(200, { cards: cached }); return; }
    if (req.method !== 'POST' || req.url !== '/generate') { send(404, { error: 'Not found' }); return; }
    if (busy) { send(429, { error: 'A generation is already running.' }); return; }
    busy = true;
    const bodyTimer = setTimeout(() => req.destroy(), 5000);
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) { send(413, { error: 'Request too large' }); return; }
      }
      clearTimeout(bodyTimer);
      let input;
      try { input = JSON.parse(body); } catch { send(400, { error: 'Invalid JSON' }); return; }
      if (!Object.hasOwn(topicNames, input?.topicId ?? '')) { send(400, { error: 'Unknown topic' }); return; }
      await localModelAvailable();
      const response = await request('http://127.0.0.1:11434/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(80000),
        body: JSON.stringify({ model, stream: false, format: 'json', options: { num_predict: 700 },
          prompt: `Write one accessible bite-sized learning idea about ${topicNames[input.topicId]}. Avoid medical, legal or financial advice. Return JSON only with title (at most 100 characters), summary (at most 240 characters), explanation (at most 4000 characters). Use one clear idea and plain language. Do not invent citations or claim verification.` }),
      });
      if (!response.ok) throw new Error('Generation unavailable');
      const output = await response.json();
      const generated = JSON.parse(output.response);
      for (const [key, limit] of [['title', 100], ['summary', 240], ['explanation', 4000]]) {
        if (typeof generated[key] !== 'string' || !generated[key].trim() || generated[key].length > limit) throw new Error('Invalid generated text');
      }
      const hash = createHash('sha256').update(`${generated.title}\n${generated.summary}\n${generated.explanation}`).digest('hex');
      const card = { id: `local-ai-${hash}`, providerId: 'local-ai', title: generated.title.trim(),
        summary: generated.summary.trim(), explanation: generated.explanation.trim(),
        primaryTopicId: input.topicId, topicIds: [input.topicId], sourceName: 'AI generated · local model',
        sourceUrl: null, attribution: `Generated locally with ${model}. Unverified; check claims independently.`,
        license: 'Generated text; model terms apply', licenseUrl: null, retrievedAt: new Date().toISOString() };
      const next = [...cached.filter(item => item.id !== card.id), card].slice(-100);
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(`${cacheFile}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${cacheFile}.tmp`, cacheFile);
      cached = next;
      send(200, card);
    } catch { if (!res.headersSent && !res.destroyed) send(503, { error: 'Local generation unavailable. Cached cards remain readable.' }); }
    finally { clearTimeout(bodyTimer); busy = false; }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.JIGYABYTE_HOST ?? '127.0.0.1';
  createCardService().listen(4318, host, () => console.log(`JigyaByte local-only service: http://${host}:4318`));
}
