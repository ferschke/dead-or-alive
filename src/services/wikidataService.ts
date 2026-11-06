import type {
  MediaType,
  MediaWork,
  RawActorRecord,
  SearchResultItem,
} from '../types/media';
import {
  findInPersistentCatalog,
  mergeCastLists,
  scoreTitleRelevance,
  searchPersistentCatalog,
} from './catalogStorage';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const TVMAZE_API = 'https://api.tvmaze.com';

const FILM_QIDS = new Set([
  'Q11424',
  'Q24869',
  'Q202866',
  'Q506240',
  'Q226730',
  'Q24862',
  'Q17517379',
  'Q29168811',
  'Q93204',
  'Q24856',
]);

const TV_QIDS = new Set([
  'Q5398426',
  'Q15416',
  'Q581714',
  'Q63952888',
  'Q526877',
  'Q117467246',
]);

const MINISERIES_QIDS = new Set(['Q1259759', 'Q7724161']);

function commonsFileUrl(filename: string, width = 320): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    filename
  )}?width=${width}`;
}

interface WikidataTimeValue {
  time: string;
  precision: number;
}

function parseWikidataClaimTime(claims: any[] | undefined): {
  iso: string | null;
  precision?: 'day' | 'month' | 'year';
} {
  if (!claims || !Array.isArray(claims) || claims.length === 0) {
    return { iso: null };
  }
  const validClaims = claims.filter((c) => c.rank !== 'deprecated');
  const preferred =
    validClaims.find((c) => c.rank === 'preferred') || validClaims[0];
  const datavalue = preferred?.mainsnak?.datavalue;
  if (!datavalue || datavalue.type !== 'time') {
    return { iso: null };
  }
  const val: WikidataTimeValue = datavalue.value;
  if (!val?.time || val.time.startsWith('-')) return { iso: null };

  const cleaned = val.time.replace(/^\+/, '');
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { iso: null };

  const [, year, month, day] = match;
  if (val.precision === 9 || month === '00') {
    return { iso: `${year}`, precision: 'year' };
  }
  if (val.precision === 10 || day === '00') {
    return { iso: `${year}-${month}`, precision: 'month' };
  }
  return { iso: `${year}-${month}-${day}`, precision: 'day' };
}

function extractYearFromClaims(claims: any[] | undefined): number | undefined {
  const { iso } = parseWikidataClaimTime(claims);
  if (!iso) return undefined;
  const yr = parseInt(iso.slice(0, 4), 10);
  return isNaN(yr) ? undefined : yr;
}

function extractFirstStringClaim(claims: any[] | undefined): string | undefined {
  if (!claims || !Array.isArray(claims)) return undefined;
  for (const c of claims) {
    if (c.rank === 'deprecated') continue;
    const val = c?.mainsnak?.datavalue?.value;
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return undefined;
}

function extractEntityIdClaims(claims: any[] | undefined): string[] {
  if (!claims || !Array.isArray(claims)) return [];
  const ids: string[] = [];
  for (const c of claims) {
    if (c.rank === 'deprecated') continue;
    const id = c?.mainsnak?.datavalue?.value?.id;
    if (typeof id === 'string') {
      ids.push(id);
    }
  }
  return ids;
}

function classifyMediaType(
  instanceIds: string[],
  description = ''
): MediaType | null {
  for (const id of instanceIds) {
    if (MINISERIES_QIDS.has(id)) return 'miniseries';
    if (TV_QIDS.has(id)) return 'tv';
    if (FILM_QIDS.has(id)) return 'movie';
  }
  const desc = description.toLowerCase();
  if (desc.includes('miniseries')) return 'miniseries';
  if (
    desc.includes('television series') ||
    desc.includes('tv series') ||
    desc.includes('sitcom') ||
    desc.includes('television program') ||
    desc.includes('television show') ||
    desc.includes('anime series') ||
    desc.includes('drama series')
  ) {
    return 'tv';
  }
  if (
    desc.includes('film') ||
    desc.includes('movie') ||
    desc.includes('motion picture')
  ) {
    return 'movie';
  }
  return null;
}

function cleanWikipediaMediaTitle(rawTitle: string): string {
  return rawTitle
    .replace(
      /\s*\((?:\d{4}\s+)?(?:[A-Za-z-]+\s+)?(?:film|movie|TV series|television series|miniseries|series|TV program|sitcom|animated series|feature film)\)\s*$/i,
      ''
    )
    .trim();
}

function extractEntityLabel(entity: any): string | undefined {
  if (!entity) return undefined;
  if (entity?.labels?.en?.value) return entity.labels.en.value;
  if (entity?.labels?.mul?.value) return entity.labels.mul.value;
  if (entity?.labels && typeof entity.labels === 'object') {
    const first = Object.values(entity.labels)[0] as any;
    if (first?.value) return first.value;
  }
  if (entity?.sitelinks?.enwiki?.title) {
    return cleanWikipediaMediaTitle(entity.sitelinks.enwiki.title);
  }
  return undefined;
}

function detectMediaTypeFromText(
  description = '',
  titleHint = ''
): MediaType | null {
  const combined = `${description} ${titleHint}`.toLowerCase();
  if (
    /disambiguation|wikimedia list|award ceremony|golden globe|academy awards|soundtrack|music from|studio album|video game|board game|comic book|fictional character|character in|episode of|season \d|fable|defunct|species of|family of|film series|media franchise|film director|television producer|screenwriter|actor|actress|composer|cinematographer/i.test(
      combined
    )
  ) {
    return null;
  }
  if (combined.includes('miniseries')) return 'miniseries';
  if (
    /television|tv series|sitcom|anime series|drama series|comedy series|web series|tv show|limited series|animated series|tv program/i.test(
      combined
    )
  ) {
    return 'tv';
  }
  if (
    /film|movie|motion picture|animated feature|documentary|cinema/i.test(
      combined
    )
  ) {
    return 'movie';
  }
  return null;
}

const searchResultsCache = new Map<string, SearchResultItem[]>();

async function fetchEntitiesBatch(
  ids: string[],
  props = 'labels|descriptions|claims|sitelinks'
): Promise<Record<string, any>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const chunkSize = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    chunks.push(uniqueIds.slice(i, i + chunkSize));
  }

  const results: Record<string, any> = {};
  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        action: 'wbgetentities',
        ids: chunk.join('|'),
        props,
        languages: 'en|mul',
        languagefallback: '1',
        sitefilter: 'enwiki',
        format: 'json',
        origin: '*',
      });
      try {
        const res = await fetch(`${WIKIDATA_API}?${params.toString()}`);
        if (!res.ok) return;
        const text = await res.text();
        if (!text.trim().startsWith('{')) return;
        const data = JSON.parse(text);
        if (data?.entities) {
          Object.assign(results, data.entities);
        }
      } catch {
        // ignore batch chunk failure
      }
    })
  );

  return results;
}

/**
 * Searches BOTH the Persistent Local Catalog AND live APIs (Wikidata, Wikipedia, TVMaze)
 * in parallel without triggering heavy wbgetentities calls on keystrokes.
 */
export async function searchWikidataMedia(
  query: string
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const catalogMatches = searchPersistentCatalog(trimmed);
  const cacheKey = trimmed.toLowerCase();
  const cachedApiItems = searchResultsCache.get(cacheKey);

  let apiItems: SearchResultItem[] = [];

  if (cachedApiItems) {
    apiItems = cachedApiItems;
  } else {
    try {
      const wpParams = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: trimmed,
        gsrlimit: '12',
        prop: 'pageprops|pageimages|description',
        piprop: 'thumbnail',
        pithumbsize: '300',
        ppprop: 'wikibase_item',
        format: 'json',
        origin: '*',
      });

      const wdParams = new URLSearchParams({
        action: 'wbsearchentities',
        search: trimmed,
        language: 'en',
        limit: '12',
        format: 'json',
        origin: '*',
      });

      const [wdRes, wpRes, tvMazeRes] = await Promise.allSettled([
        fetch(`${WIKIDATA_API}?${wdParams.toString()}`),
        fetch(`${WIKIPEDIA_API}?${wpParams.toString()}`),
        fetch(`${TVMAZE_API}/search/shows?q=${encodeURIComponent(trimmed)}`),
      ]);

      const byQid = new Map<string, SearchResultItem>();

      if (wdRes.status === 'fulfilled' && wdRes.value.ok) {
        const text = await wdRes.value.text();
        if (text.trim().startsWith('{')) {
          const wdData = JSON.parse(text);
          for (const item of wdData?.search || []) {
            const qid = item?.id;
            const title =
              item?.label || item?.display?.label?.value || undefined;
            const desc =
              item?.description || item?.display?.description?.value || '';
            if (!qid || !title || byQid.has(qid)) continue;

            const mediaType = detectMediaTypeFromText(desc, '');
            if (!mediaType) continue;

            const yearMatch = desc.match(/\b(19\d{2}|20\d{2})\b/);
            const releaseYear = yearMatch
              ? parseInt(yearMatch[1], 10)
              : undefined;

            byQid.set(qid, {
              id: qid,
              wikidataId: qid,
              title,
              releaseYear,
              mediaType,
              description:
                desc ||
                (mediaType === 'tv' ? 'Television series' : 'Feature film'),
              source: 'wikidata',
            });
          }
        }
      }

      if (wpRes.status === 'fulfilled' && wpRes.value.ok) {
        const text = await wpRes.value.text();
        if (text.trim().startsWith('{')) {
          const wpData = JSON.parse(text);
          const pages = Object.values(wpData?.query?.pages || {}) as any[];
          pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
          for (const page of pages) {
            const qid = page?.pageprops?.wikibase_item;
            const rawTitle: string = page?.title || '';
            const desc: string = page?.description || '';
            if (!qid || !rawTitle) continue;
            if (/^(List of |Category:|Template:)/i.test(rawTitle)) continue;

            const mediaType = detectMediaTypeFromText(desc, rawTitle);
            if (!mediaType) continue;

            const cleanTitle = cleanWikipediaMediaTitle(rawTitle);
            const yearMatch = `${rawTitle} ${desc}`.match(
              /\b(19\d{2}|20\d{2})\b/
            );
            const releaseYear = yearMatch
              ? parseInt(yearMatch[1], 10)
              : undefined;

            const existing = byQid.get(qid);
            if (existing) {
              if (!existing.posterUrl && page?.thumbnail?.source) {
                existing.posterUrl = page.thumbnail.source;
              }
              if (!existing.releaseYear && releaseYear) {
                existing.releaseYear = releaseYear;
              }
              if (!existing.description && desc) {
                existing.description = desc;
              }
            } else {
              byQid.set(qid, {
                id: qid,
                wikidataId: qid,
                title: cleanTitle,
                releaseYear,
                mediaType,
                description:
                  desc ||
                  (mediaType === 'tv' ? 'Television series' : 'Feature film'),
                posterUrl: page?.thumbnail?.source,
                source: 'wikidata',
              });
            }
          }
        }
      }

      apiItems = Array.from(byQid.values());

      if (tvMazeRes.status === 'fulfilled' && tvMazeRes.value.ok) {
        try {
          const tvData = await tvMazeRes.value.json();
          for (const entry of (tvData || []).slice(0, 6)) {
            const show = entry?.show;
            if (!show?.id || !show?.name) continue;
            const releaseYear = show.premiered
              ? parseInt(String(show.premiered).slice(0, 4), 10)
              : undefined;
            const endYear = show.ended
              ? parseInt(String(show.ended).slice(0, 4), 10)
              : undefined;
            const alreadyInApi = apiItems.some(
              (a) =>
                a.title.toLowerCase() === show.name.toLowerCase() &&
                (!a.releaseYear ||
                  !releaseYear ||
                  Math.abs(a.releaseYear - releaseYear) <= 1)
            );
            if (!alreadyInApi) {
              const cleanSummary = String(show.summary || '')
                .replace(/<[^>]+>/g, '')
                .trim();
              apiItems.push({
                id: `tvmaze-${show.id}`,
                title: show.name,
                releaseYear: !isNaN(releaseYear as number)
                  ? releaseYear
                  : undefined,
                endYear: !isNaN(endYear as number) ? endYear : undefined,
                mediaType: 'tv',
                description:
                  cleanSummary ||
                  `${show.network?.name || show.webChannel?.name || 'TV'} series`,
                posterUrl: show.image?.medium || undefined,
                source: 'wikidata',
              });
            }
          }
        } catch {
          // ignore TVMaze parse error
        }
      }

      if (apiItems.length > 0) {
        searchResultsCache.set(cacheKey, apiItems);
      }
    } catch {
      // ignore network error
    }
  }

  // Combine Local Catalog matches AND API matches, deduplicating and sorting by relevance
  const combined: SearchResultItem[] = [...catalogMatches];

  for (const apiItem of apiItems) {
    const existingLocal = combined.find(
      (c) =>
        (apiItem.wikidataId &&
          (c.wikidataId === apiItem.wikidataId || c.id === apiItem.wikidataId)) ||
        (c.title.toLowerCase() === apiItem.title.toLowerCase() &&
          c.releaseYear &&
          apiItem.releaseYear &&
          Math.abs(c.releaseYear - apiItem.releaseYear) <= 1)
    );
    if (existingLocal) {
      if (!existingLocal.wikidataId && apiItem.wikidataId) {
        existingLocal.wikidataId = apiItem.wikidataId;
      }
      if (!existingLocal.posterUrl && apiItem.posterUrl) {
        existingLocal.posterUrl = apiItem.posterUrl;
      }
    } else {
      combined.push(apiItem);
    }
  }

  combined.sort((a, b) => {
    const scoreA = scoreTitleRelevance(trimmed, a.title);
    const scoreB = scoreTitleRelevance(trimmed, b.title);
    if (scoreA !== scoreB) return scoreB - scoreA;
    if (a.source === 'curated' && b.source !== 'curated') return -1;
    if (b.source === 'curated' && a.source !== 'curated') return 1;
    return 0;
  });

  return combined.slice(0, 15);
}

async function fetchSparqlFullCast(qid: string): Promise<
  Array<{
    actorQid: string;
    characterLabel?: string;
  }>
> {
  const sparql = `
SELECT DISTINCT ?actor ?charLabel WHERE {
  { wd:${qid} wdt:P161 ?actor . }
  UNION
  { wd:${qid} wdt:P725 ?actor . }
  UNION
  { ?part wdt:P179+ wd:${qid} ; wdt:P161 ?actor . }
  UNION
  { ?char wdt:P1441 wd:${qid} ; wdt:P175 ?actor . }
  OPTIONAL {
    wd:${qid} p:P161 ?stmt .
    ?stmt ps:P161 ?actor .
    ?stmt pq:P453 ?char .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 250
`;
  try {
    const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(
      sparql
    )}&format=json`;
    const res = await fetch(url, {
      headers: { Accept: 'application/sparql-results+json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const bindings = data?.results?.bindings || [];
    const items: Array<{ actorQid: string; characterLabel?: string }> = [];
    const seen = new Set<string>();

    for (const b of bindings) {
      const uri: string = b?.actor?.value || '';
      const match = uri.match(/\/(Q\d+)$/);
      if (!match) continue;
      const actorQid = match[1];
      if (seen.has(actorQid)) continue;
      seen.add(actorQid);
      items.push({
        actorQid,
        characterLabel: b?.charLabel?.value,
      });
    }
    return items;
  } catch {
    return [];
  }
}

async function fetchWikipediaCastSectionQids(enwikiTitle: string): Promise<
  Array<{
    actorQid: string;
    characterHint?: string;
  }>
> {
  try {
    const secParams = new URLSearchParams({
      action: 'parse',
      page: enwikiTitle,
      prop: 'sections',
      format: 'json',
      origin: '*',
    });
    const secRes = await fetch(`${WIKIPEDIA_API}?${secParams.toString()}`);
    if (!secRes.ok) return [];
    const secData = await secRes.json();
    const sections: any[] = secData?.parse?.sections || [];
    const castSec = sections.find((s) =>
      /^(cast|main cast|cast and characters|characters|starring)$/i.test(
        (s.line || '').trim()
      )
    );
    if (!castSec?.index) return [];

    const parseParams = new URLSearchParams({
      action: 'parse',
      page: enwikiTitle,
      section: String(castSec.index),
      prop: 'wikitext|links',
      format: 'json',
      origin: '*',
    });
    const parseRes = await fetch(`${WIKIPEDIA_API}?${parseParams.toString()}`);
    if (!parseRes.ok) return [];
    const parseData = await parseRes.json();
    const wikitext: string = parseData?.parse?.wikitext?.['*'] || '';

    const roleByPageTitle: Record<string, string> = {};
    const orderedTitles: string[] = [];
    const lineRegex = /^\*\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*(?:as|–|-|:)\s*([^\n(<]+)/gim;
    let m: RegExpExecArray | null;
    while ((m = lineRegex.exec(wikitext)) !== null) {
      const pageTitle = m[1].trim();
      const roleRaw = m[2]
        .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
        .replace(/''+/g, '')
        .trim();
      if (pageTitle && !orderedTitles.includes(pageTitle)) {
        orderedTitles.push(pageTitle);
        if (roleRaw) roleByPageTitle[pageTitle] = roleRaw.slice(0, 70);
      }
    }

    for (const linkObj of parseData?.parse?.links || []) {
      if (
        linkObj.ns === 0 &&
        linkObj['*'] &&
        !orderedTitles.includes(linkObj['*'])
      ) {
        orderedTitles.push(linkObj['*']);
      }
    }

    const cappedTitles = orderedTitles.slice(0, 150);
    if (cappedTitles.length === 0) return [];

    const titleToQid: Record<string, string> = {};
    for (let i = 0; i < cappedTitles.length; i += 50) {
      const batch = cappedTitles.slice(i, i + 50);
      const qParams = new URLSearchParams({
        action: 'query',
        titles: batch.join('|'),
        redirects: '1',
        prop: 'pageprops',
        ppprop: 'wikibase_item',
        format: 'json',
        origin: '*',
      });
      const qRes = await fetch(`${WIKIPEDIA_API}?${qParams.toString()}`);
      if (!qRes.ok) continue;
      const qData = await qRes.json();
      const redirectMap: Record<string, string> = {};
      for (const r of qData?.query?.redirects || []) {
        redirectMap[r.to] = r.from;
      }
      for (const p of Object.values(qData?.query?.pages || {}) as any[]) {
        const qid = p?.pageprops?.wikibase_item;
        if (qid && p?.title) {
          titleToQid[p.title] = qid;
          if (redirectMap[p.title]) {
            titleToQid[redirectMap[p.title]] = qid;
          }
        }
      }
    }

    const output: Array<{ actorQid: string; characterHint?: string }> = [];
    const seen = new Set<string>();
    for (const t of cappedTitles) {
      const qid = titleToQid[t];
      if (qid && !seen.has(qid)) {
        seen.add(qid);
        output.push({ actorQid: qid, characterHint: roleByPageTitle[t] });
      }
    }
    return output;
  } catch {
    return [];
  }
}

async function fetchTvMazeCast(title: string): Promise<RawActorRecord[]> {
  try {
    const sRes = await fetch(
      `${TVMAZE_API}/search/shows?q=${encodeURIComponent(title)}`
    );
    if (!sRes.ok) return [];
    const sData = await sRes.json();
    const show = sData?.[0]?.show;
    if (!show?.id) return [];

    const [castRes, guestRes] = await Promise.allSettled([
      fetch(`${TVMAZE_API}/shows/${show.id}/cast`),
      fetch(`${TVMAZE_API}/shows/${show.id}/guestcast`),
    ]);

    const combined: any[] = [];
    if (castRes.status === 'fulfilled' && castRes.value.ok) {
      combined.push(...(await castRes.value.json()));
    }
    if (guestRes.status === 'fulfilled' && guestRes.value.ok) {
      combined.push(...(await guestRes.value.json()));
    }

    const records: RawActorRecord[] = [];
    const seenNames = new Set<string>();

    for (const entry of combined) {
      const person = entry?.person;
      if (!person?.name) continue;
      const norm = person.name.trim().toLowerCase();
      if (seenNames.has(norm)) continue;
      seenNames.add(norm);

      records.push({
        id: `tvmaze-${person.id}`,
        name: person.name,
        character: entry?.character?.name || undefined,
        billingOrder: records.length + 1,
        birthDate: person.birthday || null,
        birthPrecision: 'day',
        deathDate: person.deathday || null,
        deathPrecision: 'day',
        imageUrl: person.image?.medium || undefined,
        wikipediaUrl: person.url || undefined,
        isVoice: Boolean(entry?.voice),
      });
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Fetches full MediaWork and complete cast birth/death records from Wikidata, Wikipedia Cast section, SPARQL, and TVMaze.
 */
export async function fetchWikidataWork(qid: string): Promise<MediaWork> {
  const cachedBase = findInPersistentCatalog({ id: qid, wikidataId: qid });

  if (qid.startsWith('tvmaze-')) {
    const showId = qid.replace('tvmaze-', '');
    const showRes = await fetch(`${TVMAZE_API}/shows/${showId}`);
    if (!showRes.ok) {
      if (cachedBase) return cachedBase;
      throw new Error(`TVMaze show ${showId} not found.`);
    }
    const show = await showRes.json();
    const cast = await fetchTvMazeCast(show.name);
    const releaseYear = show.premiered
      ? parseInt(String(show.premiered).slice(0, 4), 10)
      : undefined;
    const endYear = show.ended
      ? parseInt(String(show.ended).slice(0, 4), 10)
      : undefined;
    return {
      id: qid,
      title: show.name,
      releaseYear: !isNaN(releaseYear as number) ? releaseYear : undefined,
      endYear: !isNaN(endYear as number) ? endYear : undefined,
      mediaType: 'tv',
      description:
        String(show.summary || '')
          .replace(/<[^>]+>/g, '')
          .trim() || 'Television series',
      posterUrl: show.image?.medium || undefined,
      wikipediaUrl: show.url || undefined,
      source: 'wikidata',
      cast: cachedBase ? mergeCastLists(cast, cachedBase.cast) : cast,
    };
  }

  try {
    const entityMap = await fetchEntitiesBatch([qid]);
    const workEntity = entityMap[qid];
    if (!workEntity || workEntity.missing !== undefined) {
      if (cachedBase) return cachedBase;
      throw new Error(`Entity ${qid} not found on Wikidata.`);
    }

    const title = extractEntityLabel(workEntity) || cachedBase?.title || qid;
    const description =
      workEntity?.descriptions?.en?.value ||
      workEntity?.descriptions?.mul?.value ||
      cachedBase?.description ||
      '';
    const claims = workEntity?.claims || {};
    const instanceIds = extractEntityIdClaims(claims.P31);
    const mediaType =
      classifyMediaType(instanceIds, description) ||
      cachedBase?.mediaType ||
      'movie';

    const releaseYear =
      extractYearFromClaims(claims.P577) ||
      extractYearFromClaims(claims.P580) ||
      cachedBase?.releaseYear;
    const endYear = extractYearFromClaims(claims.P582) || cachedBase?.endYear;

    const tmdbIdStr =
      extractFirstStringClaim(claims.P4947) ||
      extractFirstStringClaim(claims.P4983);
    const tmdbId = tmdbIdStr ? parseInt(tmdbIdStr, 10) : cachedBase?.tmdbId;

    const enwikiTitle: string | undefined =
      workEntity?.sitelinks?.enwiki?.title;
    const wikipediaUrl = enwikiTitle
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(
          enwikiTitle.replace(/ /g, '_')
        )}`
      : cachedBase?.wikipediaUrl || `https://www.wikidata.org/wiki/${qid}`;

    const directorQids = [
      ...extractEntityIdClaims(claims.P57),
      ...extractEntityIdClaims(claims.P170),
    ].slice(0, 3);

    interface RawCastStatement {
      actorQid: string;
      characterQid?: string;
      characterLiteral?: string;
      billingOrder: number;
      isVoice: boolean;
    }

    const rawCastStatements: RawCastStatement[] = [];
    const seenActors = new Set<string>();

    const processStatements = (stmts: any[] | undefined, isVoice: boolean) => {
      if (!stmts || !Array.isArray(stmts)) return;
      stmts.forEach((stmt, idx) => {
        if (stmt.rank === 'deprecated') return;
        const actorQid = stmt?.mainsnak?.datavalue?.value?.id;
        if (!actorQid || seenActors.has(actorQid)) return;
        seenActors.add(actorQid);

        const qualifiers = stmt.qualifiers || {};
        const characterQid =
          qualifiers.P453?.[0]?.datavalue?.value?.id || undefined;
        const characterLiteral =
          qualifiers.P4633?.[0]?.datavalue?.value || undefined;
        const ordinalStr = qualifiers.P1545?.[0]?.datavalue?.value;
        const parsedOrdinal = ordinalStr ? parseInt(ordinalStr, 10) : NaN;
        const billingOrder = !isNaN(parsedOrdinal)
          ? parsedOrdinal
          : rawCastStatements.length + idx + 1;

        rawCastStatements.push({
          actorQid,
          characterQid,
          characterLiteral,
          billingOrder,
          isVoice,
        });
      });
    };

    processStatements(claims.P161, false);
    processStatements(claims.P725, true);

    const [sparqlCast, wpSectionCast, tvMazeCast] = await Promise.all([
      fetchSparqlFullCast(qid),
      enwikiTitle
        ? fetchWikipediaCastSectionQids(enwikiTitle)
        : Promise.resolve([]),
      mediaType === 'tv' || mediaType === 'miniseries'
        ? fetchTvMazeCast(title)
        : Promise.resolve([]),
    ]);

    for (const item of sparqlCast) {
      if (!seenActors.has(item.actorQid)) {
        seenActors.add(item.actorQid);
        rawCastStatements.push({
          actorQid: item.actorQid,
          characterLiteral:
            item.characterLabel && !/^Q\d+$/.test(item.characterLabel)
              ? item.characterLabel
              : undefined,
          billingOrder: rawCastStatements.length + 1,
          isVoice: false,
        });
      }
    }

    for (const item of wpSectionCast) {
      if (!seenActors.has(item.actorQid)) {
        seenActors.add(item.actorQid);
        rawCastStatements.push({
          actorQid: item.actorQid,
          characterLiteral: item.characterHint,
          billingOrder: rawCastStatements.length + 1,
          isVoice: false,
        });
      }
    }

    const cappedCast = rawCastStatements.slice(0, 300);
    const allActorQids = cappedCast.map((c) => c.actorQid);
    const allCharQids = cappedCast
      .map((c) => c.characterQid)
      .filter((id): id is string => Boolean(id));

    const [actorEntities, auxEntities, wpThumbRes] = await Promise.all([
      fetchEntitiesBatch(
        allActorQids,
        'labels|descriptions|claims|sitelinks'
      ),
      fetchEntitiesBatch([...allCharQids, ...directorQids], 'labels'),
      enwikiTitle
        ? fetch(
            `${WIKIPEDIA_API}?${new URLSearchParams({
              action: 'query',
              titles: enwikiTitle,
              prop: 'pageimages',
              piprop: 'thumbnail',
              pithumbsize: '420',
              format: 'json',
              origin: '*',
            }).toString()}`
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    let posterUrl: string | undefined = cachedBase?.posterUrl;
    if (wpThumbRes?.query?.pages) {
      const firstPage = Object.values(wpThumbRes.query.pages)[0] as any;
      if (firstPage?.thumbnail?.source) {
        posterUrl = firstPage.thumbnail.source;
      }
    }
    if (!posterUrl) {
      const imgFile =
        extractFirstStringClaim(claims.P18) ||
        extractFirstStringClaim(claims.P154);
      if (imgFile) {
        posterUrl = commonsFileUrl(imgFile, 400);
      }
    }

    const directorNames = directorQids
      .map((id) => extractEntityLabel(auxEntities[id]))
      .filter(Boolean);

    const castRecords: RawActorRecord[] = [];
    const seenNormalizedNames = new Set<string>();

    for (const stmt of cappedCast) {
      const actorEntity = actorEntities[stmt.actorQid];
      if (!actorEntity || actorEntity.missing !== undefined) continue;

      const actorClaims = actorEntity?.claims || {};
      const actorInstanceIds = extractEntityIdClaims(actorClaims.P31);
      if (actorInstanceIds.length > 0 && !actorInstanceIds.includes('Q5')) {
        continue;
      }

      const actorName = extractEntityLabel(actorEntity);
      if (!actorName) continue;
      const normName = actorName.trim().toLowerCase();
      if (seenNormalizedNames.has(normName)) continue;
      seenNormalizedNames.add(normName);

      const birthParsed = parseWikidataClaimTime(actorClaims.P569);
      const deathParsed = parseWikidataClaimTime(actorClaims.P570);

      const imageFilename = extractFirstStringClaim(actorClaims.P18);
      const imageUrl = imageFilename
        ? commonsFileUrl(imageFilename, 300)
        : undefined;

      const actorWikiTitle = actorEntity?.sitelinks?.enwiki?.title;
      const actorWikiUrl = actorWikiTitle
        ? `https://en.wikipedia.org/wiki/${encodeURIComponent(
            actorWikiTitle.replace(/ /g, '_')
          )}`
        : `https://www.wikidata.org/wiki/${stmt.actorQid}`;

      const characterName =
        stmt.characterLiteral ||
        (stmt.characterQid
          ? extractEntityLabel(auxEntities[stmt.characterQid])
          : undefined);

      castRecords.push({
        id: stmt.actorQid,
        wikidataId: stmt.actorQid,
        name: actorName,
        character: characterName,
        billingOrder: stmt.billingOrder,
        birthDate: birthParsed.iso,
        birthPrecision: birthParsed.precision,
        deathDate: deathParsed.iso,
        deathPrecision: deathParsed.precision,
        imageUrl,
        wikipediaUrl: actorWikiUrl,
        isVoice: stmt.isVoice,
      });
    }

    let mergedCast = mergeCastLists(castRecords, tvMazeCast);
    if (cachedBase) {
      mergedCast = mergeCastLists(mergedCast, cachedBase.cast);
    }

    if (mergedCast.length === 0 && cachedBase) {
      return cachedBase;
    }

    return {
      id: qid,
      wikidataId: qid,
      tmdbId: !isNaN(tmdbId as number) ? tmdbId : undefined,
      title,
      releaseYear,
      endYear,
      mediaType,
      description:
        description ||
        (mediaType === 'tv' ? 'Television series' : 'Feature film'),
      directorOrCreator:
        directorNames.length > 0
          ? directorNames.join(', ')
          : cachedBase?.directorOrCreator,
      posterUrl,
      wikipediaUrl,
      source: 'wikidata',
      cast: mergedCast,
    };
  } catch (err) {
    if (cachedBase) {
      return cachedBase;
    }
    throw err;
  }
}
