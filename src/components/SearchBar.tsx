import React, { useEffect, useRef, useState } from 'react';
import { Film, Library, Search, Tv, UserSearch, X } from 'lucide-react';
import type { CatalogMediaWork } from '../services/catalogStorage';
import type { SearchResultItem } from '../types/media';

interface SearchBarProps {
  catalogWorks: CatalogMediaWork[];
  onSearchQuery: (query: string) => Promise<SearchResultItem[]>;
  onSelectResult: (item: SearchResultItem) => void;
  onSelectCatalogId: (id: string) => void;
  onOpenActorLookup: () => void;
  activeWorkId: string | null;
  isLoadingWork: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  catalogWorks,
  onSearchQuery,
  onSelectResult,
  onSelectCatalogId,
  onOpenActorLookup,
  activeWorkId,
  isLoadingWork,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [submittedMatches, setSubmittedMatches] = useState<SearchResultItem[]>(
    []
  );
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSmallPhone, setIsSmallPhone] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 640px)').matches
      : false
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handleChange = (e: MediaQueryListEvent) => setIsSmallPhone(e.matches);
    setIsSmallPhone(mq.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        const items = await onSearchQuery(trimmed);
        if (!cancelled) {
          setResults(items);
          setActiveIndex(items.length > 0 ? 0 : -1);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, onSearchQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsOpen(false);
    setIsSearching(true);
    try {
      const fresh = await onSearchQuery(trimmed);
      setResults(fresh);
      setSubmittedMatches(fresh.slice(0, 6));
      if (fresh.length > 0) {
        const chosen =
          activeIndex >= 0 && activeIndex < fresh.length
            ? fresh[activeIndex]
            : fresh[0];
        onSelectResult(chosen);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <section className="search-section" aria-label="Search Movie or Show">
      <div className="search-bar-container" ref={containerRef}>
        <form className="search-form" onSubmit={handleSubmit}>
          <Search
            size={isSmallPhone ? 16 : 19}
            className="search-icon"
            aria-hidden="true"
          />
          <input
            id="media-title-search-input"
            type="text"
            className="search-input"
            placeholder={
              isSmallPhone ? 'Movie or show...' : 'Search movie or TV show'
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              if (query.trim().length >= 1) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />

          {query && (
            <button
              type="button"
              id="clear-search-input-btn"
              className="search-clear-btn"
              onClick={() => {
                setQuery('');
                setResults([]);
                setSubmittedMatches([]);
                setIsOpen(false);
              }}
              aria-label="Clear search query"
            >
              <X size={isSmallPhone ? 14 : 16} />
            </button>
          )}

          <button
            type="submit"
            id="submit-title-query-btn"
            className="search-submit-btn"
            disabled={isSearching || isLoadingWork || !query.trim()}
          >
            {isSearching || isLoadingWork
              ? isSmallPhone
                ? '...'
                : 'Searching...'
              : isSmallPhone
              ? 'Go'
              : 'Search'}
          </button>

          <button
            type="button"
            id="open-actor-lookup-btn"
            className="actor-lookup-trigger-btn"
            onClick={onOpenActorLookup}
          >
            <UserSearch size={isSmallPhone ? 14 : 15} />
            <span>{isSmallPhone ? 'By actor' : 'Lookup by actor'}</span>
          </button>
        </form>

        {isOpen && query.trim().length >= 1 && (
          <div
            className="search-dropdown"
            role="listbox"
            aria-label="Matching movies and shows"
          >
            {isSearching && results.length === 0 ? (
              <div
                style={{
                  padding: '1rem',
                  color: 'var(--text-secondary)',
                  fontSize: '0.86rem',
                }}
              >
                Searching local catalog &amp; Wikidata / TMDB APIs...
              </div>
            ) : results.length === 0 ? (
              <div
                style={{
                  padding: '1rem',
                  color: 'var(--text-secondary)',
                  fontSize: '0.86rem',
                }}
              >
                No matching movies or shows found for &ldquo;{query}&rdquo;.
              </div>
            ) : (
              results.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={idx === activeIndex}
                  className={`search-result-item ${
                    idx === activeIndex ? 'active' : ''
                  }`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    setIsOpen(false);
                    setQuery(item.title);
                    setSubmittedMatches(results.slice(0, 6));
                    onSelectResult(item);
                  }}
                >
                  {item.posterUrl ? (
                    <img
                      src={item.posterUrl}
                      alt=""
                      className="search-result-thumb"
                      loading="lazy"
                    />
                  ) : (
                    <div className="search-result-thumb">
                      {item.mediaType === 'tv' ||
                      item.mediaType === 'miniseries' ? (
                        <Tv size={16} />
                      ) : (
                        <Film size={16} />
                      )}
                    </div>
                  )}

                  <div className="search-result-body">
                    <div className="search-result-title-row">
                      <span className="search-result-title">{item.title}</span>
                      {item.releaseYear && (
                        <span className="search-result-year">
                          ({item.releaseYear}
                          {item.endYear && item.endYear !== item.releaseYear
                            ? `–${item.endYear}`
                            : ''}
                          )
                        </span>
                      )}
                      <span className="media-type-tag">
                        {item.mediaType === 'tv'
                          ? 'TV Series'
                          : item.mediaType === 'miniseries'
                          ? 'Miniseries'
                          : 'Film'}
                      </span>
                      <span
                        className="media-type-tag"
                        style={{
                          color:
                            item.source === 'curated'
                              ? 'var(--alive-text)'
                              : 'var(--accent-gold)',
                        }}
                      >
                        {item.source === 'curated'
                          ? 'Cached in Catalog'
                          : item.source === 'tmdb'
                          ? 'TMDB API'
                          : 'Wikidata API'}
                      </span>
                      {item.castCountHint !== undefined &&
                        item.castCountHint > 0 && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              color: 'var(--text-muted)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {item.castCountHint}+ cast
                          </span>
                        )}
                    </div>
                    <div className="search-result-desc">{item.description}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {submittedMatches.length > 1 && (
        <div
          className="preset-strip"
          style={{
            padding: '0.55rem 0.75rem',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            marginTop: '0.65rem',
          }}
        >
          <span className="preset-label">Query Matches:</span>
          {submittedMatches.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`preset-chip ${
                activeWorkId === m.id ? 'selected' : ''
              }`}
              onClick={() => onSelectResult(m)}
            >
              <span>{m.title}</span>
              {m.releaseYear && (
                <span className="preset-chip-year">{m.releaseYear}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Persistent Local Catalog Selector */}
      <div className="preset-strip" aria-label="Local Catalog">
        <div
          className="catalog-select-wrap"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            marginLeft: 'auto',
          }}
        >
          <Library size={14} style={{ color: 'var(--accent-gold)' }} />
          <select
            id="full-catalog-select"
            className="toolbar-select"
            aria-label="Browse all titles in the persistent local catalog"
            value={
              activeWorkId && catalogWorks.some((w) => w.id === activeWorkId)
                ? activeWorkId
                : ''
            }
            onChange={(e) => {
              if (e.target.value) {
                setQuery('');
                setSubmittedMatches([]);
                setIsOpen(false);
                onSelectCatalogId(e.target.value);
              }
            }}
          >
            <option value="" disabled>
              Local Catalog ({catalogWorks.length} Cached Titles)...
            </option>
            {catalogWorks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title} ({w.releaseYear || 'N/A'})
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
};
