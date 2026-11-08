import React, { useEffect, useState } from 'react';
import {
  Clock,
  ExternalLink,
  Film,
  Tv,
} from 'lucide-react';
import type {
  CastVitalityAnalysis,
  EvaluatedActor,
  MediaWork,
} from '../types/media';
import { parseIsoDate } from '../utils/vitalityCalculator';
import { fetchOmdbRatings, type OmdbRatings } from '../services/omdbService';

interface ScoreHeroProps {
  work: MediaWork;
  analysis: CastVitalityAnalysis;
  onSelectMatrixActor: (actorId: string) => void;
  hasTmdbKey?: boolean;
  omdbKey?: string;
  onOpenSettings?: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const MatrixTile: React.FC<{
  actor: EvaluatedActor;
  onClick: () => void;
}> = ({ actor, onClick }) => {
  const [imgErr, setImgErr] = useState(false);
  const tooltip = `${actor.name}${
    actor.character ? ` as ${actor.character}` : ''
  } — ${actor.statusSummary}`;

  return (
    <button
      type="button"
      className={`matrix-tile ${actor.status}`}
      title={tooltip}
      aria-label={tooltip}
      onClick={onClick}
    >
      {actor.imageUrl && !imgErr ? (
        <img
          src={actor.imageUrl}
          alt={actor.name}
          loading="lazy"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span>{getInitials(actor.name)}</span>
      )}
    </button>
  );
};

export const ScoreHero: React.FC<ScoreHeroProps> = ({
  work,
  analysis,
  onSelectMatrixActor,
  hasTmdbKey = false,
  omdbKey = '',
  onOpenSettings,
}) => {
  const [posterError, setPosterError] = useState(false);
  const [ratings, setRatings] = useState<OmdbRatings | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRatings(null);
    if (!omdbKey.trim()) return;
    fetchOmdbRatings(work, omdbKey)
      .then((r) => {
        if (!cancelled) setRatings(r);
      })
      .catch(() => {
        if (!cancelled) setRatings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [work.id, work.title, work.releaseYear, omdbKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const queryYear = analysis.queryTimestamp.getFullYear();

  const formattedQueryTimestamp = analysis.queryTimestamp.toLocaleString(
    undefined,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }
  );

  const yearDisplay = work.releaseYear
    ? work.endYear && work.endYear !== work.releaseYear
      ? `${work.releaseYear}–${work.endYear}`
      : `${work.releaseYear}`
    : '';

  const aliveWidthPct =
    analysis.totalCast > 0
      ? Math.max(
          analysis.aliveCount > 0 ? 3 : 0,
          Math.min(100, analysis.alivePercentage)
        )
      : 0;
  const deceasedWidthPct =
    analysis.totalCast > 0 ? Math.max(0, 100 - aliveWidthPct) : 0;

  // Matrix tiles ordered Alive first, then Deceased
  const matrixActors = [...analysis.aliveActors, ...analysis.deceasedActors];

  // Age at release (release year minus birth year), for actors with a known
  // birth year who were born by release and (if deceased) alive in the release year.
  const releaseAges = work.releaseYear
    ? matrixActors
        .map((actor) => {
          const by = parseIsoDate(actor.birthDate, actor.birthPrecision)?.year;
          const dy = parseIsoDate(actor.deathDate, actor.deathPrecision)?.year;
          if (by === undefined) return null;
          const age = work.releaseYear! - by;
          if (age < 0 || (dy !== undefined && work.releaseYear! > dy)) {
            return null;
          }
          return { actor, age };
        })
        .filter((x): x is { actor: EvaluatedActor; age: number } => x !== null)
    : [];
  const youngestAtRelease = releaseAges.reduce<
    { actor: EvaluatedActor; age: number } | null
  >((best, x) => (best === null || x.age < best.age ? x : best), null);
  const oldestAtRelease = releaseAges.reduce<
    { actor: EvaluatedActor; age: number } | null
  >((best, x) => (best === null || x.age > best.age ? x : best), null);

  const clickableProps = (actorId?: string) =>
    actorId
      ? {
          className: 'stat-box clickable',
          role: 'button' as const,
          tabIndex: 0,
          title: 'Click to locate this cast member below',
          onClick: () => onSelectMatrixActor(actorId),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectMatrixActor(actorId);
            }
          },
        }
      : { className: 'stat-box' };

  return (
    <section className="score-hero" aria-label="Movie or Show Vitality Summary">
      <div className="score-hero-top">
        <div className="work-identity">
          {work.posterUrl && !posterError ? (
            <img
              src={work.posterUrl}
              alt={`${work.title} poster`}
              className="work-poster"
              onError={() => setPosterError(true)}
            />
          ) : (
            <div className="work-poster-fallback" aria-hidden="true">
              {work.mediaType === 'tv' || work.mediaType === 'miniseries' ? (
                <Tv size={28} />
              ) : (
                <Film size={28} />
              )}
              <span style={{ fontSize: '0.72rem' }}>{work.title}</span>
            </div>
          )}

          <div className="work-meta">
            <div className="work-badges">
              <span className="media-type-tag">
                {work.mediaType === 'tv'
                  ? 'TV Series'
                  : work.mediaType === 'miniseries'
                  ? 'Miniseries'
                  : 'Feature Film'}
              </span>

              <span
                className="query-timestamp-badge"
                title="Exact timestamp when this query was evaluated"
              >
                <Clock size={12} />
                {`Evaluated: ${formattedQueryTimestamp}`}
              </span>
            </div>

            <h2 className="work-title">
              {work.title}
              {yearDisplay && (
                <span className="work-year-span">({yearDisplay})</span>
              )}
            </h2>

            <p className="work-description">{work.description}</p>

            <div className="work-credits-row">
              {work.directorOrCreator && (
                <span className="work-credit-item">
                  {work.mediaType === 'tv' ? 'Created by: ' : 'Directed by: '}
                  <strong>{work.directorOrCreator}</strong>
                </span>
              )}
              {work.releaseYear && (
                <span className="work-credit-item">
                  Released{' '}
                  <strong>
                    {Math.max(0, queryYear - work.releaseYear)} years ago
                  </strong>
                </span>
              )}
              {work.wikipediaUrl && (
                <a
                  href={work.wikipediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="external-link"
                >
                  Reference Entry <ExternalLink size={13} />
                </a>
              )}
            </div>
            {omdbKey.trim() &&
              ratings &&
              (ratings.imdbRating ||
                ratings.rottenTomatoes ||
                ratings.metacritic) && (
                <div
                  className="work-credits-row"
                  aria-label="Ratings"
                  style={{ gap: '0.9rem', flexWrap: 'wrap' }}
                >
                  {ratings.imdbRating && (
                    <span className="work-credit-item">
                      IMDb:{' '}
                      {ratings.imdbId ? (
                        <a
                          href={`https://www.imdb.com/title/${ratings.imdbId}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="external-link"
                        >
                          <strong>{ratings.imdbRating}</strong>
                        </a>
                      ) : (
                        <strong>{ratings.imdbRating}</strong>
                      )}
                    </span>
                  )}
                  {ratings.rottenTomatoes && (
                    <span className="work-credit-item">
                      Rotten Tomatoes: <strong>{ratings.rottenTomatoes}</strong>
                    </span>
                  )}
                  {ratings.metacritic && (
                    <span className="work-credit-item">
                      Metacritic: <strong>{ratings.metacritic}</strong>
                    </span>
                  )}
                </div>
              )}
          </div>
        </div>

        {/* Overall Alive Score Readout */}
        <div
          className="alive-score-panel"
          id="overall-alive-score-panel"
          aria-live="polite"
        >
          <div className="alive-score-header">
            <span className="alive-score-label">Overall Alive Score</span>
            <span
              className="alive-score-decimal"
              title="Decimal ratio of living actors to total credited actors"
            >
              Ratio {analysis.aliveDecimalText}
            </span>
          </div>

          <div className="alive-score-main">
            <div
              className="alive-score-percentage"
              id="alive-score-percentage-value"
            >
              {analysis.alivePercentage.toFixed(1)}%
            </div>
            <div className="alive-score-fraction-block">
              <div
                className="alive-score-fraction"
                id="alive-score-fraction-value"
              >
                {analysis.aliveRatioText}
              </div>
              <div className="alive-score-sublabel">actors still alive</div>
            </div>
          </div>

          {!hasTmdbKey && (
            <button
              type="button"
              onClick={onOpenSettings}
              style={{
                marginTop: '0.15rem',
                paddingTop: '0.45rem',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                textAlign: 'left',
                lineHeight: 1.35,
              }}
              title="Open TMDB API configuration"
            >
              Additional cast data might be available if you configure the{' '}
              <span
                style={{
                  color: 'var(--accent-gold)',
                  textDecoration: 'underline',
                }}
              >
                TMDB API
              </span>
              .
            </button>
          )}
        </div>
      </div>

      {/* Proportional Split Bar */}
      <div className="proportion-meter-section">
        <div className="proportion-legend-row">
          <div className="legend-side alive">
            <span>Still Alive</span>
            <span className="legend-count-pill">
              {analysis.aliveCount} (
              {analysis.alivePercentage.toFixed(1)}%)
            </span>
          </div>

          <div className="legend-side deceased">
            <span className="legend-count-pill">
              {analysis.deceasedCount} (
              {(100 - analysis.alivePercentage).toFixed(1)}%)
            </span>
            <span>Deceased</span>
          </div>
        </div>

        <div
          className="proportion-bar-track"
          role="img"
          aria-label={`${analysis.aliveCount} alive out of ${analysis.totalCast} actors`}
        >
          {analysis.aliveCount > 0 && (
            <div
              className="proportion-bar-fill-alive"
              style={{ width: `${aliveWidthPct}%` }}
            />
          )}
          {analysis.deceasedCount > 0 && (
            <div
              className="proportion-bar-fill-deceased"
              style={{ width: `${deceasedWidthPct}%` }}
            />
          )}
        </div>

        {/* Visual Cast Vitality Matrix */}
        {matrixActors.length > 0 && (
          <div className="vitality-matrix-wrapper">
            <div className="vitality-matrix-header">
              <span>
                Visual Cast Overview ({matrixActors.length} actors — click any
                portrait to locate below)
              </span>
              <span>Green = Alive · Copper = Deceased</span>
            </div>
            <div className="vitality-matrix-grid">
              {matrixActors.map((actor) => (
                <MatrixTile
                  key={actor.id}
                  actor={actor}
                  onClick={() => onSelectMatrixActor(actor.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Demographic Context Stats */}
      <div className="hero-stats-grid">
        <div className="stat-box">
          <div className="stat-box-label">Median Age (Living Cast)</div>
          <div className="stat-box-value">
            {analysis.medianLivingAge !== null
              ? `${analysis.medianLivingAge} yrs`
              : '—'}
          </div>
          <div className="stat-box-sub">
            {analysis.averageLivingAge !== null
              ? `Mean age: ${analysis.averageLivingAge} yrs`
              : 'No living cast with birth date'}
          </div>
        </div>

        <div {...clickableProps(analysis.oldestLivingActor?.id)}>
          <div className="stat-box-label">Oldest Living Actor</div>
          <div className="stat-box-value">
            {analysis.oldestLivingActor
              ? `${analysis.oldestLivingActor.ageYears} yrs`
              : '—'}
          </div>
          <div className="stat-box-sub">
            {analysis.oldestLivingActor
              ? analysis.oldestLivingActor.name
              : 'None'}
          </div>
        </div>

        <div {...clickableProps(analysis.youngestLivingActor?.id)}>
          <div className="stat-box-label">Youngest Living Actor</div>
          <div className="stat-box-value">
            {analysis.youngestLivingActor
              ? `${analysis.youngestLivingActor.ageYears} yrs`
              : '—'}
          </div>
          <div className="stat-box-sub">
            {analysis.youngestLivingActor
              ? analysis.youngestLivingActor.name
              : 'None'}
          </div>
        </div>

        <div {...clickableProps(analysis.mostRecentlyDeceasedActor?.id)}>
          <div className="stat-box-label">Most Recently Deceased</div>
          <div className="stat-box-value">
            {analysis.mostRecentlyDeceasedActor
              ? analysis.mostRecentlyDeceasedActor.formattedDeathDate
              : '—'}
          </div>
          <div className="stat-box-sub">
            {analysis.mostRecentlyDeceasedActor
              ? `${analysis.mostRecentlyDeceasedActor.name}${
                  analysis.averageAgeAtDeath !== null
                    ? ` · Avg death age ${analysis.averageAgeAtDeath}`
                    : ''
                }`
              : 'All cast members alive'}
          </div>
        </div>

        <div {...clickableProps(youngestAtRelease?.actor.id)}>
          <div className="stat-box-label">Youngest Actor at Release</div>
          <div className="stat-box-value">
            {youngestAtRelease ? `${youngestAtRelease.age} yrs` : '—'}
          </div>
          <div className="stat-box-sub">
            {youngestAtRelease ? youngestAtRelease.actor.name : 'Unknown'}
          </div>
        </div>

        <div {...clickableProps(oldestAtRelease?.actor.id)}>
          <div className="stat-box-label">Oldest Actor at Release</div>
          <div className="stat-box-value">
            {oldestAtRelease ? `${oldestAtRelease.age} yrs` : '—'}
          </div>
          <div className="stat-box-sub">
            {oldestAtRelease ? oldestAtRelease.actor.name : 'Unknown'}
          </div>
        </div>
      </div>
    </section>
  );
};
