import type {
  MediaType,
  MediaWork,
  RawActorRecord,
  SearchResultItem,
} from '../types/media';
import { mergeCastLists } from './catalogStorage';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';

const STORAGE_KEY = 'dead_or_alive_tmdb_api_key';

export function getStoredTmdbKey(): string {
  try {
    return (
      localStorage.getItem(STORAGE_KEY)?.trim() ||
      (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim() ||
      ''
    );
  } catch {
    return '';
  }
}

export function setStoredTmdbKey(key: string): void {
  try {
    const cleaned = key.trim();
    if (cleaned) {
      localStorage.setItem(STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function tmdbFetch(
  endpoint: string,
  apiKey: string,
  params: Record<string, string> = {}
): Promise<any> {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (apiKey.length > 45 || apiKey.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    url.searchParams.set('api_key', apiKey);
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`TMDB API Error (${res.status})`);
  }
  return res.json();
}

export async function validateTmdbKey(apiKey: string): Promise<boolean> {
  try {
    await tmdbFetch('/configuration', apiKey.trim());
    return true;
  } catch {
    return false;
  }
}

export async function searchTmdbMedia(
  query: string,
  apiKey: string
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed || !apiKey) return [];

  const data = await tmdbFetch('/search/multi', apiKey, {
    query: trimmed,
    include_adult: 'false',
    language: 'en-US',
    page: '1',
  });

  const results: SearchResultItem[] = [];

  for (const item of data?.results || []) {
    if (item.media_type !== 'movie' && item.media_type !== 'tv') continue;

    const isTv = item.media_type === 'tv';
    const title = isTv ? item.name : item.title;
    if (!title) continue;

    const dateStr: string = isTv ? item.first_air_date : item.release_date;
    const releaseYear = dateStr ? parseInt(dateStr.slice(0, 4), 10) : undefined;

    const posterUrl = item.poster_path
      ? `${TMDB_IMG_BASE}/w342${item.poster_path}`
      : undefined;

    results.push({
      id: `tmdb-${item.media_type}-${item.id}`,
      tmdbId: item.id,
      title,
      releaseYear: !isNaN(releaseYear as number) ? releaseYear : undefined,
      mediaType: isTv ? 'tv' : 'movie',
      description:
        item.overview ||
        (isTv ? 'Television Series (TMDB)' : 'Feature Film (TMDB)'),
      posterUrl,
      source: 'tmdb',
    });
  }

  return results.slice(0, 15);
}

export async function fetchTmdbWork(
  mediaType: MediaType,
  tmdbId: number,
  apiKey: string
): Promise<MediaWork> {
  const isTv = mediaType === 'tv' || mediaType === 'miniseries';
  const detailsEndpoint = isTv ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
  const creditsEndpoint = isTv
    ? `/tv/${tmdbId}/aggregate_credits`
    : `/movie/${tmdbId}/credits`;

  const [details, credits] = await Promise.all([
    tmdbFetch(detailsEndpoint, apiKey, { language: 'en-US' }),
    tmdbFetch(creditsEndpoint, apiKey, { language: 'en-US' }),
  ]);

  const title = (isTv ? details.name : details.title) || 'Untitled';
  const dateStr: string = isTv ? details.first_air_date : details.release_date;
  const releaseYear = dateStr ? parseInt(dateStr.slice(0, 4), 10) : undefined;
  const endYearStr: string | undefined = isTv
    ? details.last_air_date
    : undefined;
  const endYear =
    isTv && details.status === 'Ended' && endYearStr
      ? parseInt(endYearStr.slice(0, 4), 10)
      : undefined;

  const posterUrl = details.poster_path
    ? `${TMDB_IMG_BASE}/w500${details.poster_path}`
    : undefined;

  let directorOrCreator: string | undefined;
  if (isTv && Array.isArray(details.created_by)) {
    directorOrCreator = details.created_by.map((c: any) => c.name).join(', ');
  } else if (!isTv && Array.isArray(credits.crew)) {
    const dirs = credits.crew
      .filter((c: any) => c.job === 'Director')
      .map((c: any) => c.name);
    if (dirs.length > 0) directorOrCreator = dirs.join(', ');
  }

  const rawCast = (credits?.cast || []).slice(0, 120);

  // Fetch person details in concurrent batches of 15 to get birthday & deathday
  const personMap: Record<number, any> = {};
  const batchSize = 15;
  for (let i = 0; i < rawCast.length; i += batchSize) {
    const batch = rawCast.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (member: any) => {
        try {
          const p = await tmdbFetch(`/person/${member.id}`, apiKey, {
            language: 'en-US',
          });
          personMap[member.id] = p;
        } catch {
          // ignore individual failure
        }
      })
    );
  }

  const cast: RawActorRecord[] = rawCast.map((member: any, idx: number) => {
    const person = personMap[member.id];
    const character = isTv
      ? member.roles
          ?.map((r: any) => r.character)
          .filter(Boolean)
          .slice(0, 2)
          .join(' / ') || member.character
      : member.character;

    const isVoice =
      typeof character === 'string' &&
      character.toLowerCase().includes('(voice)');

    return {
      id: `tmdb-person-${member.id}`,
      name: member.name,
      character: character || undefined,
      billingOrder: idx + 1,
      birthDate: person?.birthday || null,
      birthPrecision: 'day',
      deathDate: person?.deathday || null,
      deathPrecision: 'day',
      imageUrl: member.profile_path
        ? `${TMDB_IMG_BASE}/w342${member.profile_path}`
        : undefined,
      wikipediaUrl: `https://www.themoviedb.org/person/${member.id}`,
      isVoice,
    };
  });

  return {
    id: `tmdb-${isTv ? 'tv' : 'movie'}-${tmdbId}`,
    tmdbId,
    title,
    releaseYear: !isNaN(releaseYear as number) ? releaseYear : undefined,
    endYear: !isNaN(endYear as number) ? endYear : undefined,
    mediaType: isTv ? 'tv' : 'movie',
    description: details.overview || '',
    directorOrCreator,
    posterUrl,
    wikipediaUrl: `https://www.themoviedb.org/${isTv ? 'tv' : 'movie'}/${tmdbId}`,
    source: 'tmdb',
    cast,
  };
}

/**
 * Enriches a Wikidata/Catalog MediaWork with additional TMDB data (cast, characters, portraits,
 * posters, overview, and missing birth/death dates) when a TMDB API key is configured.
 */
export async function enrichWorkWithTmdb(
  work: MediaWork,
  apiKey: string
): Promise<MediaWork> {
  if (!apiKey.trim()) return work;

  try {
    let tmdbId = work.tmdbId;
    let targetType: MediaType = work.mediaType;

    if (!tmdbId) {
      const searchResults = await searchTmdbMedia(work.title, apiKey);
      const bestMatch =
        searchResults.find(
          (r) =>
            r.title.toLowerCase() === work.title.toLowerCase() &&
            (!work.releaseYear ||
              !r.releaseYear ||
              Math.abs(r.releaseYear - work.releaseYear) <= 1)
        ) || searchResults[0];

      if (bestMatch?.tmdbId) {
        tmdbId = bestMatch.tmdbId;
        targetType = bestMatch.mediaType;
      }
    }

    if (!tmdbId) return work;

    const tmdbWork = await fetchTmdbWork(targetType, tmdbId, apiKey);

    // Merge TMDB cast and Wikidata cast, preserving TMDB billing order + Wikidata birth/death dates
    const mergedCast = mergeCastLists(tmdbWork.cast, work.cast);

    return {
      ...work,
      tmdbId,
      posterUrl: tmdbWork.posterUrl || work.posterUrl,
      description:
        tmdbWork.description && tmdbWork.description.length > work.description.length
          ? tmdbWork.description
          : work.description,
      directorOrCreator: work.directorOrCreator || tmdbWork.directorOrCreator,
      cast: mergedCast,
    };
  } catch {
    return work;
  }
}
