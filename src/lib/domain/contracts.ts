/** Provider-independent contracts for PLATYPUS's authoritative local data. */

export type EntityId = string;
export type IsoDate = string;
export type IsoDateTime = string;

export type MediaKind = "movie" | "series";
export type MediaLifecycle =
  | "announced"
  | "in_production"
  | "releasing"
  | "ended"
  | "cancelled"
  | "unknown";
export type LibraryStatus = "planned" | "watching" | "paused" | "dropped" | "completed";
export type ProgressState = "unstarted" | "in_progress" | "caught_up" | "finished";

export interface LocalizedText {
  language: string;
  value: string;
}

export interface ArtworkReference {
  kind: "poster" | "backdrop" | "thumbnail" | "logo";
  url: string;
  language?: string;
  width?: number;
  height?: number;
}

export interface MediaItem {
  id: EntityId;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  localizedTitles: LocalizedText[];
  overview?: string;
  originalLanguage?: string;
  releaseDate?: IsoDate;
  startDate?: IsoDate;
  endDate?: IsoDate;
  runtimeMinutes?: number;
  lifecycle: MediaLifecycle;
  genres: string[];
  artwork: ArtworkReference[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Season {
  id: EntityId;
  seriesId: EntityId;
  number: number;
  title?: string;
  overview?: string;
  releaseDate?: IsoDate;
  artwork: ArtworkReference[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Episode {
  id: EntityId;
  seriesId: EntityId;
  seasonId?: EntityId;
  seasonNumber?: number;
  number: number;
  title?: string;
  overview?: string;
  releaseDate?: IsoDate;
  runtimeMinutes?: number;
  artwork: ArtworkReference[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LibraryEntry {
  id: EntityId;
  mediaItemId: EntityId;
  status: LibraryStatus;
  rating?: number;
  notes?: string;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface WatchEvent {
  id: EntityId;
  target: { kind: "movie"; mediaItemId: EntityId } | { kind: "episode"; episodeId: EntityId };
  watchedAt: IsoDateTime;
  completion?: number;
  positionSeconds?: number;
  durationSeconds?: number;
  originatingConnectionId?: EntityId;
  remoteEventId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** A Collection is user-curated; a Series is a canonical MediaItem hierarchy. */
export interface Collection {
  id: EntityId;
  name: string;
  description?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CollectionItem {
  collectionId: EntityId;
  mediaItemId: EntityId;
  position: number;
  addedAt: IsoDateTime;
}

export interface ProviderLink {
  id: EntityId;
  entityType: "media_item" | "season" | "episode";
  entityId: EntityId;
  connectionId: EntityId;
  remoteId: string;
  remoteKind?: string;
  canonicalUrl?: string;
  lastSyncedAt?: IsoDateTime;
}

export interface ProviderFieldValue<T = unknown> {
  entityType: ProviderLink["entityType"];
  entityId: EntityId;
  connectionId: EntityId;
  field: string;
  value: T;
  observedAt: IsoDateTime;
}

export interface ManualOverride<T = unknown> {
  entityType: ProviderLink["entityType"];
  entityId: EntityId;
  field: string;
  value: T;
  updatedAt: IsoDateTime;
}
