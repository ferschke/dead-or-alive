import type {
  DataSourceType,
  EvaluatedActor,
  MediaType,
  SearchResultItem,
} from '../types/media';
import type { CatalogMediaWork } from './catalogStorage';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_REST_SUMMARY =
  'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w342';

export interface WikiActorDetails {
  wikidataId?: string;
  wikidataUrl?: string;
  wikipediaUrl?: string;
  wikipediaTitle?: string;
  shortDescription?: string;
  extract?: string;
  birthPlace?: string;
  deathPlace?: string;
  causeOfDeath?: string;
  thumbnailUrl?: string;
}

export interface TmdbActorDetails {
  id: number;
  name: string;
  biography?: string;
  placeOfBirth?: string;
  knownForDepartment?: string;
  birthday?: string | null;
  deathday?: string | null;
  profileUrl?: string;
  tmdbPageUrl: string;
  popularity?: number;
}

export interface ActorFullDetails {
  wiki: WikiActorDetails;
  tmdb: TmdbActorDetails | null;
}

export interface ActorCreditItem {
  id: string;
  wikidataId?: string;
  tmdbId?: number;
  title: string;
  releaseYear?: number | null;
  mediaType: MediaType;
  character?: string;
  source: DataSourceType;
}

const TV_TYPE_QIDS = new Set(['Q5398426', 'Q15416', 'Q581714']);
const MINISERIES_TYPE_QIDS = new Set(['Q1259759']);

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractWikiTitleFromUrl(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/en\.wikipedia\.org\/wiki\/([^#?]+)/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).replace(/_/g, ' ').trim();
  } catch {
    return match[1].replace(/_/g, ' ').trim();
  }
}

async function resolveWikiIdentity(actor: EvaluatedActor): Promise<{
  wikidataId?: string;
  wikipediaTitle?: string;
}> {
  let wikidataId =
    actor.wikidataId && /^Q\d+$/.test(actor.wikidataId)
      ? actor.wikidataId
      : /^Q\d+$/.test(actor.id)
      ? actor.id
      : undefined;

  let wikipediaTitle = extractWikiTitleFromUrl(actor.wikipediaUrl) || undefined;

  // If we have a Wikipedia title (or actor name) but no Q-ID, query Wikipedia pageprops
  if (!wikidataId) {
    const candidateTitle = wikipediaTitle || actor.name;
    try {
      const params = new URLSearchParams({
        action: 'query',
        titles: candidateTitle,
        redirects: '1',
        prop: 'pageprops',
        ppprop: 'wikibase_item',
        format: 'json',
        origin: '*',
      });
      const res = await fetch(`${WIKIPEDIA_API}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const pages = Object.values(data?.query?.pages || {}) as any[];
        const page = pages[0];
        if (page && page.missing === undefined) {
          if (page.title && !wikipediaTitle) {
            wikipediaTitle = page.title;
          }
          const qid = page?.pageprops?.wikibase_item;
          if (qid && /^Q\d+$/.test(qid)) {
            wikidataId = qid;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // If we still don't have a Q-ID, search Wikidata for the actor's name
  if (!wikidataId) {
    try {
      const params = new URLSearchParams({
        action: 'wbsearchentities',
        search: actor.name,
        language: 'en',
        type: 'item',
        limit: '3',
        format: 'json',
        origin: '*',
      });
      const res = await fetch(`${WIKIDATA_API}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const first = (data?.search || [])[0];
        if (first?.id && /^Q\d+$/.test(first.id)) {
          wikidataId = first.id;
        }
      }
    } catch {
      // ignore
    }
  }

  return { wikidataId, wikipediaTitle };
}

/**
 * Fetches biographical details for an actor from Wikipedia & Wikidata,
 * and (only if tmdbKey is provided and TMDB has data for this actor) from TMDB.
 */
export async function fetchActorDetails(
  actor: EvaluatedActor,
  tmdbKey?: string
): Promise<ActorFullDetails> {
  const { wikidataId, wikipediaTitle: initialWikiTitle } =
    await resolveWikiIdentity(actor);

  let wikipediaTitle = initialWikiTitle;
  let shortDescription: string | undefined;
  let birthPlace: string | undefined;
  let deathPlace: string | undefined;
  let causeOfDeath = actor.causeOfDeath;

  // 1. Fetch Wikidata entity details + place labels via SPARQL or wbgetentities
  if (wikidataId) {
    try {
      const sparql = `SELECT ?desc ?enwikiTitle ?birthPlaceLabel ?deathPlaceLabel ?causeLabel WHERE {
  BIND(wd:${wikidataId} AS ?item)
  OPTIONAL {
    ?item schema:description ?desc .
    FILTER(LANG(?desc) = "en")
  }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> ;
             schema:name ?enwikiTitle .
  }
  OPTIONAL { ?item wdt:P19 ?birthPlace . }
  OPTIONAL { ?item wdt:P20 ?deathPlace . }
  OPTIONAL { ?item wdt:P509 ?cause . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
LIMIT 1`;

      const res = await fetch(
        `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}`,
        {
          headers: { Accept: 'application/sparql-results+json' },
        }
      );
      if (res.ok) {
        const data = await res.json();
        const row = data?.results?.bindings?.[0];
        if (row) {
          if (row.desc?.value) shortDescription = row.desc.value;
          if (row.enwikiTitle?.value && !wikipediaTitle) {
            wikipediaTitle = row.enwikiTitle.value;
          }
          if (
            row.birthPlaceLabel?.value &&
            !/^Q\d+$/.test(row.birthPlaceLabel.value)
          ) {
            birthPlace = row.birthPlaceLabel.value;
          }
          if (
            row.deathPlaceLabel?.value &&
            !/^Q\d+$/.test(row.deathPlaceLabel.value)
          ) {
            deathPlace = row.deathPlaceLabel.value;
          }
          if (
            !causeOfDeath &&
            row.causeLabel?.value &&
            !/^Q\d+$/.test(row.causeLabel.value)
          ) {
            causeOfDeath = row.causeLabel.value;
          }
        }
      }
    } catch {
      // ignore SPARQL error
    }
  }

  // 2. Fetch Wikipedia REST summary extract if we have a Wikipedia title
  let extract: string | undefined;
  let thumbnailUrl: string | undefined = actor.imageUrl;
  let resolvedWikiUrl: string | undefined = actor.wikipediaUrl;

  if (wikipediaTitle) {
    try {
      const encodedTitle = encodeURIComponent(
        wikipediaTitle.replace(/ /g, '_')
      );
      const sumRes = await fetch(`${WIKIPEDIA_REST_SUMMARY}/${encodedTitle}`);
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        if (sumData?.extract) {
          extract = sumData.extract;
        }
        if (sumData?.description && !shortDescription) {
          shortDescription = sumData.description;
        }
        if (sumData?.thumbnail?.source && !thumbnailUrl) {
          thumbnailUrl = sumData.thumbnail.source;
        }
        if (sumData?.content_urls?.desktop?.page) {
          resolvedWikiUrl = sumData.content_urls.desktop.page;
        }
      }
    } catch {
      // ignore summary fetch error
    }
  }

  if (!resolvedWikiUrl && wikipediaTitle) {
    resolvedWikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(
      wikipediaTitle.replace(/ /g, '_')
    )}`;
  }

  const wikiDetails: WikiActorDetails = {
    wikidataId,
    wikidataUrl: wikidataId
      ? `https://www.wikidata.org/wiki/${wikidataId}`
      : undefined,
    wikipediaUrl: resolvedWikiUrl,
    wikipediaTitle,
    shortDescription,
    extract,
    birthPlace,
    deathPlace,
    causeOfDeath,
    thumbnailUrl,
  };

  // 3. Only query TMDB if tmdbKey is configured
  let tmdbDetails: TmdbActorDetails | null = null;
  const cleanKey = tmdbKey?.trim();
  if (cleanKey) {
    try {
      let tmdbPersonId: number | null = null;

      if (actor.id.startsWith('tmdb-')) {
        const parsed = parseInt(actor.id.replace('tmdb-', ''), 10);
        if (!isNaN(parsed)) tmdbPersonId = parsed;
      }

      if (!tmdbPersonId && wikidataId) {
        const findRes = await fetch(
          `${TMDB_BASE}/find/${encodeURIComponent(
            wikidataId
          )}?api_key=${encodeURIComponent(
            cleanKey
          )}&external_source=wikidata_id`
        );
        if (findRes.ok) {
          const findData = await findRes.json();
          const personMatch = findData?.person_results?.[0];
          if (personMatch?.id) {
            tmdbPersonId = Number(personMatch.id);
          }
        }
      }

      if (!tmdbPersonId) {
        const searchRes = await fetch(
          `${TMDB_BASE}/search/person?api_key=${encodeURIComponent(
            cleanKey
          )}&query=${encodeURIComponent(actor.name)}`
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const results: any[] = searchData?.results || [];
          const normTarget = normalizeName(actor.name);
          const exact =
            results.find((r) => normalizeName(r.name || '') === normTarget) ||
            results[0];
          if (exact?.id) {
            tmdbPersonId = Number(exact.id);
          }
        }
      }

      if (tmdbPersonId) {
        const pRes = await fetch(
          `${TMDB_BASE}/person/${tmdbPersonId}?api_key=${encodeURIComponent(
            cleanKey
          )}`
        );
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData && pData.id) {
            tmdbDetails = {
              id: Number(pData.id),
              name: pData.name || actor.name,
              biography: pData.biography?.trim() || undefined,
              placeOfBirth: pData.place_of_birth?.trim() || undefined,
              knownForDepartment: pData.known_for_department || undefined,
              birthday: pData.birthday || null,
              deathday: pData.deathday || null,
              profileUrl: pData.profile_path
                ? `${TMDB_IMG_BASE}${pData.profile_path}`
                : undefined,
              tmdbPageUrl: `https://www.themoviedb.org/person/${pData.id}`,
              popularity:
                typeof pData.popularity === 'number'
                  ? pData.popularity
                  : undefined,
            };
          }
        }
      }
    } catch {
      tmdbDetails = null;
    }
  }

  return {
    wiki: wikiDetails,
    tmdb: tmdbDetails,
  };
}

/**
 * Fetches all movies and TV shows an actor appeared in across Wikidata,
 * the persistent local catalog, and (if configured) TMDB.
 */
export async function fetchActorFilmography(
  actor: EvaluatedActor,
  details: ActorFullDetails | null,
  catalogWorks: CatalogMediaWork[],
  tmdbKey?: string
): Promise<ActorCreditItem[]> {
  const creditsByKey = new Map<string, ActorCreditItem>();

  const addOrMergeCredit = (item: ActorCreditItem) => {
    const normTitle = normalizeTitle(item.title);
    if (!normTitle || /^q\d+$/i.test(item.title.trim())) return;

    const key = `${normTitle}__${
      item.mediaType === 'miniseries' ? 'tv' : item.mediaType
    }`;

    const existingByQid = item.wikidataId
      ? Array.from(creditsByKey.values()).find(
          (c) => c.wikidataId && c.wikidataId === item.wikidataId
        )
      : undefined;
    const existingByTmdb = item.tmdbId
      ? Array.from(creditsByKey.values()).find(
          (c) => c.tmdbId && c.tmdbId === item.tmdbId
        )
      : undefined;
    const existingByTitle = creditsByKey.get(key);

    const existing = existingByQid || existingByTmdb || existingByTitle;
    if (existing) {
      if (!existing.wikidataId && item.wikidataId) {
        existing.wikidataId = item.wikidataId;
        if (existing.id.startsWith('tmdb-')) existing.id = item.wikidataId;
      }
      if (!existing.tmdbId && item.tmdbId) {
        existing.tmdbId = item.tmdbId;
      }
      if (!existing.releaseYear && item.releaseYear) {
        existing.releaseYear = item.releaseYear;
      }
      if (!existing.character && item.character) {
        existing.character = item.character;
      }
      return;
    }

    creditsByKey.set(key, { ...item });
  };

  const wikidataId =
    details?.wiki.wikidataId ||
    (actor.wikidataId && /^Q\d+$/.test(actor.wikidataId)
      ? actor.wikidataId
      : /^Q\d+$/.test(actor.id)
      ? actor.id
      : undefined);

  const normActorName = normalizeName(actor.name);

  // 1. Check persistent local catalog
  for (const work of catalogWorks) {
    const matchInCast = work.cast.find(
      (c) =>
        (wikidataId && (c.wikidataId === wikidataId || c.id === wikidataId)) ||
        normalizeName(c.name) === normActorName
    );
    if (matchInCast) {
      addOrMergeCredit({
        id: work.id,
        wikidataId:
          work.wikidataId || (/^Q\d+$/.test(work.id) ? work.id : undefined),
        tmdbId: work.tmdbId,
        title: work.title,
        releaseYear: work.releaseYear ?? null,
        mediaType: work.mediaType,
        character: matchInCast.character,
        source: work.source,
      });
    }
  }

  // 2. Query Wikidata SPARQL for all films and television shows featuring this actor
  if (wikidataId) {
    const sparql = `SELECT DISTINCT ?work ?workLabel (MIN(YEAR(?date)) AS ?year) (SAMPLE(?type) AS ?workType) (SAMPLE(?charLabel) AS ?characterName) WHERE {
  ?work wdt:P161|wdt:P725 wd:${wikidataId} .
  ?work wdt:P31 ?type .
  VALUES ?type { wd:Q11424 wd:Q24869 wd:Q202866 wd:Q506240 wd:Q5398426 wd:Q15416 wd:Q581714 wd:Q1259759 }
  OPTIONAL { ?work wdt:P577|wdt:P580 ?date . }
  OPTIONAL {
    ?work p:P161 ?statement .
    ?statement ps:P161 wd:${wikidataId} .
    ?statement pq:P453 ?char .
    ?char rdfs:label ?charLabel .
    FILTER(LANG(?charLabel) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
GROUP BY ?work ?workLabel
LIMIT 500`;

    try {
      const res = await fetch(
        `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}`,
        {
          headers: { Accept: 'application/sparql-results+json' },
        }
      );
      if (res.ok) {
        const data = await res.json();
        for (const row of data?.results?.bindings || []) {
          const workUri: string = row?.work?.value || '';
          const workQid = workUri.split('/').pop() || '';
          const workLabel: string = row?.workLabel?.value || '';
          if (!workQid || !workLabel || /^Q\d+$/.test(workLabel)) continue;

          const yrRaw = row?.year?.value
            ? parseInt(String(row.year.value), 10)
            : null;
          const releaseYear = yrRaw && !isNaN(yrRaw) ? yrRaw : null;

          const typeQid = (row?.workType?.value || '').split('/').pop() || '';
          let mediaType: MediaType = 'movie';
          if (MINISERIES_TYPE_QIDS.has(typeQid)) {
            mediaType = 'miniseries';
          } else if (TV_TYPE_QIDS.has(typeQid)) {
            mediaType = 'tv';
          }

          const character = row?.characterName?.value || undefined;

          addOrMergeCredit({
            id: workQid,
            wikidataId: workQid,
            title: workLabel,
            releaseYear,
            mediaType,
            character,
            source: 'wikidata',
          });
        }
      }
    } catch {
      // ignore SPARQL failure
    }
  }

  // 3. If TMDB API key is configured and TMDB actor ID is available, merge TMDB combined_credits
  const cleanKey = tmdbKey?.trim();
  const tmdbPersonId = details?.tmdb?.id;
  if (cleanKey && tmdbPersonId) {
    try {
      const res = await fetch(
        `${TMDB_BASE}/person/${tmdbPersonId}/combined_credits?api_key=${encodeURIComponent(
          cleanKey
        )}`
      );
      if (res.ok) {
        const data = await res.json();
        const castList: any[] = data?.cast || [];
        for (const c of castList) {
          const title = c.title || c.name;
          if (!c.id || !title) continue;
          const mediaType: MediaType = c.media_type === 'tv' ? 'tv' : 'movie';
          const dateStr = c.release_date || c.first_air_date || '';
          const yr = dateStr ? parseInt(dateStr.slice(0, 4), 10) : null;
          addOrMergeCredit({
            id: `tmdb-${mediaType}-${c.id}`,
            tmdbId: Number(c.id),
            title,
            releaseYear: yr && !isNaN(yr) ? yr : null,
            mediaType,
            character: c.character || undefined,
            source: 'tmdb',
          });
        }
      }
    } catch {
      // ignore TMDB credits error
    }
  }

  const allCredits = Array.from(creditsByKey.values());
  allCredits.sort((a, b) => {
    if (a.releaseYear && b.releaseYear && a.releaseYear !== b.releaseYear) {
      return b.releaseYear - a.releaseYear;
    }
    if (a.releaseYear && !b.releaseYear) return -1;
    if (!a.releaseYear && b.releaseYear) return 1;
    return a.title.localeCompare(b.title);
  });

  return allCredits;
}

export function actorCreditToSearchResult(
  credit: ActorCreditItem
): SearchResultItem {
  return {
    id: credit.id,
    wikidataId: credit.wikidataId,
    tmdbId: credit.tmdbId,
    title: credit.title,
    releaseYear: credit.releaseYear ?? null,
    mediaType: credit.mediaType,
    description:
      credit.mediaType === 'tv'
        ? 'Television series'
        : credit.mediaType === 'miniseries'
        ? 'Television miniseries'
        : 'Feature film',
    source: credit.source,
  };
}

export interface ActorSearchCandidate {
  id: string;
  name: string;
  wikidataId?: string;
  tmdbId?: number;
  description?: string;
  imageUrl?: string;
  source: DataSourceType;
}

/**
 * Searches for actors across all configured APIs:
 * Persistent Local Catalog, Wikidata/Wikipedia, and (if configured) TMDB.
 */
export async function searchActorsAcrossApis(
  query: string,
  catalogWorks: CatalogMediaWork[],
  tmdbKey?: string
): Promise<ActorSearchCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normQuery = normalizeName(trimmed);
  const candidatesByNormName = new Map<string, ActorSearchCandidate>();

  const upsertCandidate = (cand: ActorSearchCandidate) => {
    const key = normalizeName(cand.name);
    if (!key) return;
    const existing = candidatesByNormName.get(key);
    if (existing) {
      if (!existing.wikidataId && cand.wikidataId) {
        existing.wikidataId = cand.wikidataId;
        if (!existing.id.startsWith('Q')) existing.id = cand.wikidataId;
      }
      if (!existing.tmdbId && cand.tmdbId) {
        existing.tmdbId = cand.tmdbId;
      }
      if (!existing.imageUrl && cand.imageUrl) {
        existing.imageUrl = cand.imageUrl;
      }
      if (!existing.description && cand.description) {
        existing.description = cand.description;
      }
      return;
    }
    candidatesByNormName.set(key, { ...cand });
  };

  // 1. Check actors in persistent local catalog
  for (const work of catalogWorks) {
    for (const actor of work.cast) {
      const normActor = normalizeName(actor.name);
      if (normActor.includes(normQuery)) {
        const qid =
          actor.wikidataId && /^Q\d+$/.test(actor.wikidataId)
            ? actor.wikidataId
            : /^Q\d+$/.test(actor.id)
            ? actor.id
            : undefined;
        upsertCandidate({
          id: qid || actor.id,
          name: actor.name,
          wikidataId: qid,
          description: `Credited in ${work.title}${
            work.releaseYear ? ` (${work.releaseYear})` : ''
          }`,
          imageUrl: actor.imageUrl,
          source: 'curated',
        });
      }
    }
  }

  // 2. Search Wikidata entities and TMDB person search in parallel
  const cleanKey = tmdbKey?.trim();

  const wikidataPromise = (async (): Promise<ActorSearchCandidate[]> => {
    try {
      const searchParams = new URLSearchParams({
        action: 'wbsearchentities',
        search: trimmed,
        language: 'en',
        type: 'item',
        limit: '10',
        format: 'json',
        origin: '*',
      });
      const res = await fetch(`${WIKIDATA_API}?${searchParams.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      const hits: any[] = data?.search || [];
      const qids = hits
        .map((h) => h?.id)
        .filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id));
      if (qids.length === 0) return [];

      const entParams = new URLSearchParams({
        action: 'wbgetentities',
        ids: qids.join('|'),
        props: 'labels|descriptions|claims',
        languages: 'en',
        format: 'json',
        origin: '*',
      });
      const entRes = await fetch(`${WIKIDATA_API}?${entParams.toString()}`);
      if (!entRes.ok) return [];
      const entData = await entRes.json();
      const entities = entData?.entities || {};

      const results: ActorSearchCandidate[] = [];
      for (const qid of qids) {
        const ent = entities[qid];
        if (!ent || ent.missing !== undefined) continue;
        const claims = ent.claims || {};
        const p31Ids: string[] = (claims.P31 || [])
          .map((c: any) => c?.mainsnak?.datavalue?.value?.id)
          .filter(Boolean);
        // Must be a human (Q5)
        if (!p31Ids.includes('Q5')) continue;

        const label =
          ent.labels?.en?.value ||
          hits.find((h) => h.id === qid)?.label ||
          qid;
        const desc: string =
          ent.descriptions?.en?.value ||
          hits.find((h) => h.id === qid)?.description ||
          '';

        // Prefer people with acting/performing occupations or descriptions, or keep human matches
        const hasImage =
          claims.P18?.[0]?.mainsnak?.datavalue?.value;
        const imageUrl =
          typeof hasImage === 'string' && hasImage.trim()
            ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
                hasImage.trim()
              )}?width=240`
            : undefined;

        results.push({
          id: qid,
          name: label,
          wikidataId: qid,
          description: desc || 'Actor / Performer',
          imageUrl,
          source: 'wikidata',
        });
      }
      return results;
    } catch {
      return [];
    }
  })();

  const tmdbPromise = (async (): Promise<ActorSearchCandidate[]> => {
    if (!cleanKey) return [];
    try {
      const res = await fetch(
        `${TMDB_BASE}/search/person?api_key=${encodeURIComponent(
          cleanKey
        )}&query=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      const list: any[] = data?.results || [];
      return list.slice(0, 10).map((p) => {
        const knownForTitles = Array.isArray(p.known_for)
          ? p.known_for
              .map((k: any) => k.title || k.name)
              .filter(Boolean)
              .slice(0, 2)
              .join(', ')
          : '';
        return {
          id: `tmdb-person-${p.id}`,
          name: p.name,
          tmdbId: Number(p.id),
          description: knownForTitles
            ? `Known for ${knownForTitles}`
            : p.known_for_department || 'Actor',
          imageUrl: p.profile_path
            ? `${TMDB_IMG_BASE}${p.profile_path}`
            : undefined,
          source: 'tmdb' as DataSourceType,
        };
      });
    } catch {
      return [];
    }
  })();

  const [wdActors, tmdbActors] = await Promise.all([
    wikidataPromise,
    tmdbPromise,
  ]);

  for (const a of wdActors) upsertCandidate(a);
  for (const a of tmdbActors) upsertCandidate(a);

  const merged = Array.from(candidatesByNormName.values());
  merged.sort((a, b) => {
    const na = normalizeName(a.name);
    const nb = normalizeName(b.name);
    const exactA = na === normQuery ? 1 : 0;
    const exactB = nb === normQuery ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    const startsA = na.startsWith(normQuery) ? 1 : 0;
    const startsB = nb.startsWith(normQuery) ? 1 : 0;
    if (startsA !== startsB) return startsB - startsA;
    const actorDescA = /actor|actress|performer|known for|credited/i.test(
      a.description || ''
    )
      ? 1
      : 0;
    const actorDescB = /actor|actress|performer|known for|credited/i.test(
      b.description || ''
    )
      ? 1
      : 0;
    return actorDescB - actorDescA;
  });

  return merged.slice(0, 10);
}

/**
 * Fetches all movies and TV shows for an ActorSearchCandidate using all configured APIs.
 */
export async function fetchFilmographyForCandidate(
  candidate: ActorSearchCandidate,
  catalogWorks: CatalogMediaWork[],
  tmdbKey?: string
): Promise<ActorCreditItem[]> {
  let wikidataId = candidate.wikidataId;
  let tmdbId = candidate.tmdbId;
  const cleanKey = tmdbKey?.trim();

  // If we have tmdbId and tmdbKey but no wikidataId, check TMDB external_ids
  if (!wikidataId && tmdbId && cleanKey) {
    try {
      const res = await fetch(
        `${TMDB_BASE}/person/${tmdbId}/external_ids?api_key=${encodeURIComponent(
          cleanKey
        )}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.wikidata_id && /^Q\d+$/.test(data.wikidata_id)) {
          wikidataId = data.wikidata_id;
        }
      }
    } catch {
      // ignore
    }
  }

  // If we have wikidataId and tmdbKey but no tmdbId, resolve via TMDB /find
  if (wikidataId && !tmdbId && cleanKey) {
    try {
      const findRes = await fetch(
        `${TMDB_BASE}/find/${encodeURIComponent(
          wikidataId
        )}?api_key=${encodeURIComponent(cleanKey)}&external_source=wikidata_id`
      );
      if (findRes.ok) {
        const findData = await findRes.json();
        const personMatch = findData?.person_results?.[0];
        if (personMatch?.id) {
          tmdbId = Number(personMatch.id);
        }
      }
    } catch {
      // ignore
    }
  }

  const syntheticActor: EvaluatedActor = {
    id: wikidataId || candidate.id,
    wikidataId,
    name: candidate.name,
    billingOrder: 1,
    birthDate: null,
    deathDate: null,
    status: 'unknown',
    ageYears: null,
    yearsSinceDeath: null,
    formattedBirthDate: 'Unknown',
    formattedDeathDate: null,
    statusSummary: '',
  };

  const syntheticDetails: ActorFullDetails = {
    wiki: { wikidataId },
    tmdb: tmdbId
      ? {
          id: tmdbId,
          name: candidate.name,
          tmdbPageUrl: `https://www.themoviedb.org/person/${tmdbId}`,
        }
      : null,
  };

  return fetchActorFilmography(
    syntheticActor,
    syntheticDetails,
    catalogWorks,
    tmdbKey
  );
}

