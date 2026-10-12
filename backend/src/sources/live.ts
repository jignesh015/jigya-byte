import { createHash, randomInt } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { SourceRef } from '../contracts/index.ts';
import type { Store } from '../storage/store.ts';

export const NEWS_TOPICS = ['ai-updates', 'game-industry-news', 'current-affairs'];
export type Evidence = SourceRef & { topicIds: string[]; excerpt: string; dateKind: 'published' | 'observed' };
export type SourceStatus = { endpoint: string; state: 'cached' | 'fetched' | 'unavailable'; items: number; reason?: string };
const DAY = 86400000;
const clean = (value: unknown) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
export function publicUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && /^[a-z][a-z0-9.-]*\.[a-z]{2,}$/i.test(u.hostname)
      && !/(^|\.)(localhost|local|internal|test|invalid)$/i.test(u.hostname);
  } catch { return false; }
}
function evidence(name: string, topics: string[], title: unknown, url: unknown, date: unknown, excerpt: unknown,
  dateKind: Evidence['dateKind'] = 'published', now = Date.now()): Evidence | null {
  const heading = clean(title).slice(0, 200), text = clean(excerpt).slice(0, 900);
  const timestamp = typeof date === 'string' || typeof date === 'number' ? new Date(date).getTime() : NaN;
  if (!heading || text.length < 80 || typeof url !== 'string' || !publicUrl(url) || !Number.isFinite(timestamp)
    || timestamp > now + 300000 || now - timestamp > 7 * DAY) return null;
  return { id: `src-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`, name, title: heading,
    url, publishedAt: new Date(timestamp).toISOString(), retrievedAt: new Date(now).toISOString(), excerpt: text, topicIds: topics, dateKind };
}
function rssItems(xml: string): Record<string, unknown>[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported XML declarations');
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(xml);
  const items = parsed?.rss?.channel?.item ?? [];
  return (Array.isArray(items) ? items : [items]).slice(0, 40);
}
export function parsePib(xml: string, now = Date.now()): Evidence[] {
  return rssItems(xml).flatMap(item => {
    const link = typeof item.link === 'string' ? item.link : '';
    if (!/^https:\/\/(www\.)?pib\.gov\.in\//i.test(link)) return [];
    const result = evidence('Press Information Bureau', ['current-affairs'], item.title, link, item.pubDate, item.description, 'published', now);
    return result ? [result] : [];
  });
}
export function parseUn(xml: string, now = Date.now()): Evidence[] {
  return rssItems(xml).flatMap(item => {
    if (typeof item.link !== 'string' || !item.link.startsWith('https://news.un.org/')) return [];
    const result = evidence('UN News', ['current-affairs'], item.title, item.link, item.pubDate, item.description, 'published', now);
    return result ? [result] : [];
  });
}
export function parsePibPage(html: string, title: string, url: string, now = Date.now()): Evidence[] {
  const dateText = clean(html.match(/<div[^>]*id=["']PrDateTime["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
  const parts = dateText.match(/(\d{1,2})\s+([A-Z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!parts) return [];
  const month = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(parts[2].toUpperCase()) + 1;
  if (!month) return [];
  const hour = Number(parts[4]) % 12 + (parts[6].toUpperCase() === 'PM' ? 12 : 0);
  const published = `${parts[3]}-${String(month).padStart(2,'0')}-${parts[1].padStart(2,'0')}T${String(hour).padStart(2,'0')}:${parts[5]}:00+05:30`;
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => clean(m[1])).filter(p => p.length >= 80).slice(0, 3).join(' ');
  const result = evidence('Press Information Bureau', ['current-affairs'], title, url, published, paragraphs, 'published', now);
  return result ? [result] : [];
}
export function parseGdelt(raw: unknown, topic: string, now = Date.now()): Evidence[] {
  const articles = (raw as { articles?: Record<string, unknown>[] })?.articles;
  if (!Array.isArray(articles)) return [];
  return articles.slice(0, 30).flatMap(a => {
    // GDELT seendate is observation time, not the publisher's publication time.
    const date = typeof a.seendate === 'string' ? a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z') : '';
    const result = evidence(`GDELT · ${clean(a.domain) || 'news index'}`, [topic], a.title, a.url, date, a.context ?? a.snippet, 'observed', now);
    return result ? [result] : [];
  });
}
export function parseReleases(raw: unknown, repo: string, now = Date.now()): Evidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap(r => {
    if (!r || r.draft || r.prerelease || !String(r.html_url).startsWith(`https://github.com/${repo}/releases/`)) return [];
    const result = evidence(`GitHub · ${repo}`, ['ai-updates', 'agentic-coding'], r.name || r.tag_name, r.html_url, r.published_at, r.body, 'published', now);
    return result ? [result] : [];
  });
}
export function parseSteam(raw: unknown, now = Date.now()): Evidence[] {
  const items = (raw as { appnews?: { newsitems?: Record<string, unknown>[] } })?.appnews?.newsitems;
  if (!Array.isArray(items)) return [];
  return items.slice(0, 15).flatMap(a => {
    // Only official developer announcements, not syndicated third-party journalism.
    if (a.feedname !== 'steam_community_announcements') return [];
    const result = evidence('Steam developer announcement', ['game-industry-news', 'indie-games'], a.title, a.url,
      typeof a.date === 'number' ? a.date * 1000 : '', a.contents, 'published', now);
    return result ? [result] : [];
  });
}

export class LiveSources {
  store: Store; fetcher: typeof fetch; status: SourceStatus[] = [];
  pending = new Map<string, Promise<Evidence[]>>();
  constructor(store: Store, fetcher: typeof fetch = fetch) { this.store = store; this.fetcher = fetcher; }
  async load(key: string, url: string, parse: (body: unknown) => Evidence[] | Promise<Evidence[]>, xml = false): Promise<Evidence[]> {
    const active = this.pending.get(key); if (active) return active;
    const promise = this.read(key, url, parse, xml);
    this.pending.set(key, promise);
    try { return await promise; } finally { this.pending.delete(key); }
  }
  private async read(key: string, url: string, parse: (body: unknown) => Evidence[] | Promise<Evidence[]>, xml: boolean) {
    const cached = this.store.cachedSource(key);
    if (cached && Date.now() - cached.fetchedAt < 3600000) {
      const items = (cached.body as Evidence[]).filter(item => Date.now() - Date.parse(item.publishedAt) <= 7 * DAY);
      this.status.push({ endpoint: key, state: 'cached', items: items.length }); return items;
    }
    try {
      const origin = new URL(url); let target = origin; let response: Response | undefined;
      const signal = AbortSignal.timeout(12000);
      for (let redirects = 0; redirects < 3; redirects++) {
        response = await this.fetcher(target, { redirect: 'manual', signal,
          headers: { Accept: xml ? 'application/rss+xml, application/xml, text/xml' : 'application/json', 'User-Agent': 'JigyaByte/1.0 (personal learning feed)' } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const next = new URL(response.headers.get('location') ?? '', target);
        await response.body?.cancel();
        if (!publicUrl(next.href) || next.hostname.replace(/^www\./, '') !== origin.hostname.replace(/^www\./, '')) throw new Error('unsafe_redirect');
        target = next;
      }
      if (!response?.ok) throw new Error(`http_${response?.status ?? 0}`);
      const reader = response.body?.getReader(); if (!reader) throw new Error('Empty source');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length;
          if (bytes > 512 * 1024) throw new Error('Source too large'); chunks.push(value); }
      } finally { await reader.cancel(); }
      const text = Buffer.concat(chunks).toString('utf8');
      const items = await parse(xml ? text : JSON.parse(text));
      this.store.cacheSource(key, items);
      this.status.push({ endpoint: key, state: 'fetched', items: items.length }); return items;
    } catch (error) {
      // Cache failures for an hour too: avoid hammering a broken free service.
      this.store.cacheSource(key, []);
      const networkCode = (error as { cause?: { code?: string } })?.cause?.code;
      const reason = error instanceof Error && /^http_\d{3}$|^unsafe_redirect$/.test(error.message) ? error.message
        : networkCode && /^[A-Z0-9_]{1,64}$/.test(networkCode) ? networkCode : error instanceof Error ? error.name : 'source_error';
      this.status.push({ endpoint: key, state: 'unavailable', items: 0, reason }); return [];
    }
  }
  async collect(): Promise<Evidence[]> {
    this.status = [];
    const repositories = ['google-gemini/gemini-cli', 'anthropics/claude-code', 'openai/codex', 'huggingface/transformers'];
    const repo = repositories[randomInt(repositories.length)];
    const games = [413150, 1145360, 367520, 646570, 588650, 1245620, 1091500, 1172470];
    const app = games[randomInt(games.length)];
    const activeApp = [730, 570, 252490][randomInt(3)];
    const query = (topic: string) => topic === 'ai-updates' ? '"artificial intelligence" sourcelang:english'
      : topic === 'game-industry-news' ? '("video game" OR "game studio") sourcelang:english'
      : '(India OR economy OR science OR climate) sourcelang:english';
    const tasks = [
      this.load('pib', 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', async body => {
        const xml = String(body); const complete = parsePib(xml); if (complete.length) return complete;
        // The public feed often provides only a title/link. Fetch at most three official releases.
        const releases = rssItems(xml).filter(item => typeof item.link === 'string' && /^https:\/\/(www\.)?pib\.gov\.in\/PressRelease(?:Iframe)?Page\.aspx\?PRID=\d+$/i.test(item.link)).slice(0, 3);
        const results = await Promise.allSettled(releases.map(item => {
          const url = String(item.link).replace('https://pib.gov.in/', 'https://www.pib.gov.in/');
          return this.load(`pib-release:${new URL(url).searchParams.get('PRID')}`, url, html => parsePibPage(String(html), clean(item.title), url), true);
        }));
        return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      }, true),
      this.load('un-news', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', body => parseUn(String(body)), true),
      this.load(`github:${repo}`, `https://api.github.com/repos/${repo}/releases?per_page=10`, body => parseReleases(body, repo)),
      this.load(`steam:${app}`, `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${app}&count=15&maxlength=900&feeds=steam_community_announcements`, parseSteam),
      this.load(`steam:${activeApp}`, `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${activeApp}&count=15&maxlength=900&feeds=steam_community_announcements`, parseSteam),
      ...NEWS_TOPICS.map(topic => this.load(`gdelt:${topic}`,
        `https://api.gdeltproject.org/api/v2/context/context?query=${encodeURIComponent(query(topic))}&mode=artlist&format=json&timespan=72h&sort=datedesc&maxrecords=30`, body => parseGdelt(body, topic))),
    ];
    const result = await Promise.allSettled(tasks);
    return [...new Map(result.flatMap(r => r.status === 'fulfilled' ? r.value : []).map(item => [item.id, item])).values()];
  }
}
