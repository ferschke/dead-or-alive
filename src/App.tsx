import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Database,
  KeyRound,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { ActorDetailsModals } from './components/ActorDetailsModals';
import { ActorLookupModal } from './components/ActorLookupModal';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { CastConnectionsSection } from './components/CastConnectionsSection';
import { CastSplitView } from './components/CastSplitView';
import { ScoreHero } from './components/ScoreHero';
import { SearchBar } from './components/SearchBar';
import {
  cacheWorkInPersistentCatalog,
  clearAllUserCachedWorks,
  findInPersistentCatalog,
  getPersistentCatalog,
  removeUserCachedWork,
  scoreTitleRelevance,
  updateCachedWorkIfChanged,
  type CatalogMediaWork,
} from './services/catalogStorage';
import {
  enrichWorkWithTmdb,
  fetchTmdbWork,
  getStoredTmdbKey,
  searchTmdbMedia,
  setStoredTmdbKey,
} from './services/tmdbService';
import {
  fetchWikidataWork,
  searchWikidataMedia,
} from './services/wikidataService';
import type {
  EvaluatedActor,
  MediaWork,
  SearchResultItem,
  SortOption,
  ViewMode,
} from './types/media';
import { analyzeCastVitality } from './utils/vitalityCalculator';

export function App() {
  const [catalogWorks, setCatalogWorks] = useState<CatalogMediaWork[]>(() =>
    getPersistentCatalog()
  );
  const [activeWork, setActiveWork] = useState<MediaWork | null>(
    () => getPersistentCatalog()[0] || null
  );
  const [queryTimestamp, setQueryTimestamp] = useState<Date>(() => new Date());

  const [isLoadingWork, setIsLoadingWork] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortOption>('billing');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [actorFilterQuery, setActorFilterQuery] = useState('');
  const [includeVoiceActors, setIncludeVoiceActors] = useState(true);
  const [highlightedActorId, setHighlightedActorId] = useState<string | null>(
    null
  );
  const [selectedActorForModal, setSelectedActorForModal] =
    useState<EvaluatedActor | null>(null);
  const [isActorLookupOpen, setIsActorLookupOpen] = useState(false);
  const [isClearCatalogConfirmOpen, setIsClearCatalogConfirmOpen] =
    useState(false);

  const [tmdbKey, setTmdbKey] = useState<string>(() => getStoredTmdbKey());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const activeRequestIdRef = useRef(0);

  const refreshCatalogState = useCallback(() => {
    setCatalogWorks(getPersistentCatalog());
  }, []);

  /**
   * Queries the configured APIs (Wikidata/Wikipedia/TVMaze and TMDB if configured)
   * for a cached catalog entry to retrieve any additional or updated information.
   */
  const fetchFreshWorkFromApis = useCallback(
    async (
      cachedWork: CatalogMediaWork,
      itemHint?: Partial<SearchResultItem>
    ): Promise<MediaWork | null> => {
      let fetchedWork: MediaWork | null = null;
      const candidateQid =
        cachedWork.wikidataId ||
        itemHint?.wikidataId ||
        (cachedWork.id.startsWith('Q') || cachedWork.id.startsWith('tvmaze-')
          ? cachedWork.id
          : undefined);

      if (candidateQid) {
        try {
          fetchedWork = await fetchWikidataWork(candidateQid);
        } catch {
          fetchedWork = null;
        }
      }

      if (!fetchedWork) {
        try {
          const wdMatches = await searchWikidataMedia(cachedWork.title);
          const matchingWd = wdMatches.find(
            (w) =>
              (w.wikidataId ||
                w.id.startsWith('Q') ||
                w.id.startsWith('tvmaze-')) &&
              w.title.toLowerCase() === cachedWork.title.toLowerCase() &&
              (!cachedWork.releaseYear ||
                !w.releaseYear ||
                Math.abs(w.releaseYear - cachedWork.releaseYear) <= 1)
          );
          if (matchingWd) {
            fetchedWork = await fetchWikidataWork(
              matchingWd.wikidataId || matchingWd.id
            );
          }
        } catch {
          fetchedWork = null;
        }
      }

      if (!fetchedWork && tmdbKey && (cachedWork.tmdbId || itemHint?.tmdbId)) {
        const tid = cachedWork.tmdbId || itemHint?.tmdbId;
        if (tid) {
          try {
            fetchedWork = await fetchTmdbWork(
              cachedWork.mediaType,
              tid,
              tmdbKey
            );
          } catch {
            fetchedWork = null;
          }
        }
      }

      if (tmdbKey) {
        const baseToEnrich = fetchedWork || cachedWork;
        try {
          fetchedWork = await enrichWorkWithTmdb(baseToEnrich, tmdbKey);
        } catch {
          // keep fetchedWork
        }
      }

      return fetchedWork;
    },
    [tmdbKey]
  );

  /**
   * After loading a cached entry, checks the Wikidata API (and TMDB API if configured)
   * to see if any cached information needs to be updated, and updates the entry if necessary.
   */
  const checkAndUpdateCachedWork = useCallback(
    async (
      cachedWork: CatalogMediaWork,
      requestId: number,
      itemHint?: Partial<SearchResultItem>
    ) => {
      try {
        const fetchedWork = await fetchFreshWorkFromApis(cachedWork, itemHint);

        if (!fetchedWork) {
          if (activeRequestIdRef.current === requestId) {
            setQueryTimestamp(new Date());
            setActiveWork({ ...cachedWork });
            setStatusNotice(
              `Loaded "${cachedWork.title}" (${cachedWork.cast.length} actors) from persistent local catalog.`
            );
          }
          return;
        }

        const checkResult = updateCachedWorkIfChanged(
          cachedWork,
          fetchedWork,
          Boolean(tmdbKey)
        );

        if (checkResult.updated) {
          refreshCatalogState();
          if (activeRequestIdRef.current === requestId) {
            setQueryTimestamp(new Date());
            setActiveWork(checkResult.work);
            setStatusNotice(
              `Loaded "${checkResult.work.title}" from cache and updated with latest ${
                tmdbKey ? 'Wikidata + TMDB' : 'Wikidata'
              } API data (${checkResult.work.cast.length} actors).`
            );
          }
        } else if (activeRequestIdRef.current === requestId) {
          setQueryTimestamp(new Date());
          setActiveWork({ ...cachedWork });
          setStatusNotice(
            `Loaded "${cachedWork.title}" (${cachedWork.cast.length} actors) from persistent local catalog — verified up to date with ${
              tmdbKey ? 'Wikidata + TMDB APIs' : 'Wikidata API'
            }.`
          );
        }
      } catch {
        if (activeRequestIdRef.current === requestId) {
          setQueryTimestamp(new Date());
          setActiveWork({ ...cachedWork });
          setStatusNotice(
            `Loaded "${cachedWork.title}" (${cachedWork.cast.length} actors) from persistent local catalog.`
          );
        }
      }
    },
    [tmdbKey, refreshCatalogState, fetchFreshWorkFromApis]
  );

  // Check initial cached entry against the API on mount
  useEffect(() => {
    const initialCached = getPersistentCatalog()[0];
    if (initialCached) {
      const reqId = ++activeRequestIdRef.current;
      void checkAndUpdateCachedWork(initialCached, reqId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveTmdbKey = useCallback(
    async (key: string) => {
      setStoredTmdbKey(key);
      setTmdbKey(key);
      if (key.trim() && activeWork) {
        // Enrich current work with TMDB data and cache in persistent catalog
        setIsLoadingWork(true);
        try {
          const enriched = await enrichWorkWithTmdb(activeWork, key);
          const saved = cacheWorkInPersistentCatalog(enriched, true);
          setActiveWork(saved);
          refreshCatalogState();
          setStatusNotice(
            `Enriched "${saved.title}" with TMDB data and cached in persistent local catalog.`
          );
        } catch {
          // ignore
        } finally {
          setIsLoadingWork(false);
        }
      }
    },
    [activeWork, refreshCatalogState]
  );

  const handleSearchQuery = useCallback(
    async (query: string): Promise<SearchResultItem[]> => {
      const [wdResults, tmdbResults] = await Promise.all([
        searchWikidataMedia(query),
        tmdbKey
          ? searchTmdbMedia(query, tmdbKey).catch(() => [])
          : Promise.resolve([]),
      ]);

      // Merge results across Local Catalog, Wikidata/Wikipedia/TVMaze, and TMDB
      const merged: SearchResultItem[] = [...wdResults];
      for (const tItem of tmdbResults) {
        const existing = merged.find(
          (m) =>
            m.title.toLowerCase() === tItem.title.toLowerCase() &&
            (!m.releaseYear ||
              !tItem.releaseYear ||
              Math.abs(m.releaseYear - tItem.releaseYear) <= 1)
        );
        if (existing) {
          if (!existing.tmdbId) existing.tmdbId = tItem.tmdbId;
          if (!existing.posterUrl) existing.posterUrl = tItem.posterUrl;
        } else {
          merged.push(tItem);
        }
      }

      merged.sort((a, b) => {
        const scoreA = scoreTitleRelevance(query, a.title);
        const scoreB = scoreTitleRelevance(query, b.title);
        if (scoreA !== scoreB) return scoreB - scoreA;
        if (a.source === 'curated' && b.source !== 'curated') return -1;
        if (b.source === 'curated' && a.source !== 'curated') return 1;
        return 0;
      });

      return merged.slice(0, 15);
    },
    [tmdbKey]
  );

  const handleSelectResult = useCallback(
    async (item: SearchResultItem) => {
      const reqId = ++activeRequestIdRef.current;
      setErrorMsg(null);
      setStatusNotice(null);
      setActorFilterQuery('');
      setQueryTimestamp(new Date());

      const cachedMatch = findInPersistentCatalog({
        id: item.id,
        wikidataId: item.wikidataId,
        tmdbId: item.tmdbId,
        title: item.title,
        releaseYear: item.releaseYear,
      });

      // If entry is in the local catalog, display it immediately and always check the API for updates
      if (cachedMatch) {
        setActiveWork(cachedMatch);
        setStatusNotice(
          `Loaded "${cachedMatch.title}" (${cachedMatch.cast.length} actors) from persistent local catalog — checking API for updates...`
        );
        await checkAndUpdateCachedWork(cachedMatch, reqId, item);
        return;
      }

      setIsLoadingWork(true);
      try {
        let fetchedWork: MediaWork | null = null;

        if (
          item.wikidataId ||
          item.id.startsWith('Q') ||
          item.id.startsWith('tvmaze-')
        ) {
          const qid = item.wikidataId || item.id;
          fetchedWork = await fetchWikidataWork(qid);
        } else if (item.source === 'tmdb' && item.tmdbId && tmdbKey) {
          fetchedWork = await fetchTmdbWork(
            item.mediaType,
            item.tmdbId,
            tmdbKey
          );
          const wdMatches = await searchWikidataMedia(item.title);
          const matchingWd = wdMatches.find(
            (w) =>
              w.wikidataId &&
              w.title.toLowerCase() === item.title.toLowerCase()
          );
          if (matchingWd?.wikidataId) {
            try {
              const wdWork = await fetchWikidataWork(matchingWd.wikidataId);
              fetchedWork = await enrichWorkWithTmdb(wdWork, tmdbKey);
            } catch {
              // keep TMDB work
            }
          }
        }

        if (!fetchedWork) {
          throw new Error('Could not retrieve title from Wikidata or TMDB.');
        }

        // If TMDB API key is configured, enrich with additional TMDB data
        if (tmdbKey) {
          fetchedWork = await enrichWorkWithTmdb(fetchedWork, tmdbKey);
        }

        if (!fetchedWork.posterUrl && item.posterUrl) {
          fetchedWork.posterUrl = item.posterUrl;
        }

        // Cache the retrieved work in the persistent local catalog across sessions
        const saved = cacheWorkInPersistentCatalog(
          fetchedWork,
          Boolean(tmdbKey)
        );
        refreshCatalogState();
        if (activeRequestIdRef.current === reqId) {
          setQueryTimestamp(new Date());
          setActiveWork(saved);
          setStatusNotice(
            `Retrieved "${saved.title}" (${saved.cast.length} actors) from ${
              tmdbKey ? 'Wikidata + TMDB APIs' : 'Wikidata API'
            } and cached in persistent local catalog.`
          );
        }
      } catch {
        if (activeRequestIdRef.current === reqId) {
          setErrorMsg(
            `Could not retrieve cast data for "${item.title}". Please check your connection or try another title.`
          );
        }
      } finally {
        if (activeRequestIdRef.current === reqId) {
          setIsLoadingWork(false);
        }
      }
    },
    [tmdbKey, refreshCatalogState, checkAndUpdateCachedWork]
  );

  const handleSelectCatalogId = useCallback(
    async (id: string) => {
      const found = catalogWorks.find((w) => w.id === id);
      if (!found) return;
      const reqId = ++activeRequestIdRef.current;
      setErrorMsg(null);
      setActorFilterQuery('');
      setQueryTimestamp(new Date());
      setActiveWork(found);
      setStatusNotice(
        `Loaded "${found.title}" (${found.cast.length} actors) from persistent local catalog — checking API for updates...`
      );

      await checkAndUpdateCachedWork(found, reqId);
    },
    [catalogWorks, checkAndUpdateCachedWork]
  );

  const hasVoiceActors = useMemo(
    () => (activeWork ? activeWork.cast.some((c) => Boolean(c.isVoice)) : false),
    [activeWork]
  );

  const filteredCast = useMemo(() => {
    if (!activeWork) return [];
    if (includeVoiceActors) return activeWork.cast;
    return activeWork.cast.filter((c) => !c.isVoice);
  }, [activeWork, includeVoiceActors]);

  const analysis = useMemo(
    () =>
      activeWork
        ? analyzeCastVitality(filteredCast, queryTimestamp, queryTimestamp)
        : null,
    [activeWork, filteredCast, queryTimestamp]
  );

  const allEvaluatedActors = useMemo(
    () =>
      analysis
        ? [
            ...analysis.aliveActors,
            ...analysis.deceasedActors,
            ...analysis.unknownActors,
          ].sort((a, b) => a.billingOrder - b.billingOrder)
        : [],
    [analysis]
  );

  const handleSelectMatrixActor = (actorId: string) => {
    setHighlightedActorId(actorId);
    const el = document.getElementById(`actor-card-${actorId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => {
      setHighlightedActorId((prev) => (prev === actorId ? null : prev));
    }, 2200);
  };

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="masthead-brand">
          <div className="masthead-logo">
            Dead <span>or</span> Alive
          </div>
        </div>

        <div className="masthead-actions">
          <span
            className="source-indicator"
            style={{ cursor: 'default' }}
            title="Titles persisted in localStorage catalog across sessions"
          >
            <Database size={13} />
            <span>{catalogWorks.length} Cached in Catalog</span>
          </span>

          <button
            type="button"
            id="clear-all-catalog-btn"
            className="source-indicator"
            onClick={() => setIsClearCatalogConfirmOpen(true)}
            disabled={catalogWorks.length === 0}
            title="Clear all locally cached data from the catalog"
          >
            <Trash2 size={13} />
            <span>Clear Cache</span>
          </button>

          <button
            type="button"
            id="open-data-source-settings-btn"
            className="source-indicator"
            onClick={() => setIsSettingsOpen(true)}
            title="Open configuration dialog to provide a TMDB API key and manage the persistent catalog"
          >
            <span className={`source-dot ${tmdbKey ? 'tmdb' : ''}`} />
            <KeyRound size={13} />
            <span>
              {tmdbKey ? 'Wikidata + TMDB Active' : 'Config / TMDB API Key'}
            </span>
            <Settings2 size={13} style={{ marginLeft: '0.15rem' }} />
          </button>
        </div>
      </header>

      <main>
        <SearchBar
          catalogWorks={catalogWorks}
          onSearchQuery={handleSearchQuery}
          onSelectResult={handleSelectResult}
          onSelectCatalogId={handleSelectCatalogId}
          onOpenActorLookup={() => setIsActorLookupOpen(true)}
          activeWorkId={activeWork?.id ?? null}
          isLoadingWork={isLoadingWork}
        />

        {statusNotice && !errorMsg && (
          <div
            style={{
              padding: '0.6rem 1rem',
              marginBottom: '1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{statusNotice}</span>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}
            >
              Dismiss
            </button>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            style={{
              padding: '0.9rem 1.2rem',
              marginBottom: '1.25rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--deceased-soft)',
              border: '1px solid var(--deceased-border)',
              color: 'var(--deceased-text)',
              fontSize: '0.9rem',
            }}
          >
            {errorMsg}
          </div>
        )}

        {isLoadingWork ? (
          <div className="loading-banner" aria-live="polite">
            <div className="spinner" />
            <span>
              Retrieving full cast from Wikidata{' '}
              {tmdbKey ? '& TMDB APIs ' : 'API '}and caching in persistent
              local catalog...
            </span>
          </div>
        ) : activeWork && analysis ? (
          <>
            <ScoreHero
              work={activeWork}
              analysis={analysis}
              onSelectMatrixActor={handleSelectMatrixActor}
              hasTmdbKey={Boolean(tmdbKey.trim())}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />

            <CastConnectionsSection
              work={activeWork}
              actors={allEvaluatedActors}
              catalogWorks={catalogWorks}
              tmdbKey={tmdbKey}
              onSelectSharedWork={handleSelectResult}
            />

            <CastSplitView
              analysis={analysis}
              sortBy={sortBy}
              onChangeSortBy={setSortBy}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              actorFilterQuery={actorFilterQuery}
              onChangeActorFilterQuery={setActorFilterQuery}
              includeVoiceActors={includeVoiceActors}
              onChangeIncludeVoiceActors={setIncludeVoiceActors}
              hasVoiceActors={hasVoiceActors}
              highlightedActorId={highlightedActorId}
              onSelectActor={setSelectedActorForModal}
            />
          </>
        ) : null}
      </main>

      <ActorDetailsModals
        actor={selectedActorForModal}
        currentWorkTitle={activeWork?.title ?? ''}
        tmdbKey={tmdbKey}
        catalogWorks={catalogWorks}
        onClose={() => setSelectedActorForModal(null)}
        onSelectWork={handleSelectResult}
      />

      <ActorLookupModal
        isOpen={isActorLookupOpen}
        onClose={() => setIsActorLookupOpen(false)}
        catalogWorks={catalogWorks}
        tmdbKey={tmdbKey}
        onSelectWork={handleSelectResult}
      />

      {isClearCatalogConfirmOpen && (
        <div
          className="modal-backdrop clear-catalog-confirm-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-catalog-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsClearCatalogConfirmOpen(false);
            }
          }}
        >
          <div className="modal-card clear-catalog-confirm-card">
            <div className="modal-header">
              <h2
                id="clear-catalog-confirm-title"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '1.3rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <AlertTriangle
                  size={18}
                  style={{ color: 'var(--deceased-primary)' }}
                />
                Clear Local Catalog?
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsClearCatalogConfirmOpen(false)}
                aria-label="Close confirmation dialog"
              >
                <X size={16} />
              </button>
            </div>

            <p
              style={{
                fontSize: '0.88rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
                marginBottom: '1.25rem',
              }}
            >
              Are you sure you want to wipe the locally cached data from your
              catalog? This will remove all {catalogWorks.length} cached{' '}
              {catalogWorks.length === 1 ? 'title' : 'titles'} from your local
              browser catalog.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                id="cancel-clear-catalog-btn"
                className="btn-secondary"
                onClick={() => setIsClearCatalogConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                id="confirm-clear-catalog-btn"
                className="btn-danger"
                onClick={() => {
                  clearAllUserCachedWorks();
                  refreshCatalogState();
                  setActiveWork(null);
                  setIsClearCatalogConfirmOpen(false);
                  setStatusNotice(
                    'Cleared all locally cached data from the catalog.'
                  );
                }}
              >
                <Trash2 size={14} />
                <span>Clear Cache</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ApiSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentTmdbKey={tmdbKey}
        onSaveTmdbKey={handleSaveTmdbKey}
        catalogWorks={catalogWorks}
        onSelectCatalogWork={handleSelectCatalogId}
        onRemoveCachedWork={(id) => {
          removeUserCachedWork(id);
          refreshCatalogState();
          if (activeWork?.id === id) {
            const nextCatalog = getPersistentCatalog();
            setActiveWork(nextCatalog[0] || null);
          }
        }}
        onClearUserCache={() => {
          clearAllUserCachedWorks();
          refreshCatalogState();
          setActiveWork(null);
        }}
      />
    </div>
  );
}

export default App;
