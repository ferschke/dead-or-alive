/**
 * OMDb service. Used ONLY to obtain IMDb / Rotten Tomatoes / Metacritic ratings.
 * The key is optional; without it no ratings are fetched or shown.
 */
import type { MediaWork } from '../types/media';

const OMDB_BASE = 'https://www.omdbapi.com/';
const KEY_STORAGE = 'dead_or_alive_omdb_api_key';
const USAGE_STORAGE = 'dead_or_alive_omdb_usage';
const RATINGS_STORAGE = 'dead_or_alive_omdb_ratings';
const RATINGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Free OMDb keys allow 1,000 requests per day (resets at 00:00 UTC). */
export const OMDB_DAILY_LIMIT = 1000;
export const OMDB_USAGE_EVENT = 'omdb-usage-changed';

export interface OmdbRatings {
  imdbRating?: string; // e.g. "8.1/10"
  imdbVotes?: string;
  imdbId?: string;
  rottenTomatoes?: string; // e.g. "93%"
  metacritic?: string; // e.g. "74/100"
}

export interface OmdbUsage {
  date: string; // UTC YYYY-MM-DD
  used: number;
  limit: number;
  remaining: number;
  limitReached: boolean;
}

export function getStoredOmdbKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE)?.trim() || '';
  } catch {
    return '';
  }
}

export function setStoredOmdbKey(key: string): void {
  try {
    const cleaned = key.trim();
    if (cleaned) localStorage.setItem(KEY_STORAGE, cleaned);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // ignore
  }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

interface StoredUsage {
  date: string;
  used: number;
  limitReached: boolean;
}

function readUsage(): StoredUsage {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE);
    if (raw) {
      const p = JSON.parse(raw) as StoredUsage;
      if (p.date === todayUtc()) return p;
    }
  } catch {
    // ignore
  }
  return { date: todayUtc(), used: 0, limitReached: false };
}

function writeUsage(u: StoredUsage): void {
  try {
    localStorage.setItem(USAGE_STORAGE, JSON.stringify(u));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(OMDB_USAGE_EVENT));
}

export function getOmdbUsage(): OmdbUsage {
  const u = readUsage();
  const used = u.limitReached ? Math.max(u.used, OMDB_DAILY_LIMIT) : u.used;
  return {
    date: u.date,
    used,
    limit: OMDB_DAILY_LIMIT,
    remaining: Math.max(0, OMDB_DAILY_LIMIT - used),
    limitReached: u.limitReached || used >= OMDB_DAILY_LIMIT,
  };
}

type RatingsCache = Record<string, { at: number; ratings: OmdbRatings | null }>;

function readRatingsCache(): RatingsCache {
  try {
    return JSON.parse(localStorage.getItem(RATINGS_STORAGE) || '{}');
  } catch {
    return {};
  }
}

function writeRatingsCache(c: RatingsCache): void {
  try {
    localStorage.setItem(RATINGS_STORAGE, JSON.stringify(c));
  } catch {
    // ignore
  }
}

async function omdbRequest(
  apiKey: string,
  params: Record<string, string>
): Promise<any> {
  const usage = readUsage();
  if (usage.limitReached) throw new Error('OMDb daily request limit reached');

  const url = new URL(OMDB_BASE);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  writeUsage({ ...usage, used: usage.used + 1 });
  const res = await fetch(url.toString());
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (/limit/i.test(data?.Error || '')) {
      writeUsage({ ...readUsage(), used: OMDB_DAILY_LIMIT, limitReached: true });
      throw new Error('OMDb daily request limit reached');
    }
    throw new Error(data?.Error || 'Invalid OMDb API key');
  }
  if (!res.ok) throw new Error(`OMDb error ${res.status}`);
  const data = await res.json();
  if (data?.Response === 'False' && /limit/i.test(data?.Error || '')) {
    writeUsage({ ...readUsage(), used: OMDB_DAILY_LIMIT, limitReached: true });
    throw new Error('OMDb daily request limit reached');
  }
  return data;
}

/** Verifies a key (costs one request against the daily quota). */
export async function validateOmdbKey(apiKey: string): Promise<boolean> {
  try {
    const data = await omdbRequest(apiKey.trim(), { i: 'tt0111161' });
    return data?.Response === 'True';
  } catch {
    return false;
  }
}

function clean(v: unknown): string | undefined {
  return typeof v === 'string' && v && v !== 'N/A' ? v : undefined;
}

function parseRatings(data: any): OmdbRatings | null {
  if (!data || data.Response !== 'True') return null;
  const out: OmdbRatings = {
    imdbRating: clean(data.imdbRating) ? `${data.imdbRating}/10` : undefined,
    imdbVotes: clean(data.imdbVotes),
    imdbId: clean(data.imdbID),
    metacritic: clean(data.Metascore) ? `${data.Metascore}/100` : undefined,
  };
  const rt = (data.Ratings || []).find(
    (r: any) => r.Source === 'Rotten Tomatoes'
  );
  out.rottenTomatoes = clean(rt?.Value);
  return out;
}

/**
 * Fetches ratings for a work. Returns cached results when available (7 days)
 * so repeat views don't consume quota. Returns null if unavailable.
 */
export async function fetchOmdbRatings(
  work: MediaWork,
  apiKey: string
): Promise<OmdbRatings | null> {
  const key = apiKey.trim();
  if (!key) return null;

  const cache = readRatingsCache();
  const hit = cache[work.id];
  if (hit && Date.now() - hit.at < RATINGS_TTL_MS) return hit.ratings;

  const type = work.mediaType === 'movie' ? 'movie' : 'series';
  const base: Record<string, string> = { t: work.title, type };
  if (work.releaseYear) base.y = String(work.releaseYear);

  let data = await omdbRequest(key, base);
  if (data?.Response === 'False' && base.y && type === 'series') {
    // Series "y" is the first-air year; retry without it if not found.
    const { y: _y, ...noYear } = base;
    void _y;
    data = await omdbRequest(key, noYear);
  }
  const ratings = parseRatings(data);
  const next = readRatingsCache();
  next[work.id] = { at: Date.now(), ratings };
  writeRatingsCache(next);
  return ratings;
}
