import type { Config } from '../config.ts';
import type { Source } from '../contracts/index.ts';
import { Failure, object } from '../contracts/index.ts';
import { hash } from '../preparation/cards.ts';
import { readJson, upstreamFailure } from '../providers/cloud.ts';
import type { Store } from '../storage/store.ts';

export type Reference = Source & { excerpt: string };
export type Retrieve = (topics: string[]) => Promise<Reference[]>;
export function wikipediaRetriever(config: Config, store: Store, fetcher: typeof fetch = fetch): Retrieve {
  let lastRequest = 0;
  async function get(path: string) {
    const wait = Math.max(0, 1200 - (Date.now() - lastRequest));
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastRequest = Date.now();
    let response: Response;
    try { response = await fetcher(`https://en.wikipedia.org${path}`, { headers: { Accept: 'application/json', 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(config.timeout) }); }
    catch { throw new Failure('retrieval_unavailable'); }
    if (!response.ok) { await response.body?.cancel(); throw new Failure(`retrieval_${upstreamFailure(response).code}`, 502, upstreamFailure(response).retryAfter); }
    return object(await readJson(response));
  }
  return async topics => {
    const references: Reference[] = [];
    for (const topic of [...new Set(topics)]) {
      const cached = store.db.prepare('SELECT body FROM sources WHERE id=? AND fetched_at>?').get(topic, Date.now() - 86400000) as { body: string } | undefined;
      if (cached) { references.push(JSON.parse(cached.body)); continue; }
      const search = await get(`/w/rest.php/v1/search/page?q=${encodeURIComponent(topic.replaceAll('-', ' '))}&limit=4`);
      const pages = search.pages as { key?: string; title?: string }[] | undefined;
      const page = pages?.find(p => typeof p.key === 'string' && typeof p.title === 'string');
      if (!page?.key || !page.title) throw new Failure('retrieval_no_sources');
      const metadata = await get(`/w/rest.php/v1/page/${encodeURIComponent(page.key)}`);
      const summary = await get(`/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`);
      const license = metadata.license as { title?: string; url?: string } | undefined;
      if (!license?.title || !license.url?.startsWith('https://')) throw new Failure('retrieval_license_missing');
      if (typeof summary.extract !== 'string' || summary.extract.length < 50) throw new Failure('retrieval_no_excerpt');
      const source: Reference = { id: `wikipedia-${hash(page.key)}`, title: page.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`, attribution: 'Adapted from Wikipedia contributors; see source page history.',
        license: license.title, licenseUrl: license.url, retrievedAt: new Date().toISOString(), providerId: 'wikimedia-en', excerpt: summary.extract.slice(0, 1500) };
      store.db.prepare('INSERT INTO sources VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,fetched_at=excluded.fetched_at').run(topic, JSON.stringify(source), Date.now());
      references.push(source);
    }
    return references;
  };
}
