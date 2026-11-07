import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Clapperboard,
  Film,
  Loader2,
  Search,
  Tv,
  UserSearch,
  X,
} from 'lucide-react';
import {
  actorCreditToSearchResult,
  fetchFilmographyForCandidate,
  searchActorsAcrossApis,
  type ActorCreditItem,
  type ActorSearchCandidate,
} from '../services/actorDetailsService';
import type { CatalogMediaWork } from '../services/catalogStorage';
import type { SearchResultItem } from '../types/media';

interface ActorLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalogWorks: CatalogMediaWork[];
  tmdbKey: string;
  onSelectWork: (item: SearchResultItem) => void;
}

export const ActorLookupModal: React.FC<ActorLookupModalProps> = ({
  isOpen,
  onClose,
  catalogWorks,
  tmdbKey,
  onSelectWork,
}) => {
  const [actorQuery, setActorQuery] = useState('');
  const [candidates, setCandidates] = useState<ActorSearchCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] =
    useState<ActorSearchCandidate | null>(null);
  const [credits, setCredits] = useState<ActorCreditItem[]>([]);
  const [creditFilter, setCreditFilter] = useState('');
  const [isSearchingActors, setIsSearchingActors] = useState(false);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);
  const [hasSubmittedSearch, setHasSubmittedSearch] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setActorQuery('');
      setCandidates([]);
      setSelectedCandidate(null);
      setCredits([]);
      setCreditFilter('');
      setIsSearchingActors(false);
      setIsLoadingCredits(false);
      setHasSubmittedSearch(false);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadCreditsForActor = async (candidate: ActorSearchCandidate) => {
    setSelectedCandidate(candidate);
    setCreditFilter('');
    setIsLoadingCredits(true);
    try {
      const items = await fetchFilmographyForCandidate(
        candidate,
        catalogWorks,
        tmdbKey
      );
      setCredits(items);
    } catch {
      setCredits([]);
    } finally {
      setIsLoadingCredits(false);
    }
  };

  const handleSubmitActorSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = actorQuery.trim();
    if (!trimmed) return;

    setHasSubmittedSearch(true);
    setIsSearchingActors(true);
    setCredits([]);
    setSelectedCandidate(null);

    try {
      const matchedActors = await searchActorsAcrossApis(
        trimmed,
        catalogWorks,
        tmdbKey
      );
      setCandidates(matchedActors);
      if (matchedActors.length > 0) {
        await loadCreditsForActor(matchedActors[0]);
      }
    } finally {
      setIsSearchingActors(false);
    }
  };

  const filteredCredits = useMemo(() => {
    const q = creditFilter.trim().toLowerCase();
    if (!q) return credits;
    return credits.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.character && c.character.toLowerCase().includes(q)) ||
        (c.releaseYear && String(c.releaseYear).includes(q))
    );
  }, [credits, creditFilter]);

  if (!isOpen) return null;

  const handleSelectMovieOrShow = (credit: ActorCreditItem) => {
    const searchItem = actorCreditToSearchResult(credit);
    onClose();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    onSelectWork(searchItem);
  };

  return (
    <div
      className="modal-backdrop actor-lookup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="actor-lookup-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card actor-lookup-modal-card">
        <div className="modal-header">
          <div>
            <h2
              id="actor-lookup-modal-title"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '1.35rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <UserSearch
                size={18}
                style={{ color: 'var(--alive-primary)' }}
              />
              Lookup by Actor
            </h2>
            <p
              style={{
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                marginTop: '0.2rem',
              }}
            >
              Search for any actor across{' '}
              {tmdbKey.trim()
                ? 'Wikidata, TMDB & your local catalog'
                : 'Wikidata & your local catalog'}{' '}
              to view all movies and TV shows they appeared in.
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close Lookup by Actor dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Actor Search Bar */}
        <form
          className="actor-lookup-search-form"
          onSubmit={handleSubmitActorSearch}
        >
          <div className="actor-lookup-input-wrap">
            <Search size={16} style={{ color: 'var(--text-muted)' }} />
            <input
              id="actor-lookup-search-input"
              type="text"
              className="actor-lookup-input"
              placeholder="Enter actor name (e.g. Al Pacino, Meryl Streep)..."
              value={actorQuery}
              onChange={(e) => setActorQuery(e.target.value)}
              autoFocus
            />
            {actorQuery && (
              <button
                type="button"
                onClick={() => {
                  setActorQuery('');
                  setCandidates([]);
                  setSelectedCandidate(null);
                  setCredits([]);
                  setHasSubmittedSearch(false);
                }}
                aria-label="Clear actor search"
                style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            id="actor-lookup-submit-btn"
            className="search-submit-btn"
            disabled={isSearchingActors || isLoadingCredits || !actorQuery.trim()}
          >
            {isSearchingActors ? 'Searching...' : 'Search Actor'}
          </button>
        </form>

        {/* Matching Actor Candidates Strip (if multiple actors match) */}
        {candidates.length > 1 && (
          <div className="actor-candidates-strip">
            <span className="preset-label">Matching Actors:</span>
            {candidates.slice(0, 6).map((cand) => {
              const isSelected = selectedCandidate?.id === cand.id;
              return (
                <button
                  key={cand.id}
                  type="button"
                  className={`preset-chip ${isSelected ? 'selected' : ''}`}
                  onClick={() => void loadCreditsForActor(cand)}
                >
                  <span>{cand.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Selected Actor Header & Filmography Filter */}
        {selectedCandidate && (
          <div className="actor-lookup-selected-bar">
            <div className="actor-lookup-selected-identity">
              <Clapperboard
                size={15}
                style={{ color: 'var(--alive-primary)', flexShrink: 0 }}
              />
              <div>
                <span className="actor-lookup-selected-name">
                  {selectedCandidate.name}
                </span>
                {selectedCandidate.description && (
                  <span className="actor-lookup-selected-desc">
                    {' '}
                    · {selectedCandidate.description}
                  </span>
                )}
              </div>
            </div>

            {credits.length > 0 && (
              <div className="actor-lookup-filter-row">
                <div className="cast-filter-input-wrap" style={{ flex: 1 }}>
                  <Search size={13} style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="cast-filter-input"
                    placeholder={`Filter ${selectedCandidate.name}'s movies or shows...`}
                    value={creditFilter}
                    onChange={(e) => setCreditFilter(e.target.value)}
                  />
                  {creditFilter && (
                    <button
                      type="button"
                      onClick={() => setCreditFilter('')}
                      aria-label="Clear title filter"
                      style={{
                        color: 'var(--text-muted)',
                        display: 'inline-flex',
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <span className="collaborator-count-badge">
                  {filteredCredits.length}{' '}
                  {filteredCredits.length === 1 ? 'title' : 'titles'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Movies & Shows Results List */}
        <div className="actor-connections-list" style={{ marginTop: '0.5rem' }}>
          {isSearchingActors || isLoadingCredits ? (
            <div className="actor-details-loading">
              <Loader2 size={18} className="spin-icon" />
              <span>
                {isSearchingActors
                  ? `Searching configured APIs for "${actorQuery}"...`
                  : `Loading movies and TV shows for ${
                      selectedCandidate?.name || actorQuery
                    }...`}
              </span>
            </div>
          ) : !hasSubmittedSearch ? (
            <div className="actor-connections-empty">
              <UserSearch size={24} style={{ color: 'var(--text-muted)' }} />
              <p>
                Enter an actor&apos;s name above and press{' '}
                <strong>Search Actor</strong> to list all movies and TV shows
                they appeared in.
              </p>
            </div>
          ) : candidates.length === 0 ? (
            <div className="actor-connections-empty">
              <p>
                No matching actors found for &ldquo;{actorQuery}&rdquo;. Please
                check the spelling or try another name.
              </p>
            </div>
          ) : filteredCredits.length === 0 ? (
            <div className="actor-connections-empty">
              <p>
                {creditFilter
                  ? `No movies or shows matching "${creditFilter}".`
                  : `No movies or TV shows found for ${selectedCandidate?.name}.`}
              </p>
            </div>
          ) : (
            <ul className="shared-works-list">
              {filteredCredits.map((credit) => (
                <li
                  key={`${credit.id}-${credit.title}-${
                    credit.releaseYear || ''
                  }`}
                >
                  <a
                    href={`#actor-work-${encodeURIComponent(credit.title)}`}
                    className="shared-work-link"
                    onClick={(e) => {
                      e.preventDefault();
                      handleSelectMovieOrShow(credit);
                    }}
                  >
                    <span className="shared-work-link-main">
                      {credit.mediaType === 'tv' ||
                      credit.mediaType === 'miniseries' ? (
                        <Tv size={14} />
                      ) : (
                        <Film size={14} />
                      )}
                      <span className="shared-work-title">{credit.title}</span>
                      {credit.releaseYear && (
                        <span className="shared-work-year">
                          ({credit.releaseYear})
                        </span>
                      )}
                      {credit.character && (
                        <span className="actor-credit-role">
                          as {credit.character}
                        </span>
                      )}
                    </span>
                    <span className="shared-work-link-cta">
                      <span>
                        {credit.mediaType === 'tv'
                          ? 'TV Series'
                          : credit.mediaType === 'miniseries'
                          ? 'Miniseries'
                          : 'Movie'}
                      </span>
                      <ArrowUpRight size={14} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
