import type {
  CastVitalityAnalysis,
  EvaluatedActor,
  RawActorRecord,
  SortOption,
  VitalStatus,
} from '../types/media';

interface ParsedDateInfo {
  date: Date;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  precision: 'day' | 'month' | 'year';
}

/**
 * Parses an ISO-like date string ("YYYY-MM-DD", "YYYY-MM", or "YYYY")
 * into structured date components without timezone drift.
 */
export function parseIsoDate(
  iso: string | null | undefined,
  explicitPrecision?: 'day' | 'month' | 'year'
): ParsedDateInfo | null {
  if (!iso) return null;
  const cleaned = iso.trim().replace(/^\+/, '');
  const match = cleaned.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  if (isNaN(year) || year < 1700 || year > 2100) return null;

  const rawMonth = match[2] ? parseInt(match[2], 10) : 0;
  const rawDay = match[3] ? parseInt(match[3], 10) : 0;

  let precision: 'day' | 'month' | 'year' = explicitPrecision || 'day';
  if (!explicitPrecision) {
    if (!match[2] || rawMonth === 0) {
      precision = 'year';
    } else if (!match[3] || rawDay === 0) {
      precision = 'month';
    }
  }

  const month = rawMonth >= 1 && rawMonth <= 12 ? rawMonth : 1;
  const day = rawDay >= 1 && rawDay <= 31 ? rawDay : 1;

  const date = new Date(year, month - 1, day, 12, 0, 0);
  return { date, year, month, day, precision };
}

/**
 * Formats a ParsedDateInfo into a human-readable string like "Apr 3, 1924" or "1924".
 */
export function formatActorDate(
  iso: string | null | undefined,
  explicitPrecision?: 'day' | 'month' | 'year'
): string {
  const parsed = parseIsoDate(iso, explicitPrecision);
  if (!parsed) return 'Date unknown';

  if (parsed.precision === 'year') {
    return `${parsed.year}`;
  }

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthName = months[parsed.month - 1] || 'Jan';

  if (parsed.precision === 'month') {
    return `${monthName} ${parsed.year}`;
  }

  return `${monthName} ${parsed.day}, ${parsed.year}`;
}

/**
 * Computes exact completed years between two dates.
 */
export function computeCompletedYears(start: ParsedDateInfo, end: Date): number {
  const endYear = end.getFullYear();
  const endMonth = end.getMonth() + 1;
  const endDay = end.getDate();

  let years = endYear - start.year;
  if (start.precision === 'year') {
    return Math.max(0, years);
  }
  if (
    endMonth < start.month ||
    (endMonth === start.month && endDay < start.day)
  ) {
    years -= 1;
  }
  return Math.max(0, years);
}

/**
 * Evaluates a single actor's vital status and age at the given evaluation timestamp.
 */
export function evaluateActorAtTime(
  actor: RawActorRecord,
  evaluationDate: Date
): EvaluatedActor {
  const birthInfo = parseIsoDate(actor.birthDate, actor.birthPrecision);
  const deathInfo = parseIsoDate(actor.deathDate, actor.deathPrecision);

  const formattedBirthDate = birthInfo
    ? formatActorDate(actor.birthDate, birthInfo.precision)
    : 'Birth date unlisted';
  const formattedDeathDate = deathInfo
    ? formatActorDate(actor.deathDate, deathInfo.precision)
    : null;

  let status: VitalStatus = 'alive';
  let ageYears: number | null = null;
  let yearsSinceDeath: number | null = null;
  let statusSummary = '';

  // Check if deceased on or before evaluationDate
  const diedBeforeOrAtEval =
    deathInfo !== null && deathInfo.date.getTime() <= evaluationDate.getTime();

  if (diedBeforeOrAtEval && deathInfo) {
    status = 'deceased';
    if (birthInfo) {
      ageYears = computeCompletedYears(birthInfo, deathInfo.date);
    }
    yearsSinceDeath = computeCompletedYears(deathInfo, evaluationDate);
    statusSummary =
      ageYears !== null
        ? `Died ${formattedDeathDate} (aged ${ageYears})`
        : `Died ${formattedDeathDate}`;
  } else if (birthInfo) {
    // Check if actor was born more than 115 years before evaluationDate with no death date
    const potentialAge = computeCompletedYears(birthInfo, evaluationDate);
    if (potentialAge >= 115 && !deathInfo) {
      status = 'deceased';
      ageYears = null;
      statusSummary = `Born ${formattedBirthDate} · Presumed deceased`;
    } else {
      status = 'alive';
      ageYears = potentialAge;
      statusSummary = `Age ${potentialAge} · Born ${formattedBirthDate}`;
    }
  } else {
    // Neither death date nor birth date known: on Wikidata/TMDB living character actors
    // occasionally lack a public birth year; treat as alive unless marked deceased
    status = 'alive';
    ageYears = null;
    statusSummary = 'Living · Birth date unlisted';
  }

  return {
    ...actor,
    status,
    ageYears,
    yearsSinceDeath,
    formattedBirthDate,
    formattedDeathDate,
    statusSummary,
  };
}

/**
 * Evaluates the entire cast of a movie or show at the specified evaluation timestamp
 * and produces the overall Alive Score and sorted actor lists.
 */
export function analyzeCastVitality(
  cast: RawActorRecord[],
  queryTimestamp: Date,
  evaluationDate: Date = queryTimestamp
): CastVitalityAnalysis {
  const isHistoricalPreview =
    Math.abs(evaluationDate.getTime() - queryTimestamp.getTime()) > 86400000;

  const evaluated = cast.map((actor) =>
    evaluateActorAtTime(actor, evaluationDate)
  );

  const aliveActors = evaluated.filter((a) => a.status === 'alive');
  const deceasedActors = evaluated.filter((a) => a.status === 'deceased');
  const unknownActors = evaluated.filter((a) => a.status === 'unknown');

  const totalCast = evaluated.length;
  const aliveCount = aliveActors.length;
  const deceasedCount = deceasedActors.length;
  const unknownCount = unknownActors.length;
  const knownStatusCast = aliveCount + deceasedCount;

  const aliveFraction = totalCast > 0 ? aliveCount / totalCast : 0;
  const alivePercentage = aliveFraction * 100;

  const aliveRatioText = `${aliveCount} / ${totalCast}`;
  const aliveDecimalText = aliveFraction.toFixed(3);

  // Compute living age statistics
  const livingAges = aliveActors
    .map((a) => a.ageYears)
    .filter((age): age is number => age !== null && age >= 0)
    .sort((a, b) => a - b);

  const averageLivingAge =
    livingAges.length > 0
      ? Math.round(
          (livingAges.reduce((acc, v) => acc + v, 0) / livingAges.length) * 10
        ) / 10
      : null;

  const medianLivingAge =
    livingAges.length > 0
      ? livingAges.length % 2 === 1
        ? livingAges[Math.floor(livingAges.length / 2)]
        : Math.round(
            ((livingAges[livingAges.length / 2 - 1] +
              livingAges[livingAges.length / 2]) /
              2) *
              10
          ) / 10
      : null;

  const deathAges = deceasedActors
    .map((a) => a.ageYears)
    .filter((age): age is number => age !== null && age >= 0);

  const averageAgeAtDeath =
    deathAges.length > 0
      ? Math.round(
          (deathAges.reduce((acc, v) => acc + v, 0) / deathAges.length) * 10
        ) / 10
      : null;

  const livingWithBirth = aliveActors
    .filter((a) => a.birthDate && a.ageYears !== null)
    .sort((a, b) => {
      const da = parseIsoDate(a.birthDate)?.date.getTime() ?? 0;
      const db = parseIsoDate(b.birthDate)?.date.getTime() ?? 0;
      return da - db;
    });

  const oldestLivingActor =
    livingWithBirth.length > 0 ? livingWithBirth[0] : null;
  const youngestLivingActor =
    livingWithBirth.length > 0
      ? livingWithBirth[livingWithBirth.length - 1]
      : null;

  const deceasedWithDates = deceasedActors
    .filter((a) => a.deathDate)
    .sort((a, b) => {
      const da = parseIsoDate(a.deathDate)?.date.getTime() ?? 0;
      const db = parseIsoDate(b.deathDate)?.date.getTime() ?? 0;
      return db - da;
    });

  const mostRecentlyDeceasedActor =
    deceasedWithDates.length > 0 ? deceasedWithDates[0] : null;

  return {
    queryTimestamp,
    evaluationDate,
    isHistoricalPreview,
    totalCast,
    knownStatusCast,
    aliveCount,
    deceasedCount,
    unknownCount,
    aliveFraction,
    alivePercentage,
    aliveRatioText,
    aliveDecimalText,
    aliveActors,
    deceasedActors,
    unknownActors,
    averageLivingAge,
    medianLivingAge,
    averageAgeAtDeath,
    oldestLivingActor,
    youngestLivingActor,
    mostRecentlyDeceasedActor,
  };
}

/**
 * Sorts an array of EvaluatedActor records according to the selected SortOption.
 */
export function sortEvaluatedActors(
  actors: EvaluatedActor[],
  sortBy: SortOption
): EvaluatedActor[] {
  const copy = [...actors];
  copy.sort((a, b) => {
    switch (sortBy) {
      case 'billing':
        return a.billingOrder - b.billingOrder;
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'age-desc': {
        const ageA = a.ageYears ?? -1;
        const ageB = b.ageYears ?? -1;
        if (ageB !== ageA) return ageB - ageA;
        return a.billingOrder - b.billingOrder;
      }
      case 'age-asc': {
        const ageA = a.ageYears ?? 999;
        const ageB = b.ageYears ?? 999;
        if (ageA !== ageB) return ageA - ageB;
        return a.billingOrder - b.billingOrder;
      }
      case 'death-recent': {
        const dA = parseIsoDate(a.deathDate)?.date.getTime() ?? 0;
        const dB = parseIsoDate(b.deathDate)?.date.getTime() ?? 0;
        if (dB !== dA) return dB - dA;
        return a.billingOrder - b.billingOrder;
      }
      case 'death-earliest': {
        const dA =
          parseIsoDate(a.deathDate)?.date.getTime() ?? Number.MAX_SAFE_INTEGER;
        const dB =
          parseIsoDate(b.deathDate)?.date.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (dA !== dB) return dA - dB;
        return a.billingOrder - b.billingOrder;
      }
      default:
        return a.billingOrder - b.billingOrder;
    }
  });
  return copy;
}
