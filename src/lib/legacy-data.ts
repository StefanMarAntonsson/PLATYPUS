import type { AppData, Settings } from "./types.js";

export const DEFAULT_SETTINGS: Settings = {
  titleLanguage: "english",
  cardSize: "medium",
  cardBorderRadius: 8,
  cardPadding: 10,
  watchButton: { enabled: true, site: "any" },
  externalBrowser: "system",
  jikanEnrichment: false,
  syncFilters: { airing: true, upcoming: false, hiatus: false },
  filterOrder: ["WATCHING", "AIRING", "PLANNED", "COMPLETED"],
  filterDefaults: { WATCHING: true, AIRING: true, PLANNED: false, COMPLETED: false },
  defaultSort: "default",
  settingsSectionOrder: ["filters", "data", "title", "sync"],
  autoSync: false,
  showTba: true,
  lastSyncedAt: null,
};

export const EMPTY_APP_DATA: AppData = {
  version: 2,
  exportedAt: "",
  media: [],
  episodes: [],
  watchEvents: [],
  library: [],
  collections: [],
  collectionEntries: [],
  series: [],
  seriesEntries: [],
  settings: DEFAULT_SETTINGS,
};

const DATA_ARRAYS = [
  "media",
  "episodes",
  "watchEvents",
  "library",
  "collections",
  "collectionEntries",
  "series",
  "seriesEntries",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a v2 backup without mutating the supplied object or accepting partial/corrupt data. */
export function parseV2Data(text: string): AppData {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("PLATYPUS data must be a JSON object");
  if (value.version !== 2)
    throw new Error(`Unsupported PLATYPUS data version: ${String(value.version)}`);

  for (const field of ["media", "episodes", "library"] as const) {
    if (!Array.isArray(value[field]))
      throw new Error(`Invalid PLATYPUS data: ${field} must be an array`);
  }
  if (value.settings !== undefined && !isRecord(value.settings)) {
    throw new Error("Invalid PLATYPUS data: settings must be an object");
  }

  // JSON parsing already detached the input. Work on this new object so callers can
  // safely dry-run migration without changes leaking into their current library.
  const parsed = value as Record<string, unknown>;
  const settings = (parsed.settings ?? {}) as Record<string, unknown>;
  const { accentColor: _legacyAccentColor, ...supportedSettings } = settings;
  parsed.settings = { ...DEFAULT_SETTINGS, ...supportedSettings };

  // Early v2 builds called user-curated collections "series". Preserve both the
  // original records and a collection-shaped copy so migration cannot lose either.
  if (!Array.isArray(parsed.collections) && Array.isArray(parsed.series)) {
    parsed.collections = structuredClone(parsed.series);
  }
  if (!Array.isArray(parsed.collectionEntries) && Array.isArray(parsed.seriesEntries)) {
    parsed.collectionEntries = parsed.seriesEntries.map((entry) => {
      if (!isRecord(entry))
        throw new Error("Invalid PLATYPUS data: seriesEntries contains an invalid item");
      return {
        collectionId: entry.collectionId ?? entry.seriesId,
        mediaId: entry.mediaId,
        order: entry.order,
      };
    });
  }

  for (const field of DATA_ARRAYS) {
    parsed[field] ??= [];
    if (!Array.isArray(parsed[field])) {
      throw new Error(`Invalid PLATYPUS data: ${field} must be an array`);
    }
  }
  parsed.exportedAt = typeof parsed.exportedAt === "string" ? parsed.exportedAt : "";
  return parsed as unknown as AppData;
}
