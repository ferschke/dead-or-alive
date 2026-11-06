export type MediaType = 'movie' | 'tv' | 'miniseries' | 'other';

export type DataSourceType = 'wikidata' | 'tmdb' | 'curated';

export interface SearchResultItem {
  id: string;
  wikidataId?: string;
  tmdbId?: number;
  title: string;
  releaseYear?: number | null;
  endYear?: number | null;
  mediaType: MediaType;
  description: string;
  posterUrl?: string;
  castCountHint?: number;
  source: DataSourceType;
}

export interface RawActorRecord {
  id: string;
  name: string;
  character?: string;
  billingOrder: number;
  birthDate: string | null; // ISO YYYY-MM-DD or YYYY
  birthPrecision?: 'day' | 'month' | 'year';
  deathDate: string | null; // ISO YYYY-MM-DD or YYYY
  deathPrecision?: 'day' | 'month' | 'year';
  causeOfDeath?: string;
  imageUrl?: string;
  wikipediaUrl?: string;
  wikidataId?: string;
  isVoice?: boolean;
}

export interface MediaWork {
  id: string;
  wikidataId?: string;
  tmdbId?: number;
  title: string;
  originalTitle?: string;
  releaseYear?: number | null;
  endYear?: number | null;
  mediaType: MediaType;
  description: string;
  directorOrCreator?: string;
  country?: string;
  posterUrl?: string;
  wikipediaUrl?: string;
  source: DataSourceType;
  cast: RawActorRecord[];
}

export type VitalStatus = 'alive' | 'deceased' | 'unknown';

export interface EvaluatedActor extends RawActorRecord {
  status: VitalStatus;
  ageYears: number | null; // Current age if alive, or age at death if deceased
  yearsSinceDeath: number | null;
  formattedBirthDate: string;
  formattedDeathDate: string | null;
  statusSummary: string;
}

export interface CastVitalityAnalysis {
  queryTimestamp: Date;
  evaluationDate: Date;
  isHistoricalPreview: boolean;
  totalCast: number;
  knownStatusCast: number;
  aliveCount: number;
  deceasedCount: number;
  unknownCount: number;
  aliveFraction: number; // 0..1 (aliveCount / totalCast)
  alivePercentage: number; // 0..100
  aliveRatioText: string; // e.g. "14 / 22"
  aliveDecimalText: string; // e.g. "0.636"
  aliveActors: EvaluatedActor[];
  deceasedActors: EvaluatedActor[];
  unknownActors: EvaluatedActor[];
  averageLivingAge: number | null;
  medianLivingAge: number | null;
  averageAgeAtDeath: number | null;
  oldestLivingActor: EvaluatedActor | null;
  youngestLivingActor: EvaluatedActor | null;
  mostRecentlyDeceasedActor: EvaluatedActor | null;
}

export type SortOption =
  | 'billing'
  | 'age-desc'
  | 'age-asc'
  | 'name-asc'
  | 'death-recent'
  | 'death-earliest';

export type ViewMode = 'split' | 'unified' | 'lifespan';
