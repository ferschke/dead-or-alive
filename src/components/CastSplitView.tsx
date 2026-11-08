import React from 'react';
import { Search, X } from 'lucide-react';
import type {
  CastVitalityAnalysis,
  EvaluatedActor,
  SortOption,
  ViewMode,
} from '../types/media';
import { sortEvaluatedActors } from '../utils/vitalityCalculator';
import { ActorCard } from './ActorCard';

interface CastSplitViewProps {
  analysis: CastVitalityAnalysis;
  sortBy: SortOption;
  onChangeSortBy: (sort: SortOption) => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  actorFilterQuery: string;
  onChangeActorFilterQuery: (q: string) => void;
  includeVoiceActors: boolean;
  onChangeIncludeVoiceActors: (inc: boolean) => void;
  hasVoiceActors: boolean;
  highlightedActorId: string | null;
  onSelectActor: (actor: EvaluatedActor) => void;
  releaseYear?: number | null;
}

export const CastSplitView: React.FC<CastSplitViewProps> = ({
  analysis,
  sortBy,
  onChangeSortBy,
  viewMode,
  onChangeViewMode,
  actorFilterQuery,
  onChangeActorFilterQuery,
  includeVoiceActors,
  onChangeIncludeVoiceActors,
  hasVoiceActors,
  highlightedActorId,
  onSelectActor,
  releaseYear,
}) => {
  const filterTerm = actorFilterQuery.trim().toLowerCase();

  const filterFn = (a: { name: string; character?: string }) => {
    if (!filterTerm) return true;
    return (
      a.name.toLowerCase().includes(filterTerm) ||
      (a.character && a.character.toLowerCase().includes(filterTerm))
    );
  };

  const sortedAlive = sortEvaluatedActors(
    analysis.aliveActors.filter(filterFn),
    sortBy
  );
  const sortedDeceased = sortEvaluatedActors(
    analysis.deceasedActors.filter(filterFn),
    sortBy
  );
  const unifiedActors = sortEvaluatedActors(
    [...analysis.aliveActors, ...analysis.deceasedActors].filter(filterFn),
    sortBy
  );

  return (
    <section aria-label="Cast Sorted by Living Status">
      {/* Toolbar */}
      <div className="cast-toolbar">
        <div className="toolbar-left">
          <div className="cast-filter-input-wrap">
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              id="filter-cast-member-input"
              type="text"
              className="cast-filter-input"
              placeholder="Filter actor or role..."
              value={actorFilterQuery}
              onChange={(e) => onChangeActorFilterQuery(e.target.value)}
            />
            {actorFilterQuery && (
              <button
                type="button"
                onClick={() => onChangeActorFilterQuery('')}
                aria-label="Clear actor filter"
                style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {hasVoiceActors && (
            <label className="voice-checkbox-label">
              <input
                type="checkbox"
                id="include-voice-actors-checkbox"
                checked={includeVoiceActors}
                onChange={(e) => onChangeIncludeVoiceActors(e.target.checked)}
              />
              Include voice roles
            </label>
          )}
        </div>

        <div className="toolbar-right">
          <label
            htmlFor="cast-sort-select"
            style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}
          >
            Sort by:
          </label>
          <select
            id="cast-sort-select"
            className="toolbar-select"
            value={sortBy}
            onChange={(e) => onChangeSortBy(e.target.value as SortOption)}
          >
            <option value="billing">Billing Order</option>
            <option value="age-desc">Age (Oldest First)</option>
            <option value="age-asc">Age (Youngest First)</option>
            <option value="name-asc">Actor Name (A–Z)</option>
            <option value="death-recent">Most Recently Deceased</option>
            <option value="death-earliest">Earliest Deceased</option>
          </select>

          <div
            className="toolbar-toggle-group"
            role="group"
            aria-label="Cast layout mode"
          >
            <button
              type="button"
              id="view-mode-split-btn"
              className={`toolbar-toggle-btn ${
                viewMode === 'split' ? 'active' : ''
              }`}
              onClick={() => onChangeViewMode('split')}
            >
              Alive vs. Dead Split
            </button>
            <button
              type="button"
              id="view-mode-unified-btn"
              className={`toolbar-toggle-btn ${
                viewMode === 'unified' ? 'active' : ''
              }`}
              onClick={() => onChangeViewMode('unified')}
            >
              Unified Roster
            </button>
          </div>
        </div>
      </div>

      {/* Split View: Alive Column & Deceased Column */}
      {viewMode === 'split' ? (
        <div className="cast-split-container">
          {/* Still Alive Column */}
          <div className="cast-column alive-col" id="alive-actors-column">
            <div className="cast-column-header">
              <div className="column-title-group">
                <span className="column-status-dot alive" />
                <h3 className="column-title">Still Alive</h3>
              </div>
              <span className="column-count-badge">
                {sortedAlive.length}{' '}
                {sortedAlive.length === 1 ? 'actor' : 'actors'}
              </span>
            </div>

            {sortedAlive.length === 0 ? (
              <div className="empty-column-state">
                {filterTerm
                  ? `No living actors match "${actorFilterQuery}".`
                  : 'None of the credited cast members are currently living.'}
              </div>
            ) : (
              <div className="cast-list">
                {sortedAlive.map((actor) => (
                  <ActorCard
                    key={actor.id}
                    actor={actor}
                    isHighlighted={highlightedActorId === actor.id}
                    onSelectActor={onSelectActor}
                    releaseYear={releaseYear}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Deceased Column */}
          <div className="cast-column deceased-col" id="deceased-actors-column">
            <div className="cast-column-header">
              <div className="column-title-group">
                <span className="column-status-dot deceased" />
                <h3 className="column-title">Deceased</h3>
              </div>
              <span className="column-count-badge">
                {sortedDeceased.length}{' '}
                {sortedDeceased.length === 1 ? 'actor' : 'actors'}
              </span>
            </div>

            {sortedDeceased.length === 0 ? (
              <div className="empty-column-state">
                {filterTerm
                  ? `No deceased actors match "${actorFilterQuery}".`
                  : 'All credited cast members are still alive at this time.'}
              </div>
            ) : (
              <div className="cast-list">
                {sortedDeceased.map((actor) => (
                  <ActorCard
                    key={actor.id}
                    actor={actor}
                    isHighlighted={highlightedActorId === actor.id}
                    onSelectActor={onSelectActor}
                    releaseYear={releaseYear}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="unified-cast-grid">
          {unifiedActors.map((actor) => (
            <ActorCard
              key={actor.id}
              actor={actor}
              isHighlighted={highlightedActorId === actor.id}
              onSelectActor={onSelectActor}
                    releaseYear={releaseYear}
            />
          ))}
        </div>
      )}
    </section>
  );
};
