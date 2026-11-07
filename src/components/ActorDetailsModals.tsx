import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Clapperboard,
  Database,
  ExternalLink,
  Film,
  Loader2,
  Search,
  Sparkles,
  Tv,
  X,
} from 'lucide-react';
import {
  actorCreditToSearchResult,
  fetchActorDetails,
  fetchActorFilmography,
  type ActorCreditItem,
  type ActorFullDetails,
} from '../services/actorDetailsService';
import type { CatalogMediaWork } from '../services/catalogStorage';
import type { EvaluatedActor, SearchResultItem } from '../types/media';

interface ActorDetailsModalsProps {
  actor: EvaluatedActor | null;
  currentWorkTitle: string;
  tmdbKey: string;
  catalogWorks: CatalogMediaWork[];
  onClose: () => void;
  onSelectWork: (item: SearchResultItem) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ActorDetailsModals({
  actor,
  currentWorkTitle,
  tmdbKey,
  catalogWorks,
  onClose,
  onSelectWork,
}: ActorDetailsModalsProps) {
  const [details, setDetails] = useState<ActorFullDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [imgError, setImgError] = useState(false);

  const [isFilmographyOpen, setIsFilmographyOpen] = useState(false);
  const [credits, setCredits] = useState<ActorCreditItem[]>([]);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);
  const [creditFilter, setCreditFilter] = useState('');

  const hasConfiguredTmdb = Boolean(tmdbKey.trim());

  // Reset and fetch actor details when actor changes
  useEffect(() => {
    if (!actor) {
      setDetails(null);
      setIsFilmographyOpen(false);
      setCredits([]);
      setCreditFilter('');
      setImgError(false);
      return;
    }

    let cancelled = false;
    setImgError(false);
    setIsFilmographyOpen(false);
    setCredits([]);
    setCreditFilter('');
    setIsLoadingDetails(true);

    fetchActorDetails(actor, tmdbKey)
      .then((res) => {
        if (!cancelled) {
          setDetails(res);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetails({
            wiki: {
              wikidataId: actor.wikidataId,
              wikipediaUrl: actor.wikipediaUrl,
              causeOfDeath: actor.causeOfDeath,
              thumbnailUrl: actor.imageUrl,
            },
            tmdb: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDetails(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actor, tmdbKey]);

  // Fetch filmography when the user opens the filmography dialog
  useEffect(() => {
    if (!actor || !isFilmographyOpen) return;
    let cancelled = false;
    setIsLoadingCredits(true);

    fetchActorFilmography(actor, details, catalogWorks, tmdbKey)
      .then((list) => {
        if (!cancelled) {
          setCredits(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCredits([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCredits(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actor, isFilmographyOpen, details, catalogWorks, tmdbKey]);

  // Handle Escape key (close filmography dialog first if open, otherwise close actor details dialog)
  useEffect(() => {
    if (!actor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFilmographyOpen) {
          setIsFilmographyOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actor, isFilmographyOpen, onClose]);

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

  if (!actor) return null;

  const isAlive = actor.status === 'alive';
  const portraitSrc =
    actor.imageUrl ||
    details?.wiki.thumbnailUrl ||
    (hasConfiguredTmdb ? details?.tmdb?.profileUrl : undefined);

  const showTmdbSection =
    hasConfiguredTmdb &&
    details?.tmdb !== null &&
    details?.tmdb !== undefined &&
    Boolean(
      details.tmdb.biography ||
        details.tmdb.placeOfBirth ||
        details.tmdb.knownForDepartment ||
        details.tmdb.tmdbPageUrl
    );

  const handleSelectCredit = (credit: ActorCreditItem) => {
    const searchItem = actorCreditToSearchResult(credit);
    setIsFilmographyOpen(false);
    onClose();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    onSelectWork(searchItem);
  };

  return (
    <>
      {/* Dialog 1: Actor Details Dialog */}
      <div
        className="modal-backdrop actor-details-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="actor-details-modal-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="modal-card actor-details-modal-card">
          <div className="modal-header">
            <div className="actor-details-header-main">
              <div className="actor-details-avatar">
                {portraitSrc && !imgError ? (
                  <img
                    src={portraitSrc}
                    alt={actor.name}
                    className="actor-portrait-img"
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <span className="actor-initials" aria-hidden="true">
                    {getInitials(actor.name)}
                  </span>
                )}
              </div>

              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <h2
                    id="actor-details-modal-title"
                    style={{
                      fontFamily: 'var(--font-serif)',
                      fontSize: '1.4rem',
                    }}
                  >
                    {actor.name}
                  </h2>
                  <span className={`actor-status-pill ${actor.status}`}>
                    {isAlive
                      ? actor.ageYears !== null
                        ? `Living · ${actor.ageYears} yrs`
                        : 'Living'
                      : actor.ageYears !== null
                      ? `Deceased · Died at ${actor.ageYears}`
                      : 'Deceased'}
                  </span>
                </div>

                <p className="actor-details-subline">
                  {actor.character ? (
                    <>
                      Credited as <strong>{actor.character}</strong> in{' '}
                      <em>{currentWorkTitle}</em>
                    </>
                  ) : (
                    <>
                      Credited cast member in <em>{currentWorkTitle}</em>
                    </>
                  )}
                </p>

                <div className="actor-details-dates">
                  <span>
                    Born: <strong>{actor.formattedBirthDate}</strong>
                    {details?.wiki.birthPlace
                      ? ` (${details.wiki.birthPlace})`
                      : ''}
                  </span>
                  {!isAlive && (
                    <span>
                      Died:{' '}
                      <strong>{actor.formattedDeathDate || 'Deceased'}</strong>
                      {details?.wiki.deathPlace
                        ? ` (${details.wiki.deathPlace})`
                        : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close actor details dialog"
            >
              <X size={16} />
            </button>
          </div>

          <div className="actor-details-body">
            {isLoadingDetails ? (
              <div className="actor-details-loading">
                <Loader2 size={18} className="spin-icon" />
                <span>Retrieving actor biography and details...</span>
              </div>
            ) : (
              <>
                {/* Wikipedia & Wikidata Details Section */}
                <div className="actor-source-section">
                  <div className="actor-source-header">
                    <div className="actor-source-title">
                      <BookOpen size={15} />
                      <span>Wikipedia &amp; Wikidata Details</span>
                    </div>

                    <div className="actor-source-links">
                      {details?.wiki.wikipediaUrl && (
                        <a
                          href={details.wiki.wikipediaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="actor-external-badge-link"
                        >
                          <span>Wikipedia</span>
                          <ExternalLink size={12} />
                        </a>
                      )}
                      {details?.wiki.wikidataUrl && (
                        <a
                          href={details.wiki.wikidataUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="actor-external-badge-link"
                        >
                          <Database size={12} />
                          <span>
                            Wikidata ({details.wiki.wikidataId})
                          </span>
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  </div>

                  {details?.wiki.shortDescription && (
                    <div className="actor-source-short-desc">
                      {details.wiki.shortDescription}
                    </div>
                  )}

                  {details?.wiki.extract ? (
                    <p className="actor-source-bio">{details.wiki.extract}</p>
                  ) : (
                    <p className="actor-source-bio muted">
                      Biographical summary from Wikipedia/Wikidata for{' '}
                      {actor.name} ({actor.statusSummary}).
                    </p>
                  )}

                  {(details?.wiki.birthPlace ||
                    details?.wiki.deathPlace ||
                    details?.wiki.causeOfDeath) && (
                    <div className="actor-source-meta-grid">
                      {details.wiki.birthPlace && (
                        <div className="actor-meta-item">
                          <span className="actor-meta-label">
                            Place of Birth
                          </span>
                          <span className="actor-meta-val">
                            {details.wiki.birthPlace}
                          </span>
                        </div>
                      )}
                      {!isAlive && details.wiki.deathPlace && (
                        <div className="actor-meta-item">
                          <span className="actor-meta-label">
                            Place of Passing
                          </span>
                          <span className="actor-meta-val">
                            {details.wiki.deathPlace}
                          </span>
                        </div>
                      )}
                      {!isAlive && details.wiki.causeOfDeath && (
                        <div className="actor-meta-item">
                          <span className="actor-meta-label">
                            Cause of Passing
                          </span>
                          <span className="actor-meta-val">
                            {details.wiki.causeOfDeath}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* TMDB Details Section — ONLY shown if TMDB is configured AND TMDB data is available */}
                {showTmdbSection && details?.tmdb && (
                  <div className="actor-source-section tmdb-section">
                    <div className="actor-source-header">
                      <div className="actor-source-title tmdb">
                        <Sparkles size={15} />
                        <span>TMDB Actor Details</span>
                      </div>

                      <div className="actor-source-links">
                        <a
                          href={details.tmdb.tmdbPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="actor-external-badge-link tmdb"
                        >
                          <span>TMDB Profile</span>
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>

                    <div className="actor-source-meta-grid">
                      {details.tmdb.knownForDepartment && (
                        <div className="actor-meta-item">
                          <span className="actor-meta-label">Department</span>
                          <span className="actor-meta-val">
                            {details.tmdb.knownForDepartment}
                          </span>
                        </div>
                      )}
                      {details.tmdb.placeOfBirth && (
                        <div className="actor-meta-item">
                          <span className="actor-meta-label">
                            Place of Birth (TMDB)
                          </span>
                          <span className="actor-meta-val">
                            {details.tmdb.placeOfBirth}
                          </span>
                        </div>
                      )}
                    </div>

                    {details.tmdb.biography && (
                      <p className="actor-source-bio">
                        {details.tmdb.biography.length > 650
                          ? `${details.tmdb.biography.slice(0, 650).trim()}…`
                          : details.tmdb.biography}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Action to open second dialog listing all movies & TV shows for this actor */}
            <div className="actor-filmography-cta-box">
              <div>
                <div className="actor-filmography-cta-title">
                  Explore {actor.name}&apos;s Filmography
                </div>
                <div className="actor-filmography-cta-sub">
                  View a complete list of movies and TV shows {actor.name}{' '}
                  appeared in and jump directly to any title.
                </div>
              </div>

              <button
                type="button"
                id="open-actor-filmography-btn"
                className="cast-connections-open-btn"
                onClick={() => setIsFilmographyOpen(true)}
              >
                <Clapperboard size={16} />
                <span>List All Movies &amp; Shows</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dialog 2: Actor Filmography (All Movies & Shows) Dialog */}
      {isFilmographyOpen && (
        <div
          className="modal-backdrop actor-filmography-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="actor-filmography-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsFilmographyOpen(false);
            }
          }}
        >
          <div className="modal-card actor-filmography-modal-card">
            <div className="modal-header">
              <div>
                <h2
                  id="actor-filmography-modal-title"
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '1.35rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Clapperboard
                    size={18}
                    style={{ color: 'var(--alive-primary)' }}
                  />
                  Movies &amp; TV Shows — {actor.name}
                </h2>
                <p
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    marginTop: '0.2rem',
                  }}
                >
                  Click any movie or show below to return to the main page and
                  load its cast vitality analysis.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsFilmographyOpen(false)}
                aria-label="Close actor filmography dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div className="actor-filmography-toolbar">
              <div className="cast-filter-input-wrap" style={{ flex: 1 }}>
                <Search size={14} style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="cast-filter-input"
                  placeholder={`Filter ${actor.name}'s movies or roles...`}
                  value={creditFilter}
                  onChange={(e) => setCreditFilter(e.target.value)}
                />
                {creditFilter && (
                  <button
                    type="button"
                    onClick={() => setCreditFilter('')}
                    aria-label="Clear filmography filter"
                    style={{
                      color: 'var(--text-muted)',
                      display: 'inline-flex',
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <span className="collaborator-count-badge">
                {filteredCredits.length}{' '}
                {filteredCredits.length === 1 ? 'title' : 'titles'}
              </span>
            </div>

            <div className="actor-connections-list">
              {isLoadingCredits ? (
                <div className="actor-details-loading">
                  <Loader2 size={18} className="spin-icon" />
                  <span>
                    Loading movies and TV shows for {actor.name}...
                  </span>
                </div>
              ) : filteredCredits.length === 0 ? (
                <div className="actor-connections-empty">
                  <p>
                    {creditFilter
                      ? `No movies or shows matching "${creditFilter}".`
                      : `No additional movie or TV credits found for ${actor.name}.`}
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
                        href={`#select-work-${encodeURIComponent(credit.title)}`}
                        className="shared-work-link"
                        onClick={(e) => {
                          e.preventDefault();
                          handleSelectCredit(credit);
                        }}
                      >
                        <span className="shared-work-link-main">
                          {credit.mediaType === 'tv' ||
                          credit.mediaType === 'miniseries' ? (
                            <Tv size={14} />
                          ) : (
                            <Film size={14} />
                          )}
                          <span className="shared-work-title">
                            {credit.title}
                          </span>
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
      )}
    </>
  );
}
