export type MediaStatus = "FINISHED" | "RELEASING" | "NOT_YET_RELEASED" | "HIATUS" | "CANCELLED";
export type MediaFormat = "TV" | "TV_SHORT" | "MOVIE" | "OVA" | "ONA" | "SPECIAL" | "MUSIC";
/** The local, provider-independent shape of a library item. */
export type MediaKind = "movie" | "series";
export type MediaSeason = "WINTER" | "SPRING" | "SUMMER" | "FALL";
export type LibraryStatus =
  | "PLAN_TO_WATCH"
  | "WATCHING"
  | "COMPLETED"
  | "PAUSED"
  | "DROPPED"
  | "REWATCHING";
export type TitleLanguage = "english" | "romaji" | "native";
export type CardSize = "small" | "medium" | "large";
export type WatchSite =
  | "any"
  | "crunchyroll"
  | "hidive"
  | "netflix"
  | "amazon"
  | "hulu"
  | "disney"
  | "funimation";
export type ExternalBrowser =
  | "system"
  | "firefox"
  | "chromium"
  | "google-chrome"
  | "brave"
  | "vivaldi"
  | "microsoft-edge";
export type SortOption =
  | "default"
  | "name_asc"
  | "name_desc"
  | "status"
  | "progress"
  | "airing_day";
export type CollectionFilter = "COMPLETED" | "WATCHING" | "PLANNED" | "AIRING";

export interface ExternalLink {
  url: string;
  site: string;
  type: string;
  color: string | null;
  icon: string | null;
}

export interface Media {
  id: number;
  /** Legacy imports without this field are treated as series. */
  kind?: MediaKind;
  titleRomaji: string;
  titleEnglish: string | null;
  titleNative: string | null;
  status: MediaStatus;
  format: MediaFormat;
  totalEpisodes: number | null;
  airedEpisodes: number;
  nextAiringEpisode: number | null;
  nextAiringAt: number | null;
  coverImageLarge: string | null;
  coverImageMedium: string | null;
  bannerImage: string | null;
  season: MediaSeason | null;
  seasonYear: number | null;
  genres: string[];
  description: string | null;
  siteUrl: string;
  externalLinks: ExternalLink[];
  syncedAt: number;
  malId: number | null;
  /** The provider operation used to refresh this item. */
  syncSource?:
    | { kind: "anilist"; providerId: string }
    | { kind: "connection"; connectionId: string; providerId: string };
  /** Provider identities are metadata links, never canonical local IDs. */
  providerLinks?: Array<{
    connectionId: string;
    connectionName: string;
    providerId: string;
    canonicalUrl?: string;
  }>;
}

export interface Episode {
  id: number;
  mediaId: number;
  number: number;
  title: string | null;
  airingAt: number | null;
  aired: boolean;
  watched: boolean;
  watchedAt: number | null;
  skipped: boolean;
  isFiller: boolean;
  isRecap: boolean;
  thumbnail: string | null;
  seasonNumber?: number | null;
  sourceEpisodeNumber?: number | null;
  providerLinks?: Array<{
    connectionId: string;
    providerId: string;
  }>;
}

/** An append-only record of a completed movie or episode. */
export interface WatchEvent {
  id: number;
  mediaId: number;
  episodeId: number | null;
  watchedAt: number;
  progress: number;
  origin: "manual" | "legacy" | "source";
  /** Stable remote identity used to make tracking imports idempotent. */
  remoteEventId?: string;
  originatingConnectionId?: string;
}

export interface LibraryEntry {
  id: number;
  mediaId: number;
  status: LibraryStatus;
  score: number | null;
  notes: string | null;
  startedAt: number | null;
  completedAt: number | null;
  addedAt: number;
  updatedAt: number;
}

export interface Collection {
  id: number;
  name: string;
  originalName: string | null;
  coverMediaId: number | null;
  notes: string | null;
  createdAt: number;
}

export interface CollectionEntry {
  collectionId: number;
  mediaId: number;
  order: number;
}

export interface Series {
  id: number;
  name: string;
  originalName: string | null;
  coverMediaId: number | null;
  notes: string | null;
  createdAt: number;
}

export interface SeriesEntry {
  seriesId: number;
  mediaId: number;
  order: number;
}

export interface Settings {
  titleLanguage: TitleLanguage;
  cardSize: CardSize;
  cardBorderRadius: number;
  cardPadding: number;
  watchButton: { enabled: boolean; site: WatchSite };
  externalBrowser: ExternalBrowser;
  jikanEnrichment: boolean;
  syncFilters: { airing: boolean; upcoming: boolean; hiatus: boolean };
  filterOrder: CollectionFilter[];
  filterDefaults: Record<CollectionFilter, boolean>;
  defaultSort: SortOption;
  settingsSectionOrder: string[];
  autoSync: boolean;
  showTba: boolean;
  lastSyncedAt: number | null;
}

export interface AppData {
  version: 2;
  exportedAt: string;
  media: Media[];
  episodes: Episode[];
  watchEvents: WatchEvent[];
  library: LibraryEntry[];
  collections: Collection[];
  collectionEntries: CollectionEntry[];
  series: Series[];
  seriesEntries: SeriesEntry[];
  settings: Settings;
}
