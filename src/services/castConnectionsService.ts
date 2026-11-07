import type {
  DataSourceType,
  EvaluatedActor,
  MediaType,
  MediaWork,
  SearchResultItem,
} from '../types/media';
import type { CatalogMediaWork } from './catalogStorage';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const TMDB_BASE = 'https://api.themoviedb.org/3';

export interface SharedProduction {
  id: string;
  wikidataId?: string;
  tmdbId?: number;
  title: string;
  releaseYear?: number | null;
  mediaType: MediaType;
  source: DataSourceType;
}

export interface CastConnectionEdge {
  pairKey: string;
  actor1Id: string;
  actor2Id: string;
  sharedWorks: SharedProduction[];
}

export interface ActorCollaboratorEntry {
  otherActor: EvaluatedActor;
  sharedWorks: SharedProduction[];
}

export interface CastConnectionsGraph {
  workId: string;
  edges: CastConnectionEdge[];
  connectionsByActorId: Record<string, ActorCollaboratorEntry[]>;
  totalConnectedActors: number;
  totalUniqueSharedWorks: number;
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

function isSameProductionAsCurrent(
  candidate: {
    id?: string;
    wikidataId?: string;
    tmdbId?: number;
    title: string;
  },
  currentWork: MediaWork
): boolean {
  if (candidate.id && candidate.id === currentWork.id) return true;
  if (
    candidate.wikidataId &&
    currentWork.wikidataId &&
    candidate.wikidataId === currentWork.wikidataId
  ) {
    return true;
  }
  if (
    candidate.wikidataId &&
    currentWork.id.startsWith('Q') &&
    candidate.wikidataId === currentWork.id
  ) {
    return true;
  }
  if (
    candidate.tmdbId &&
    currentWork.tmdbId &&
    candidate.tmdbId === currentWork.tmdbId
  ) {
    return true;
  }

  const normCandidate = normalizeTitle(candidate.title);
  const normCurrent = normalizeTitle(currentWork.title);
  if (!normCandidate || !normCurrent) return false;
  if (normCandidate === normCurrent) return true;

  // Exclude omnibus re-edits of the same work (e.g. "The Godfather Saga" / "The Godfather Trilogy: 1901-1980")
  if (
    normCandidate === `${normCurrent} saga` ||
    normCandidate.startsWith(`${normCurrent} trilogy`)
  ) {
    return true;
  }

  return false;
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

/**
 * Resolves Wikidata Q-IDs for cast members using existing wikidataId/id fields
 * and batched Wikipedia pageprops lookups for any remaining actors.
 */
async function resolveActorWikidataIds(
  actors: EvaluatedActor[]
): Promise<Map<string, string>> {
  const actorIdToQid = new Map<string, string>();
  const pendingByTitle = new Map<string, string[]>();

  for (const actor of actors) {
    if (actor.wikidataId && /^Q\d+$/.test(actor.wikidataId)) {
      actorIdToQid.set(actor.id, actor.wikidataId);
      continue;
    }
    if (/^Q\d+$/.test(actor.id)) {
      actorIdToQid.set(actor.id, actor.id);
      continue;
    }

    const wikiTitle = extractWikiTitleFromUrl(actor.wikipediaUrl) || actor.name;
    if (wikiTitle) {
      const existing = pendingByTitle.get(wikiTitle) || [];
      existing.push(actor.id);
      pendingByTitle.set(wikiTitle, existing);
    }
  }

  const titlesToResolve = Array.from(pendingByTitle.keys());
  if (titlesToResolve.length === 0) {
    return actorIdToQid;
  }

  for (let i = 0; i < titlesToResolve.length; i += 50) {
    const batch = titlesToResolve.slice(i, i + 50);
    try {
      const params = new URLSearchParams({
        action: 'query',
        titles: batch.join('|'),
        redirects: '1',
        prop: 'pageprops',
        ppprop: 'wikibase_item',
        format: 'json',
        origin: '*',
      });
      const res = await fetch(`${WIKIPEDIA_API}?${params.toString()}`);
      if (!res.ok) continue;
      const data = await res.json();

      const redirectFromByTo = new Map<string, string[]>();
      for (const r of data?.query?.redirects || []) {
        if (r?.to && r?.from) {
          const list = redirectFromByTo.get(r.to) || [];
          list.push(r.from);
          redirectFromByTo.set(r.to, list);
        }
      }

      const normalizedFromByTo = new Map<string, string[]>();
      for (const n of data?.query?.normalized || []) {
        if (n?.to && n?.from) {
          const list = normalizedFromByTo.get(n.to) || [];
          list.push(n.from);
          normalizedFromByTo.set(n.to, list);
        }
      }

      for (const page of Object.values(data?.query?.pages || {}) as any[]) {
        const qid: string | undefined = page?.pageprops?.wikibase_item;
        const pageTitle: string | undefined = page?.title;
        if (!qid || !/^Q\d+$/.test(qid) || !pageTitle) continue;

        const candidateKeys = new Set<string>([pageTitle]);
        for (const rFrom of redirectFromByTo.get(pageTitle) || []) {
          candidateKeys.add(rFrom);
          for (const nFrom of normalizedFromByTo.get(rFrom) || []) {
            candidateKeys.add(nFrom);
          }
        }
        for (const nFrom of normalizedFromByTo.get(pageTitle) || []) {
          candidateKeys.add(nFrom);
        }

        for (const key of candidateKeys) {
          const actorIds = pendingByTitle.get(key);
          if (actorIds) {
            for (const aid of actorIds) {
              if (!actorIdToQid.has(aid)) {
                actorIdToQid.set(aid, qid);
              }
            }
          }
        }
      }
    } catch {
      // Ignore network error on optional batch resolution
    }
  }

  return actorIdToQid;
}

function makeCanonicalPairKey(idA: string, idB: string): [string, string, string] {
  return idA < idB ? [`${idA}__${idB}`, idA, idB] : [`${idB}__${idA}`, idB, idA];
}

/**
 * Queries Wikidata SPARQL + persistent local catalog (and optionally TMDB)
 * to build the Cast Connections network for the current movie or TV show.
 */
export async function fetchCastConnections(
  work: MediaWork,
  actors: EvaluatedActor[],
  catalogWorks: CatalogMediaWork[],
  tmdbKey?: string
): Promise<CastConnectionsGraph> {
  const pairWorksMap = new Map<
    string,
    {
      actor1Id: string;
      actor2Id: string;
      worksByKey: Map<string, SharedProduction>;
    }
  >();

  const addSharedWorkForPair = (
    actorAId: string,
    actorBId: string,
    prod: SharedProduction
  ) => {
    if (actorAId === actorBId) return;
    if (isSameProductionAsCurrent(prod, work)) return;

    const [pairKey, actor1Id, actor2Id] = makeCanonicalPairKey(
      actorAId,
      actorBId
    );
    let entry = pairWorksMap.get(pairKey);
    if (!entry) {
      entry = {
        actor1Id,
        actor2Id,
        worksByKey: new Map<string, SharedProduction>(),
      };
      pairWorksMap.set(pairKey, entry);
    }

    const normTitleKey = `${normalizeTitle(prod.title)}__${prod.mediaType}`;
    const existingByQid = prod.wikidataId
      ? Array.from(entry.worksByKey.values()).find(
          (w) => w.wikidataId && w.wikidataId === prod.wikidataId
        )
      : undefined;
    const existingByTmdb = prod.tmdbId
      ? Array.from(entry.worksByKey.values()).find(
          (w) => w.tmdbId && w.tmdbId === prod.tmdbId
        )
      : undefined;
    const existingByTitle = entry.worksByKey.get(normTitleKey);

    const existing = existingByQid || existingByTmdb || existingByTitle;
    if (existing) {
      if (!existing.wikidataId && prod.wikidataId) {
        existing.wikidataId = prod.wikidataId;
        if (existing.id.startsWith('tmdb-')) existing.id = prod.wikidataId;
      }
      if (!existing.tmdbId && prod.tmdbId) {
        existing.tmdbId = prod.tmdbId;
      }
      if (!existing.releaseYear && prod.releaseYear) {
        existing.releaseYear = prod.releaseYear;
      }
      return;
    }

    entry.worksByKey.set(normTitleKey, { ...prod });
  };

  // 1. Resolve Wikidata Q-IDs for cast members
  const actorIdToQid = await resolveActorWikidataIds(actors);
  const qidToActorId = new Map<string, string>();
  const normNameToActorId = new Map<string, string>();

  for (const actor of actors) {
    const qid = actorIdToQid.get(actor.id);
    if (qid && !qidToActorId.has(qid)) {
      qidToActorId.set(qid, actor.id);
    }
    const norm = normalizeName(actor.name);
    if (norm && !normNameToActorId.has(norm)) {
      normNameToActorId.set(norm, actor.id);
    }
  }

  // 2. Check all works in the persistent local catalog for co-appearances
  for (const catWork of catalogWorks) {
    if (isSameProductionAsCurrent(catWork, work)) continue;

    const matchedActorIds: string[] = [];
    const seenIds = new Set<string>();

    for (const cActor of catWork.cast) {
      let matchedId: string | undefined;
      if (cActor.wikidataId && qidToActorId.has(cActor.wikidataId)) {
        matchedId = qidToActorId.get(cActor.wikidataId);
      } else if (/^Q\d+$/.test(cActor.id) && qidToActorId.has(cActor.id)) {
        matchedId = qidToActorId.get(cActor.id);
      } else {
        const norm = normalizeName(cActor.name);
        if (norm && normNameToActorId.has(norm)) {
          matchedId = normNameToActorId.get(norm);
        }
      }

      if (matchedId && !seenIds.has(matchedId)) {
        seenIds.add(matchedId);
        matchedActorIds.push(matchedId);
      }
    }

    if (matchedActorIds.length >= 2) {
      const sharedProd: SharedProduction = {
        id: catWork.id,
        wikidataId:
          catWork.wikidataId ||
          (/^Q\d+$/.test(catWork.id) ? catWork.id : undefined),
        tmdbId: catWork.tmdbId,
        title: catWork.title,
        releaseYear: catWork.releaseYear ?? null,
        mediaType: catWork.mediaType,
        source: catWork.source,
      };

      for (let i = 0; i < matchedActorIds.length; i++) {
        for (let j = i + 1; j < matchedActorIds.length; j++) {
          addSharedWorkForPair(
            matchedActorIds[i],
            matchedActorIds[j],
            sharedProd
          );
        }
      }
    }
  }

  // 3. Query Wikidata SPARQL for shared movies & TV series across all cast members with Q-IDs
  const allQids = Array.from(qidToActorId.keys()).slice(0, 85);
  if (allQids.length >= 2) {
    const currentWorkQid =
      work.wikidataId || (/^Q\d+$/.test(work.id) ? work.id : undefined);
    const valuesList = allQids.map((q) => `wd:${q}`).join(' ');

    const sparql = `SELECT DISTINCT ?work ?workLabel ?actor1 ?actor2 (MIN(YEAR(?date)) AS ?year) (SAMPLE(?type) AS ?workType) WHERE {
  VALUES ?actor1 { ${valuesList} }
  VALUES ?actor2 { ${valuesList} }
  FILTER(STR(?actor1) < STR(?actor2))
  ?work wdt:P161|wdt:P725 ?actor1 ;
        wdt:P161|wdt:P725 ?actor2 .
  ${currentWorkQid ? `FILTER(?work != wd:${currentWorkQid})` : ''}
  ?work wdt:P31 ?type .
  VALUES ?type { wd:Q11424 wd:Q24869 wd:Q202866 wd:Q506240 wd:Q5398426 wd:Q15416 wd:Q581714 wd:Q1259759 }
  OPTIONAL { ?work wdt:P577|wdt:P580 ?date . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
GROUP BY ?work ?workLabel ?actor1 ?actor2
LIMIT 800`;

    try {
      const res = await fetch(
        `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}`,
        {
          headers: {
            Accept: 'application/sparql-results+json',
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        const bindings: any[] = data?.results?.bindings || [];

        for (const row of bindings) {
          const workUri: string = row?.work?.value || '';
          const workQid = workUri.split('/').pop() || '';
          const workLabel: string = row?.workLabel?.value || '';
          if (!workQid || !workLabel || /^Q\d+$/.test(workLabel)) continue;

          const a1Qid = (row?.actor1?.value || '').split('/').pop() || '';
          const a2Qid = (row?.actor2?.value || '').split('/').pop() || '';
          const actor1Id = qidToActorId.get(a1Qid);
          const actor2Id = qidToActorId.get(a2Qid);
          if (!actor1Id || !actor2Id) continue;

          const yearRaw = row?.year?.value
            ? parseInt(String(row.year.value), 10)
            : null;
          const releaseYear =
            yearRaw && !isNaN(yearRaw) ? yearRaw : undefined;

          const typeQid = (row?.workType?.value || '').split('/').pop() || '';
          let mediaType: MediaType = 'movie';
          if (MINISERIES_TYPE_QIDS.has(typeQid)) {
            mediaType = 'miniseries';
          } else if (TV_TYPE_QIDS.has(typeQid)) {
            mediaType = 'tv';
          }

          addSharedWorkForPair(actor1Id, actor2Id, {
            id: workQid,
            wikidataId: workQid,
            title: workLabel,
            releaseYear: releaseYear ?? null,
            mediaType,
            source: 'wikidata',
          });
        }
      }
    } catch {
      // Fallback gracefully to catalog + TMDB connections if SPARQL fails
    }
  }

  // 4. Optional TMDB enrichment if tmdbKey is configured and actors have tmdb IDs
  const cleanTmdbKey = tmdbKey?.trim();
  if (cleanTmdbKey) {
    const tmdbActors = actors
      .filter((a) => /^tmdb-\d+$/.test(a.id))
      .slice(0, 20);

    if (tmdbActors.length >= 2) {
      const creditWorksByKey = new Map<
        string,
        { prod: SharedProduction; actorIds: Set<string> }
      >();

      await Promise.allSettled(
        tmdbActors.map(async (actor) => {
          const personId = actor.id.replace('tmdb-', '');
          const res = await fetch(
            `${TMDB_BASE}/person/${personId}/combined_credits?api_key=${encodeURIComponent(
              cleanTmdbKey
            )}`
          );
          if (!res.ok) return;
          const data = await res.json();
          const castCredits: any[] = data?.cast || [];
          for (const credit of castCredits) {
            const mediaType: MediaType =
              credit.media_type === 'tv' ? 'tv' : 'movie';
            const title = credit.title || credit.name;
            if (!credit.id || !title) continue;
            const dateStr = credit.release_date || credit.first_air_date || '';
            const yr = dateStr ? parseInt(dateStr.slice(0, 4), 10) : null;
            const key = `${mediaType}-${credit.id}`;
            let item = creditWorksByKey.get(key);
            if (!item) {
              item = {
                prod: {
                  id: `tmdb-${mediaType}-${credit.id}`,
                  tmdbId: Number(credit.id),
                  title,
                  releaseYear: yr && !isNaN(yr) ? yr : null,
                  mediaType,
                  source: 'tmdb',
                },
                actorIds: new Set<string>(),
              };
              creditWorksByKey.set(key, item);
            }
            item.actorIds.add(actor.id);
          }
        })
      );

      for (const { prod, actorIds } of creditWorksByKey.values()) {
        if (actorIds.size < 2) continue;
        const ids = Array.from(actorIds);
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            addSharedWorkForPair(ids[i], ids[j], prod);
          }
        }
      }
    }
  }

  // 5. Build finalized edges and per-actor adjacency lists
  const actorById = new Map<string, EvaluatedActor>();
  for (const a of actors) {
    actorById.set(a.id, a);
  }

  const edges: CastConnectionEdge[] = [];
  const connectionsByActorId: Record<string, ActorCollaboratorEntry[]> = {};
  for (const a of actors) {
    connectionsByActorId[a.id] = [];
  }

  const uniqueWorkKeys = new Set<string>();
  const connectedActorIds = new Set<string>();

  for (const [pairKey, entry] of pairWorksMap.entries()) {
    const sharedWorks = Array.from(entry.worksByKey.values()).sort((a, b) => {
      if (a.releaseYear && b.releaseYear && a.releaseYear !== b.releaseYear) {
        return a.releaseYear - b.releaseYear;
      }
      if (a.releaseYear && !b.releaseYear) return -1;
      if (!a.releaseYear && b.releaseYear) return 1;
      return a.title.localeCompare(b.title);
    });

    if (sharedWorks.length === 0) continue;

    const actor1 = actorById.get(entry.actor1Id);
    const actor2 = actorById.get(entry.actor2Id);
    if (!actor1 || !actor2) continue;

    edges.push({
      pairKey,
      actor1Id: entry.actor1Id,
      actor2Id: entry.actor2Id,
      sharedWorks,
    });

    connectedActorIds.add(entry.actor1Id);
    connectedActorIds.add(entry.actor2Id);
    for (const sw of sharedWorks) {
      uniqueWorkKeys.add(sw.wikidataId || `${normalizeTitle(sw.title)}`);
    }

    connectionsByActorId[entry.actor1Id].push({
      otherActor: actor2,
      sharedWorks,
    });
    connectionsByActorId[entry.actor2Id].push({
      otherActor: actor1,
      sharedWorks,
    });
  }

  edges.sort((a, b) => b.sharedWorks.length - a.sharedWorks.length);

  for (const actorId of Object.keys(connectionsByActorId)) {
    connectionsByActorId[actorId].sort((a, b) => {
      if (b.sharedWorks.length !== a.sharedWorks.length) {
        return b.sharedWorks.length - a.sharedWorks.length;
      }
      return a.otherActor.billingOrder - b.otherActor.billingOrder;
    });
  }

  return {
    workId: work.id,
    edges,
    connectionsByActorId,
    totalConnectedActors: connectedActorIds.size,
    totalUniqueSharedWorks: uniqueWorkKeys.size,
  };
}

/**
 * Converts a SharedProduction into a SearchResultItem so clicking a shared movie or show
 * loads it on the main page via handleSelectResult.
 */
export function sharedProductionToSearchResult(
  prod: SharedProduction
): SearchResultItem {
  return {
    id: prod.id,
    wikidataId: prod.wikidataId,
    tmdbId: prod.tmdbId,
    title: prod.title,
    releaseYear: prod.releaseYear ?? null,
    mediaType: prod.mediaType,
    description:
      prod.mediaType === 'tv'
        ? 'Television series'
        : prod.mediaType === 'miniseries'
        ? 'Television miniseries'
        : 'Feature film',
    source: prod.source,
  };
}
