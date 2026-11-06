import { CURATED_WORKS } from '../data/curatedWorks';
import type { MediaWork, RawActorRecord, SearchResultItem } from '../types/media';

const CATALOG_STORAGE_KEY = 'dead_or_alive_persistent_catalog_v2';

export interface CatalogMediaWork extends MediaWork {
  aliases?: string[];
  cachedAt?: string;
  isUserCached?: boolean;
  hasTmdbEnrichment?: boolean;
}

/**
 * Loads user-cached works from localStorage.
 */
export function loadUserCachedWorks(): CatalogMediaWork[] {
  try {
    const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((w) => w && typeof w.id === 'string' && Array.isArray(w.cast));
  } catch {
    return [];
  }
}

/**
 * Saves the array of user-cached works to localStorage.
 */
function saveUserCachedWorks(works: CatalogMediaWork[]): void {
  try {
    localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(works));
  } catch {
    // If quota exceeded, trim oldest cached works and retry
    try {
      const trimmed = works.slice(0, 40);
      localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore storage errors
    }
  }
}

/**
 * Merges two cast arrays, deduplicating by normalized actor name and preserving the richest fields.
 */
export function mergeCastLists(
  primaryCast: RawActorRecord[],
  secondaryCast: RawActorRecord[]
): RawActorRecord[] {
  const byName = new Map<string, RawActorRecord>();
  const ordered: RawActorRecord[] = [];

  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  for (const actor of primaryCast) {
    if (!actor?.name) continue;
    const key = norm(actor.name);
    if (!byName.has(key)) {
      const copy = { ...actor };
      byName.set(key, copy);
      ordered.push(copy);
    }
  }

  for (const actor of secondaryCast) {
    if (!actor?.name) continue;
    const key = norm(actor.name);
    const existing = byName.get(key);
    if (existing) {
      if (!existing.birthDate && actor.birthDate) {
        existing.birthDate = actor.birthDate;
        existing.birthPrecision = actor.birthPrecision;
      }
      if (!existing.deathDate && actor.deathDate) {
        existing.deathDate = actor.deathDate;
        existing.deathPrecision = actor.deathPrecision;
      }
      if (!existing.character && actor.character) {
        existing.character = actor.character;
      }
      if (!existing.imageUrl && actor.imageUrl) {
        existing.imageUrl = actor.imageUrl;
      }
      if (!existing.wikipediaUrl && actor.wikipediaUrl) {
        existing.wikipediaUrl = actor.wikipediaUrl;
      }
      if (!existing.wikidataId && actor.wikidataId) {
        existing.wikidataId = actor.wikidataId;
      }
    } else {
      const copy = { ...actor, billingOrder: ordered.length + 1 };
      byName.set(key, copy);
      ordered.push(copy);
    }
  }

  ordered.forEach((a, idx) => {
    a.billingOrder = idx + 1;
  });

  return ordered;
}

/**
 * Returns the complete local catalog combining user-cached works (persisted in localStorage)
 * and the pre-seeded curated catalog.
 */
export function getPersistentCatalog(): CatalogMediaWork[] {
  const userCached = loadUserCachedWorks();
  const result: CatalogMediaWork[] = [...userCached];

  for (const seed of CURATED_WORKS) {
    const existingIdx = result.findIndex(
      (u) =>
        u.id === seed.id ||
        (u.wikidataId && seed.wikidataId && u.wikidataId === seed.wikidataId) ||
        (u.title.toLowerCase() === seed.title.toLowerCase() &&
          u.releaseYear === seed.releaseYear)
    );
    if (existingIdx >= 0) {
      // Merge seed cast and aliases into user-cached work so no actors are lost
      result[existingIdx] = {
        ...seed,
        ...result[existingIdx],
        aliases: seed.aliases,
        cast: mergeCastLists(result[existingIdx].cast, seed.cast),
      };
    } else {
      result.push({
        ...seed,
        isUserCached: false,
      });
    }
  }

  return result;
}

/**
 * Looks up a work in the persistent local catalog by ID, Wikidata ID, TMDB ID, or exact title+year.
 */
export function findInPersistentCatalog(queryItem: {
  id?: string;
  wikidataId?: string;
  tmdbId?: number;
  title?: string;
  releaseYear?: number | null;
}): CatalogMediaWork | undefined {
  const catalog = getPersistentCatalog();
  return catalog.find((w) => {
    if (queryItem.id && w.id === queryItem.id) return true;
    if (queryItem.wikidataId && w.wikidataId === queryItem.wikidataId) return true;
    if (queryItem.tmdbId && w.tmdbId === queryItem.tmdbId) return true;
    if (
      queryItem.title &&
      w.title.toLowerCase() === queryItem.title.trim().toLowerCase() &&
      (!queryItem.releaseYear ||
        !w.releaseYear ||
        w.releaseYear === queryItem.releaseYear)
    ) {
      return true;
    }
    return false;
  });
}

/**
 * Caches a newly retrieved or enriched MediaWork into the persistent localStorage catalog.
 */
export function cacheWorkInPersistentCatalog(
  work: MediaWork,
  hasTmdbEnrichment = false
): CatalogMediaWork {
  const userCached = loadUserCachedWorks();
  const seedMatch = CURATED_WORKS.find(
    (s) =>
      s.id === work.id ||
      (s.wikidataId && work.wikidataId && s.wikidataId === work.wikidataId) ||
      (s.title.toLowerCase() === work.title.toLowerCase() &&
        s.releaseYear === work.releaseYear)
  );

  const existingIdx = userCached.findIndex(
    (u) =>
      u.id === work.id ||
      (u.wikidataId && work.wikidataId && u.wikidataId === work.wikidataId) ||
      (u.tmdbId && work.tmdbId && u.tmdbId === work.tmdbId) ||
      (u.title.toLowerCase() === work.title.toLowerCase() &&
        u.releaseYear === work.releaseYear)
  );

  const baseCast =
    existingIdx >= 0
      ? mergeCastLists(work.cast, userCached[existingIdx].cast)
      : work.cast;

  const finalCast = seedMatch
    ? mergeCastLists(baseCast, seedMatch.cast)
    : baseCast;

  const toSave: CatalogMediaWork = {
    ...(existingIdx >= 0 ? userCached[existingIdx] : {}),
    ...work,
    id: seedMatch?.id || work.wikidataId || work.id,
    wikidataId: work.wikidataId || seedMatch?.wikidataId,
    aliases: seedMatch?.aliases,
    cast: finalCast,
    cachedAt: new Date().toISOString(),
    isUserCached: true,
    hasTmdbEnrichment:
      hasTmdbEnrichment ||
      work.source === 'tmdb' ||
      Boolean(existingIdx >= 0 && userCached[existingIdx].hasTmdbEnrichment),
  };

  if (existingIdx >= 0) {
    userCached.splice(existingIdx, 1);
  }
  userCached.unshift(toSave);
  saveUserCachedWorks(userCached);

  return toSave;
}

export interface CacheUpdateCheckResult {
  updated: boolean;
  work: CatalogMediaWork;
  addedActorsCount: number;
  updatedActorsCount: number;
}

/**
 * Compares freshly retrieved API data against a cached entry.
 * If any actor vitality/metadata or work metadata has new or updated information,
 * updates the entry in the persistent catalog and returns updated=true.
 */
export function updateCachedWorkIfChanged(
  cachedWork: CatalogMediaWork,
  freshWork: MediaWork,
  hasTmdbEnrichment = false
): CacheUpdateCheckResult {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  const mergedCast: RawActorRecord[] = cachedWork.cast.map((a) => ({ ...a }));
  const byName = new Map<string, RawActorRecord>();
  const byWikidataId = new Map<string, RawActorRecord>();

  for (const actor of mergedCast) {
    if (actor.name) byName.set(norm(actor.name), actor);
    if (actor.wikidataId) byWikidataId.set(actor.wikidataId, actor);
  }

  let addedActorsCount = 0;
  let updatedActorsCount = 0;

  for (const apiActor of freshWork.cast) {
    if (!apiActor?.name) continue;
    const key = norm(apiActor.name);
    const existing =
      (apiActor.wikidataId ? byWikidataId.get(apiActor.wikidataId) : undefined) ||
      byName.get(key);

    if (existing) {
      let actorChanged = false;
      if (apiActor.deathDate && apiActor.deathDate !== existing.deathDate) {
        existing.deathDate = apiActor.deathDate;
        existing.deathPrecision =
          apiActor.deathPrecision || existing.deathPrecision;
        actorChanged = true;
      }
      if (apiActor.birthDate && apiActor.birthDate !== existing.birthDate) {
        existing.birthDate = apiActor.birthDate;
        existing.birthPrecision =
          apiActor.birthPrecision || existing.birthPrecision;
        actorChanged = true;
      }
      if (apiActor.character && !existing.character) {
        existing.character = apiActor.character;
        actorChanged = true;
      }
      if (apiActor.imageUrl && !existing.imageUrl) {
        existing.imageUrl = apiActor.imageUrl;
        actorChanged = true;
      }
      if (apiActor.wikipediaUrl && !existing.wikipediaUrl) {
        existing.wikipediaUrl = apiActor.wikipediaUrl;
        actorChanged = true;
      }
      if (apiActor.wikidataId && !existing.wikidataId) {
        existing.wikidataId = apiActor.wikidataId;
        byWikidataId.set(apiActor.wikidataId, existing);
        actorChanged = true;
      }
      if (actorChanged) {
        updatedActorsCount += 1;
      }
    } else {
      const copy: RawActorRecord = {
        ...apiActor,
        billingOrder: mergedCast.length + 1,
      };
      mergedCast.push(copy);
      byName.set(key, copy);
      if (copy.wikidataId) byWikidataId.set(copy.wikidataId, copy);
      addedActorsCount += 1;
    }
  }

  let metadataChanged = false;
  const nextWork: MediaWork = {
    ...cachedWork,
    cast: mergedCast,
  };

  if (freshWork.wikidataId && !cachedWork.wikidataId) {
    nextWork.wikidataId = freshWork.wikidataId;
    metadataChanged = true;
  }
  if (freshWork.tmdbId && !cachedWork.tmdbId) {
    nextWork.tmdbId = freshWork.tmdbId;
    metadataChanged = true;
  }
  if (freshWork.posterUrl && !cachedWork.posterUrl) {
    nextWork.posterUrl = freshWork.posterUrl;
    metadataChanged = true;
  }
  if (
    freshWork.directorOrCreator &&
    freshWork.directorOrCreator !== 'Cast Registry' &&
    (!cachedWork.directorOrCreator ||
      cachedWork.directorOrCreator === 'Cast Registry')
  ) {
    nextWork.directorOrCreator = freshWork.directorOrCreator;
    metadataChanged = true;
  }
  if (freshWork.description && !cachedWork.description) {
    nextWork.description = freshWork.description;
    metadataChanged = true;
  }
  if (freshWork.releaseYear && !cachedWork.releaseYear) {
    nextWork.releaseYear = freshWork.releaseYear;
    metadataChanged = true;
  }
  if (freshWork.endYear && freshWork.endYear !== cachedWork.endYear) {
    nextWork.endYear = freshWork.endYear;
    metadataChanged = true;
  }
  if (hasTmdbEnrichment && !cachedWork.hasTmdbEnrichment) {
    metadataChanged = true;
  }

  const updated =
    addedActorsCount > 0 || updatedActorsCount > 0 || metadataChanged;

  if (!updated) {
    return {
      updated: false,
      work: cachedWork,
      addedActorsCount: 0,
      updatedActorsCount: 0,
    };
  }

  const saved = cacheWorkInPersistentCatalog(
    nextWork,
    hasTmdbEnrichment || Boolean(cachedWork.hasTmdbEnrichment)
  );

  return {
    updated: true,
    work: saved,
    addedActorsCount,
    updatedActorsCount,
  };
}

/**
 * Removes a single user-cached work from localStorage.
 */
export function removeUserCachedWork(id: string): void {
  const userCached = loadUserCachedWorks().filter((w) => w.id !== id);
  saveUserCachedWorks(userCached);
}

/**
 * Clears all user-cached works from localStorage (restoring only seed works).
 */
export function clearAllUserCachedWorks(): void {
  try {
    localStorage.removeItem(CATALOG_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const SEARCH_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'and',
  'or',
  'by',
  'with',
  'from',
  'as',
  'is',
  'it',
]);

export function scoreTitleRelevance(
  query: string,
  title: string,
  aliases: string[] = []
): number {
  const q = query.trim().toLowerCase();
  const t = (title || '').trim().toLowerCase();
  if (!q || !t) return 0;

  const candidates = [t, ...aliases.map((a) => a.toLowerCase())];
  if (candidates.some((c) => c === q)) return 1000;

  const qWithoutThe = q.replace(/^the\s+/, '');
  if (
    qWithoutThe.length >= 2 &&
    candidates.some((c) => c.replace(/^the\s+/, '') === qWithoutThe)
  ) {
    return 950;
  }

  if (
    candidates.some(
      (c) =>
        c.startsWith(`${q} `) ||
        c.startsWith(`${q}:`) ||
        c.startsWith(`${q} -`) ||
        c.startsWith(`${q} –`)
    )
  ) {
    return 820;
  }

  if (candidates.some((c) => c.startsWith(q))) return 720;
  if (candidates.some((c) => c.includes(q))) return 560;

  const meaningfulTokens = q
    .split(/\s+/)
    .filter((tok) => tok.length > 1 && !SEARCH_STOPWORDS.has(tok));
  if (meaningfulTokens.length === 0) return 0;

  const matchedTokens = meaningfulTokens.filter((tok) =>
    candidates.some((c) => c.includes(tok))
  );
  if (matchedTokens.length === meaningfulTokens.length) {
    return 420;
  }
  if (
    meaningfulTokens.length >= 2 &&
    matchedTokens.length >= Math.ceil(meaningfulTokens.length * 0.65)
  ) {
    return 240;
  }

  return 0;
}

/**
 * Searches across the entire persistent local catalog (both user-cached and seed works)
 * using strict title/alias relevance so irrelevant local works never crowd out API results.
 */
export function searchPersistentCatalog(query: string): SearchResultItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const catalog = getPersistentCatalog();

  const scored: Array<{ work: CatalogMediaWork; score: number }> = [];

  for (const w of catalog) {
    let score = scoreTitleRelevance(q, w.title, w.aliases || []);

    if (score === 0 && q.length >= 4) {
      const dirLower = (w.directorOrCreator || '').toLowerCase();
      if (dirLower && dirLower.includes(q)) {
        score = 180;
      } else if (w.cast.some((c) => c.name.toLowerCase() === q)) {
        score = 160;
      }
    }

    if (score > 0) {
      scored.push({ work: w, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 6).map(({ work: w }) => ({
    id: w.id,
    wikidataId: w.wikidataId,
    tmdbId: w.tmdbId,
    title: w.title,
    releaseYear: w.releaseYear,
    endYear: w.endYear,
    mediaType: w.mediaType,
    description: w.description,
    posterUrl: w.posterUrl,
    castCountHint: w.cast.length,
    source: 'curated',
  }));
}
