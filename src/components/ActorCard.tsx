import React, { useState } from 'react';
import type { EvaluatedActor } from '../types/media';
import { parseIsoDate } from '../utils/vitalityCalculator';

interface ActorCardProps {
  actor: EvaluatedActor;
  isHighlighted?: boolean;
  onSelectActor?: (actor: EvaluatedActor) => void;
  releaseYear?: number | null;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const ActorCard: React.FC<ActorCardProps> = ({
  actor,
  isHighlighted = false,
  onSelectActor,
  releaseYear,
}) => {
  const [imgError, setImgError] = useState(false);
  const isAlive = actor.status === 'alive';

  const ageBadgeText = isAlive
    ? actor.ageYears !== null
      ? `Alive · ${actor.ageYears} yrs`
      : 'Alive'
    : actor.ageYears !== null
    ? `Died at ${actor.ageYears}`
    : 'Deceased';

  const birthYear = parseIsoDate(actor.birthDate, actor.birthPrecision)?.year;
  const deathYear = parseIsoDate(actor.deathDate, actor.deathPrecision)?.year;
  const ageAtRelease =
    releaseYear && birthYear !== undefined
      ? releaseYear - birthYear
      : null;
  const showAgeAtRelease =
    ageAtRelease !== null &&
    ageAtRelease >= 0 &&
    (deathYear === undefined || releaseYear! <= deathYear);

  const dateLine = isAlive
    ? `b. ${actor.formattedBirthDate}`
    : `${actor.formattedBirthDate} – ${actor.formattedDeathDate || 'Deceased'}`;

  const handleOpenActorDetails = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    onSelectActor?.(actor);
  };

  return (
    <article
      id={`actor-card-${actor.id}`}
      className={`actor-card ${actor.status} ${
        isHighlighted ? 'highlighted' : ''
      }`}
    >
      <div
        className="actor-portrait-wrap clickable"
        role="button"
        tabIndex={0}
        title={`View details and filmography for ${actor.name}`}
        aria-label={`View details and filmography for ${actor.name}`}
        onClick={handleOpenActorDetails}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleOpenActorDetails(e);
          }
        }}
      >
        {actor.imageUrl && !imgError ? (
          <img
            src={actor.imageUrl}
            alt={actor.name}
            className="actor-portrait-img"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="actor-initials" aria-hidden="true">
            {getInitials(actor.name)}
          </span>
        )}
        <span className="actor-billing-tag" title="Billing order">
          #{actor.billingOrder}
        </span>
      </div>

      <div className="actor-info">
        <div className="actor-name-row">
          <a
            href={`#actor-details-${encodeURIComponent(actor.name)}`}
            className="actor-name actor-name-trigger"
            title={`View details and filmography for ${actor.name}`}
            onClick={handleOpenActorDetails}
          >
            {actor.name}
          </a>

          <span className={`actor-age-pill ${actor.status}`}>
            {ageBadgeText}
          </span>
        </div>

        <div className="actor-character">
          {actor.character ? (
            <>
              <em>as</em> {actor.character}
              {actor.isVoice ? ' (voice)' : ''}
            </>
          ) : (
            <em>Credited cast member{actor.isVoice ? ' (voice)' : ''}</em>
          )}
        </div>

        <div className="actor-dates-row">
          <span>{dateLine}</span>
          {!isAlive &&
            actor.yearsSinceDeath !== null &&
            actor.yearsSinceDeath >= 0 && (
              <span>
                {actor.yearsSinceDeath === 0
                  ? 'Passed this year'
                  : `${actor.yearsSinceDeath}y ago`}
              </span>
            )}
        </div>

        {showAgeAtRelease && (
          <div
            className="actor-dates-row"
            title="Based on release year; may be off by one year"
          >
            <span>
              Age at release ({releaseYear}): {ageAtRelease}
            </span>
          </div>
        )}
      </div>
    </article>
  );
};
