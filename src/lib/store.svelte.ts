import type {
  AppData,
  Media,
  Episode,
  WatchEvent,
  MediaKind,
  LibraryEntry,
  LibraryStatus,
  Collection,
  Series,
  Settings,
  CollectionFilter,
} from "./types.js";
import { EMPTY_APP_DATA, parseV2Data } from "./legacy-data.js";
import { desktopAppDataRepository } from "./repositories.js";
import type { NormalizedMedia } from "./connectors/contracts.js";
import { previewV2Migration, type V2MigrationPreview } from "./v2-migration.js";

// ─── Defaults ────────────────────────────────────────────────────────────────

const EMPTY = EMPTY_APP_DATA;

// ─── App data ─────────────────────────────────────────────────────────────────

export const appData = $state<AppData>(structuredClone(EMPTY));

// ─── File state ───────────────────────────────────────────────────────────────

export type FileState = "initializing" | "ready" | "error";

export const fs = $state({
  status: "initializing" as FileState,
  fileName: "",
  isSaving: false,
  saveError: "",
});

// Private — not reactive, used to debounce native repository writes.
let _saveTimer: ReturnType<typeof setTimeout> | undefined;
let _savePromise: Promise<void> | undefined;
const DESKTOP_DATA_KEY = "platypus-desktop-bootstrap-data";

function applyData(data: AppData) {
  Object.assign(appData, data);
}

/** Validate a v2 backup without touching the active library. */
export function previewV2Import(text: string): V2MigrationPreview {
  return previewV2Migration(text);
}

/**
 * Commit a previously previewed v2 import. Desktop writes use the native
 * repository's single SQLite transaction; in-memory state changes only after
 * that write succeeds.
 */
export async function importV2Data(preview: V2MigrationPreview): Promise<void> {
  await desktopAppDataRepository.save(preview.data);
  applyData(preview.data);
  fs.status = "ready";
}

// ─── Persist (debounced) ──────────────────────────────────────────────────────

export function persist() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(doSave, 200);
}

async function doSave() {
  _saveTimer = undefined;
  fs.isSaving = true;
  fs.saveError = "";
  const save = desktopAppDataRepository.save(appData);
  _savePromise = save;
  await save
    .then(() => {
      fs.saveError = "";
    })
    .catch((e: unknown) => {
      fs.saveError = e instanceof Error ? e.message : "Save failed";
    });
  if (_savePromise === save) {
    _savePromise = undefined;
    fs.isSaving = false;
  }
}

/** Finish any queued native write before an updater-triggered restart. */
export async function flushPendingSave(): Promise<void> {
  if (_saveTimer !== undefined) {
    clearTimeout(_saveTimer);
    await doSave();
  } else if (_savePromise) {
    await _savePromise.catch(() => undefined);
  }

  if (fs.saveError) {
    throw new Error(`PLATYPUS could not save your library: ${fs.saveError}`);
  }
}

// ─── Public file operations ───────────────────────────────────────────────────

export async function initFile(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const saved = await desktopAppDataRepository.load();
    if (saved) {
      applyData(saved);
    } else {
      // One-time migration for Phase 2 desktop builds. The old browser-store
      // value remains intact unless the transactional SQLite write succeeds.
      const legacySaved = localStorage.getItem(DESKTOP_DATA_KEY);
      if (legacySaved) {
        const legacyData = parseV2Data(legacySaved);
        await desktopAppDataRepository.save(legacyData);
        applyData(legacyData);
        localStorage.removeItem(DESKTOP_DATA_KEY);
      }
    }
    fs.fileName = "PLATYPUS SQLite library";
    fs.status = "ready";
  } catch (e) {
    fs.saveError = e instanceof Error ? e.message : "Failed to load desktop data";
    fs.status = "error";
  }
}

// ─── ID helper ────────────────────────────────────────────────────────────────

function nextId<T extends { id: number }>(arr: T[]): number {
  return arr.length > 0 ? Math.max(...arr.map((x) => x.id)) + 1 : 1;
}

// Provider records from the legacy application use positive provider IDs. Keep
// locally-created records in a separate numeric namespace until the UUID
// migration lands, so adding an item manually can never overwrite a later
// imported provider record with the same number.
function nextLocalId<T extends { id: number }>(arr: T[]): number {
  const localIds = arr.map((item) => item.id).filter((id) => id < 0);
  return localIds.length > 0 ? Math.min(...localIds) - 1 : -1;
}

// ─── Media ────────────────────────────────────────────────────────────────────

export function upsertMedia(media: Media) {
  const idx = appData.media.findIndex((m) => m.id === media.id);
  if (idx >= 0) appData.media[idx] = media;
  else appData.media.push(media);
  persist();
}

export function getMedia(id: number): Media | undefined {
  return appData.media.find((m) => m.id === id);
}

export interface ManualMediaInput {
  title: string;
  kind: MediaKind;
  totalEpisodes?: number | null;
  year?: number | null;
  description?: string | null;
  coverImage?: string | null;
}

/** Create a local item with no remote identity. Manual items are always safe to edit. */
export function createManualMedia(input: ManualMediaInput): Media {
  const now = Date.now();
  const media: Media = {
    id: nextLocalId(appData.media),
    kind: input.kind,
    titleRomaji: input.title.trim(),
    titleEnglish: input.title.trim(),
    titleNative: null,
    status: "FINISHED",
    format: input.kind === "movie" ? "MOVIE" : "TV",
    totalEpisodes: input.kind === "movie" ? null : (input.totalEpisodes ?? null),
    airedEpisodes: input.kind === "movie" ? 1 : (input.totalEpisodes ?? 0),
    nextAiringEpisode: null,
    nextAiringAt: null,
    coverImageLarge: input.coverImage ?? null,
    coverImageMedium: input.coverImage ?? null,
    bannerImage: null,
    season: null,
    seasonYear: input.year ?? null,
    genres: [],
    description: input.description?.trim() || null,
    siteUrl: "",
    externalLinks: [],
    syncedAt: now,
    malId: null,
  };
  appData.media.push(media);
  addToLibrary(media.id);
  persist();
  return media;
}

/**
 * Add a normalized, read-only source result to the local library.  The source
 * contributes a snapshot of metadata; after this point the local item remains
 * usable even if that connection is removed.
 */
export function createMediaFromSource(
  source: NormalizedMedia,
  connection: { id: string; name: string },
): Media {
  const providerUrl = source.canonicalUrl ?? "";
  const existing = appData.media.find(
    (media) =>
      media.providerLinks?.some(
        (link) =>
          link.connectionId === connection.id && link.providerId === String(source.providerId),
      ) ||
      (providerUrl && media.externalLinks.some((link) => link.url === providerUrl)),
  );
  if (existing) {
    addToLibrary(existing.id);
    return existing;
  }

  const year = Number.parseInt((source.releaseDate ?? source.startDate ?? "").slice(0, 4), 10);
  const poster = source.artwork?.find((artwork) => artwork.kind === "poster")?.url ?? null;
  const media: Media = {
    id: nextLocalId(appData.media),
    kind: source.kind,
    titleRomaji: source.title,
    titleEnglish: source.title,
    titleNative: source.originalTitle ?? null,
    status:
      source.lifecycle === "releasing"
        ? "RELEASING"
        : source.lifecycle === "cancelled"
          ? "CANCELLED"
          : "FINISHED",
    format: source.kind === "movie" ? "MOVIE" : "TV",
    totalEpisodes: null,
    airedEpisodes: source.kind === "movie" ? 1 : 0,
    nextAiringEpisode: null,
    nextAiringAt: null,
    coverImageLarge: poster,
    coverImageMedium: poster,
    bannerImage: source.artwork?.find((artwork) => artwork.kind === "backdrop")?.url ?? null,
    season: null,
    seasonYear: Number.isInteger(year) ? year : null,
    genres: source.genres ?? [],
    description: source.overview ?? null,
    siteUrl: providerUrl,
    externalLinks: providerUrl
      ? [{ url: providerUrl, site: connection.name, type: "source", color: null, icon: null }]
      : [],
    syncedAt: Date.now(),
    malId: null,
    providerLinks: [
      {
        connectionId: connection.id,
        connectionName: connection.name,
        providerId: String(source.providerId),
        ...(providerUrl ? { canonicalUrl: providerUrl } : {}),
      },
    ],
    syncSource: {
      kind: "connection",
      connectionId: connection.id,
      providerId: String(source.providerId),
    },
  };
  appData.media.push(media);
  addToLibrary(media.id);
  persist();
  return media;
}

export function updateManualMedia(
  id: number,
  updates: Pick<ManualMediaInput, "title" | "totalEpisodes" | "year" | "description">,
) {
  const media = getMedia(id);
  if (!media) return;
  const title = updates.title.trim();
  Object.assign(media, {
    titleRomaji: title,
    titleEnglish: title,
    totalEpisodes: media.kind === "movie" ? null : (updates.totalEpisodes ?? null),
    airedEpisodes: media.kind === "movie" ? 1 : (updates.totalEpisodes ?? media.airedEpisodes),
    seasonYear: updates.year ?? null,
    description: updates.description?.trim() || null,
  });
  persist();
}

/** Add an episode to a manually-created series. Episode IDs use the same local namespace. */
export function createManualEpisode(mediaId: number, title?: string): Episode | undefined {
  const media = getMedia(mediaId);
  if (!media || (media.kind ?? "series") !== "series") return undefined;
  const existing = appData.episodes.filter((episode) => episode.mediaId === mediaId);
  const episode: Episode = {
    id: nextLocalId(appData.episodes),
    mediaId,
    number: existing.length > 0 ? Math.max(...existing.map((item) => item.number)) + 1 : 1,
    title: title?.trim() || null,
    airingAt: null,
    aired: true,
    watched: false,
    watchedAt: null,
    skipped: false,
    isFiller: false,
    isRecap: false,
    thumbnail: null,
  };
  appData.episodes.push(episode);
  if (media.totalEpisodes !== null)
    media.totalEpisodes = Math.max(media.totalEpisodes, episode.number);
  media.airedEpisodes = Math.max(media.airedEpisodes, episode.number);
  persist();
  return episode;
}

export function mediaWatchEvents(mediaId: number): WatchEvent[] {
  return appData.watchEvents.filter((event) => event.mediaId === mediaId);
}

export function setMovieWatched(mediaId: number, watched: boolean) {
  const media = getMedia(mediaId);
  const kind = media?.kind ?? (media?.format === "MOVIE" ? "movie" : "series");
  if (!media || kind !== "movie") return;
  const eventIndex = appData.watchEvents.findIndex(
    (event) => event.mediaId === mediaId && event.episodeId === null,
  );
  if (watched && eventIndex < 0) {
    appData.watchEvents.push({
      id: nextId(appData.watchEvents),
      mediaId,
      episodeId: null,
      watchedAt: Date.now(),
      progress: 1,
      origin: "manual",
    });
  } else if (!watched && eventIndex >= 0) {
    appData.watchEvents.splice(eventIndex, 1);
  }
  const entry = getLibraryEntry(mediaId);
  if (entry)
    updateLibraryEntry(entry.id, {
      status: watched ? "COMPLETED" : "PLAN_TO_WATCH",
      completedAt: watched ? Date.now() : null,
    });
  persist();
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

export function upsertEpisodes(incoming: Episode[]) {
  for (const ep of incoming) {
    const idx = appData.episodes.findIndex(
      (existing) =>
        existing.id === ep.id ||
        ep.providerLinks?.some((incomingLink) =>
          existing.providerLinks?.some(
            (existingLink) =>
              existingLink.connectionId === incomingLink.connectionId &&
              existingLink.providerId === incomingLink.providerId,
          ),
        ),
    );
    if (idx >= 0) {
      const existing = appData.episodes[idx];
      appData.episodes[idx] = {
        ...ep,
        id: existing.id,
        watched: existing.watched,
        skipped: existing.skipped,
        watchedAt: existing.watchedAt,
      };
    } else {
      appData.episodes.push(ep);
    }
  }
  persist();
}

export function autoUpdateLibraryStatus(mediaId: number) {
  const entryIndex = appData.library.findIndex((l) => l.mediaId === mediaId);
  if (entryIndex < 0) return;
  const entry = appData.library[entryIndex];
  const media = appData.media.find((m) => m.id === mediaId);
  const aired = appData.episodes.filter((e) => e.mediaId === mediaId && e.aired);
  const done = aired.filter((e) => e.watched || e.skipped).length;

  // Only promote to COMPLETED when every episode of the season exists and has aired.
  // An airing show where the user has caught up on all current episodes should stay
  // WATCHING until the finale has aired and been watched.
  const fullyAired =
    !media ||
    media.status === "FINISHED" ||
    (media.totalEpisodes !== null && aired.length >= media.totalEpisodes);

  const newStatus: LibraryStatus =
    aired.length === 0 || done === 0
      ? "PLAN_TO_WATCH"
      : done >= aired.length && fullyAired
        ? "COMPLETED"
        : "WATCHING";
  if (entry.status !== newStatus) {
    // Replacing the record also invalidates consumers that derive a filtered
    // list from the library array, such as the virtualized completed grid.
    appData.library[entryIndex] = {
      ...entry,
      status: newStatus,
      updatedAt: Date.now(),
    };
  }
}

export function setEpisodeState(episodeId: number, state: "unwatched" | "watched" | "skipped") {
  const episodeIndex = appData.episodes.findIndex((e) => e.id === episodeId);
  if (episodeIndex < 0) return;
  const ep: Episode = {
    ...appData.episodes[episodeIndex],
    watched: state === "watched",
    skipped: state === "skipped",
    watchedAt: state === "watched" ? Date.now() : null,
  };
  appData.episodes[episodeIndex] = ep;
  const eventIndex = appData.watchEvents.findIndex((event) => event.episodeId === episodeId);
  if (state === "watched" && eventIndex < 0) {
    appData.watchEvents.push({
      id: nextId(appData.watchEvents),
      mediaId: ep.mediaId,
      episodeId,
      watchedAt: ep.watchedAt ?? Date.now(),
      progress: 1,
      origin: "manual",
    });
  } else if (state !== "watched" && eventIndex >= 0) {
    appData.watchEvents.splice(eventIndex, 1);
  }
  autoUpdateLibraryStatus(ep.mediaId);
  persist();
}

export function cycleEpisodeState(episodeId: number) {
  const ep = appData.episodes.find((e) => e.id === episodeId);
  if (!ep) return;
  if (!ep.watched && !ep.skipped) setEpisodeState(episodeId, "watched");
  else if (ep.watched) setEpisodeState(episodeId, "skipped");
  else setEpisodeState(episodeId, "unwatched");
}

export function toggleEpisodeWatched(episodeId: number) {
  const ep = appData.episodes.find((episode) => episode.id === episodeId);
  if (!ep) return;
  setEpisodeState(episodeId, ep.watched ? "unwatched" : "watched");
}

export function toggleEpisodeSkipped(episodeId: number) {
  const ep = appData.episodes.find((episode) => episode.id === episodeId);
  if (!ep) return;
  setEpisodeState(episodeId, ep.skipped ? "unwatched" : "skipped");
}

export function markAllWatched(mediaId: number) {
  const watchedAt = Date.now();
  for (const ep of appData.episodes.filter((e) => e.mediaId === mediaId)) {
    ep.watched = true;
    ep.skipped = false;
    ep.watchedAt = ep.watchedAt ?? watchedAt;
    if (!appData.watchEvents.some((event) => event.episodeId === ep.id)) {
      appData.watchEvents.push({
        id: nextId(appData.watchEvents),
        mediaId,
        episodeId: ep.id,
        watchedAt: ep.watchedAt,
        progress: 1,
        origin: "manual",
      });
    }
  }
  autoUpdateLibraryStatus(mediaId);
  persist();
}

export function skipAllEpisodes(mediaId: number) {
  for (const ep of appData.episodes.filter((e) => e.mediaId === mediaId)) {
    ep.skipped = true;
    ep.watched = false;
    ep.watchedAt = null;
  }
  appData.watchEvents = appData.watchEvents.filter(
    (event) => event.mediaId !== mediaId || event.episodeId === null,
  );
  autoUpdateLibraryStatus(mediaId);
  persist();
}

export function clearAllWatched(mediaId: number) {
  for (const ep of appData.episodes.filter((e) => e.mediaId === mediaId)) {
    ep.watched = false;
    ep.skipped = false;
    ep.watchedAt = null;
  }
  appData.watchEvents = appData.watchEvents.filter(
    (event) => event.mediaId !== mediaId || event.episodeId === null,
  );
  autoUpdateLibraryStatus(mediaId);
  persist();
}

// ─── Library ──────────────────────────────────────────────────────────────────

export function addToLibrary(
  mediaId: number,
  status: LibraryStatus = "PLAN_TO_WATCH",
): LibraryEntry {
  const existing = appData.library.find((l) => l.mediaId === mediaId);
  if (existing) return existing;
  const entry: LibraryEntry = {
    id: nextId(appData.library),
    mediaId,
    status,
    score: null,
    notes: null,
    startedAt: null,
    completedAt: null,
    addedAt: Date.now(),
    updatedAt: Date.now(),
  };
  appData.library.push(entry);
  persist();
  return entry;
}

export function updateLibraryEntry(
  id: number,
  updates: Partial<Omit<LibraryEntry, "id" | "mediaId" | "addedAt">>,
) {
  const entry = appData.library.find((l) => l.id === id);
  if (!entry) return;
  Object.assign(entry, updates, { updatedAt: Date.now() });
  persist();
}

export function removeFromLibrary(mediaId: number) {
  const idx = appData.library.findIndex((l) => l.mediaId === mediaId);
  if (idx >= 0) appData.library.splice(idx, 1);
  persist();
}

export function getLibraryEntry(mediaId: number): LibraryEntry | undefined {
  return appData.library.find((l) => l.mediaId === mediaId);
}

// ─── Collections ──────────────────────────────────────────────────────────────

export function createCollection(name: string): Collection {
  const collection: Collection = {
    id: nextId(appData.collections),
    name,
    originalName: null,
    coverMediaId: null,
    notes: null,
    createdAt: Date.now(),
  };
  appData.collections.push(collection);
  persist();
  return collection;
}

export function updateCollection(
  id: number,
  updates: Partial<Omit<Collection, "id" | "createdAt">>,
) {
  const c = appData.collections.find((c) => c.id === id);
  if (!c) return;
  Object.assign(c, updates);
  persist();
}

export function deleteCollection(id: number) {
  const idx = appData.collections.findIndex((c) => c.id === id);
  if (idx >= 0) appData.collections.splice(idx, 1);
  let i = appData.collectionEntries.length;
  while (i--) {
    if (appData.collectionEntries[i].collectionId === id) appData.collectionEntries.splice(i, 1);
  }
  persist();
}

export function addMediaToCollection(collectionId: number, mediaId: number) {
  if (
    appData.collectionEntries.find((e) => e.collectionId === collectionId && e.mediaId === mediaId)
  )
    return;
  const maxOrder = Math.max(
    0,
    ...appData.collectionEntries.filter((e) => e.collectionId === collectionId).map((e) => e.order),
  );
  appData.collectionEntries.push({ collectionId, mediaId, order: maxOrder + 1 });
  persist();
}

export function removeMediaFromCollection(collectionId: number, mediaId: number) {
  const idx = appData.collectionEntries.findIndex(
    (e) => e.collectionId === collectionId && e.mediaId === mediaId,
  );
  if (idx >= 0) appData.collectionEntries.splice(idx, 1);
  persist();
}

export function getCollectionMedia(collectionId: number): Media[] {
  return appData.collectionEntries
    .filter((e) => e.collectionId === collectionId)
    .sort((a, b) => a.order - b.order)
    .map((e) => appData.media.find((m) => m.id === e.mediaId))
    .filter((m): m is Media => !!m);
}

// ─── Series ───────────────────────────────────────────────────────────────────

export function createSeries(name: string): Series {
  const s: Series = {
    id: nextId(appData.series),
    name,
    originalName: null,
    coverMediaId: null,
    notes: null,
    createdAt: Date.now(),
  };
  appData.series.push(s);
  persist();
  return s;
}

export function updateSeries(id: number, updates: Partial<Omit<Series, "id" | "createdAt">>) {
  const s = appData.series.find((s) => s.id === id);
  if (!s) return;
  Object.assign(s, updates);
  persist();
}

export function deleteSeries(id: number) {
  const idx = appData.series.findIndex((s) => s.id === id);
  if (idx >= 0) appData.series.splice(idx, 1);
  let i = appData.seriesEntries.length;
  while (i--) {
    if (appData.seriesEntries[i].seriesId === id) appData.seriesEntries.splice(i, 1);
  }
  persist();
}

export function addMediaToSeries(seriesId: number, mediaId: number) {
  if (appData.seriesEntries.find((e) => e.seriesId === seriesId && e.mediaId === mediaId)) return;
  const maxOrder = Math.max(
    0,
    ...appData.seriesEntries.filter((e) => e.seriesId === seriesId).map((e) => e.order),
  );
  appData.seriesEntries.push({ seriesId, mediaId, order: maxOrder + 1 });
  persist();
}

export function removeMediaFromSeries(seriesId: number, mediaId: number) {
  const idx = appData.seriesEntries.findIndex(
    (e) => e.seriesId === seriesId && e.mediaId === mediaId,
  );
  if (idx >= 0) appData.seriesEntries.splice(idx, 1);
  persist();
}

export function getSeriesMedia(seriesId: number): Media[] {
  return appData.seriesEntries
    .filter((e) => e.seriesId === seriesId)
    .sort((a, b) => a.order - b.order)
    .map((e) => appData.media.find((m) => m.id === e.mediaId))
    .filter((m): m is Media => !!m);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function updateSettings(updates: Partial<Settings>) {
  Object.assign(appData.settings, updates);
  persist();
}

export function reorderFilters(order: CollectionFilter[]) {
  appData.settings.filterOrder = order;
  persist();
}
