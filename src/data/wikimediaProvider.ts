import type { ContentCard, Topic } from './cardContent';
import { DiscoveryFailure, type DiscoveryProvider } from './discoveryProvider';

type SearchPage = { key?: string; title?: string };
type SearchResponse = { pages?: SearchPage[] };
type SummaryResponse = {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};
type PageMetadataResponse = { license?: { title?: string; url?: string } };

const API_BASE = 'https://en.wikipedia.org';
const REQUEST_TIMEOUT_MS = 9000;
const MAX_ATTEMPTS = 3;
const MAX_SUMMARIES_PER_SEARCH = 4;
const REQUEST_SPACING_MS = 1200;
const MAX_RETRY_AFTER_MS = 20000;
const FALLBACK_LICENSE = 'CC BY-SA 4.0; check the source page for exceptions';
const FALLBACK_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, date - Date.now()));
}

function cleanExtract(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function conciseSummary(extract: string): string {
  const firstSentence = extract.match(/^.{1,220}?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence) return firstSentence;
  return extract.length > 220 ? `${extract.slice(0, 217).trimEnd()}…` : extract;
}

class WikimediaDiscoveryProvider implements DiscoveryProvider {
  readonly id = 'wikimedia-en';
  private lastRequestAt = 0;

  private async getJson<T>(url: string): Promise<T> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const remainingSpacing = REQUEST_SPACING_MS - (Date.now() - this.lastRequestAt);
      if (remainingSpacing > 0) await delay(remainingSpacing);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      this.lastRequestAt = Date.now();
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'Api-User-Agent': 'JigyaByte/1.0 (Expo Go personal learning app)',
          },
          signal: controller.signal,
        });
        if (response.ok) return await response.json() as T;

        if ((response.status === 429 || response.status === 503) && attempt < MAX_ATTEMPTS - 1) {
          const requestedDelay = retryAfterMs(response.headers.get('Retry-After'));
          await delay(requestedDelay ?? 1000 * (attempt + 1));
          continue;
        }
        if (response.status === 429 || response.status === 503) {
          throw new DiscoveryFailure('rate-limited', 'Wikipedia is asking this app to slow down. Try again shortly.');
        }
        throw new DiscoveryFailure('provider', `Wikipedia returned an error (${response.status}).`);
      } catch (error) {
        if (error instanceof DiscoveryFailure) throw error;
        if (attempt === MAX_ATTEMPTS - 1) {
          const timedOut = error instanceof Error && error.name === 'AbortError';
          throw new DiscoveryFailure(
            'offline',
            timedOut ? 'Wikipedia took too long to respond. Your saved cards are still available.'
              : 'Could not reach Wikipedia. Check your connection; your saved cards are still available.',
          );
        }
        await delay(500 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new DiscoveryFailure('provider', 'Wikipedia did not return a usable response.');
  }

  async discover(topic: Topic, existingCardIds: ReadonlySet<string>): Promise<ContentCard | null> {
    const searchUrl = `${API_BASE}/w/rest.php/v1/search/page?q=${encodeURIComponent(topic.name)}&limit=8`;
    const search = await this.getJson<SearchResponse>(searchUrl);
    const pages = (search.pages ?? []).filter((page) => page.key && page.title);
    let checked = 0;

    for (const page of pages) {
      if (checked >= MAX_SUMMARIES_PER_SEARCH) break;
      const id = `wikipedia:${page!.key}`;
      if (existingCardIds.has(id)) continue;
      checked += 1;

      const pageUrl = `${API_BASE}/w/rest.php/v1/page/${encodeURIComponent(page!.key!)}`;
      const metadata = await this.getJson<PageMetadataResponse>(pageUrl);
      const summaryUrl = `${API_BASE}/api/rest_v1/page/summary/${encodeURIComponent(page!.key!)}`;
      const summary = await this.getJson<SummaryResponse>(summaryUrl);
      const title = summary.title?.trim() || page!.title!.trim();
      const extract = summary.extract ? cleanExtract(summary.extract) : '';
      if (!title || extract.length < 50) continue;

      const explanation = extract.length > 1500 ? `${extract.slice(0, 1497).trimEnd()}…` : extract;
      const card: ContentCard = {
        id,
        providerId: this.id,
        title,
        summary: conciseSummary(extract),
        explanation,
        primaryTopicId: topic.id,
        topicIds: [topic.id],
        sourceName: 'Wikipedia contributors',
        sourceUrl: summary.content_urls?.desktop?.page
          ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page!.key!)}`,
        attribution: 'Adapted from Wikipedia contributors. See the source page for its history.',
        license: metadata.license?.title?.trim() || FALLBACK_LICENSE,
        licenseUrl: metadata.license?.url || FALLBACK_LICENSE_URL,
        retrievedAt: new Date().toISOString(),
      };
      return card;
    }

    return null;
  }
}

export const wikimediaProvider: DiscoveryProvider = new WikimediaDiscoveryProvider();
