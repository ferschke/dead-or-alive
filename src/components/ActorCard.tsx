import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { EvaluatedActor } from '../types/media';

interface ActorCardProps {
  actor: EvaluatedActor;
  isHighlighted?: boolean;
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

  const dateLine = isAlive
    ? `b. ${actor.formattedBirthDate}`
    : `${actor.formattedBirthDate} – ${actor.formattedDeathDate || 'Deceased'}`;

  return (
    <article
      id={`actor-card-${actor.id}`}
      className={`actor-card ${actor.status} ${
        isHighlighted ? 'highlighted' : ''
      }`}
    >
      <div className="actor-portrait-wrap">
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
          {actor.wikipediaUrl ? (
            <a
              href={actor.wikipediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="actor-name"
              title={`Open biography for ${actor.name}`}
            >
              {actor.name}{' '}
              <ExternalLink
                size={12}
                style={{
                  display: 'inline',
                  verticalAlign: 'middle',
                  opacity: 0.55,
                }}
              />
            </a>
          ) : (
            <span className="actor-name">{actor.name}</span>
          )}

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
      </div>
    </article>
  );
};
