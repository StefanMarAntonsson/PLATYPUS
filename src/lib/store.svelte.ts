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
import { EMPTY_APP_DATA } from "./legacy-data.js";
import {
  desktopAppDataRepository,
  replaceAllChanges,
  type AppDataChanges,
} from "./repositories.js";
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
  // The import replaces everything, so edits still waiting to be saved are moot.
  clearTimeout(_saveTimer);
  _saveTimer = undefined;
  _pending = emptyPending();
  await enqueueWrite(() => desktopAppDataRepository.applyChanges(replaceAllChanges(preview.data)));
  applyData(preview.data);
  fs.status = "ready";
}

// ─── Persist (debounced, record-level) ───────────────────────────────────────

const ID_AREAS = ["media", "episodes", "watchEvents", "library", "collections", "series"] as const;
type IdArea = (typeof ID_AREAS)[number];
const ENTRY_AREAS = ["collectionEntries", "seriesEntries"] as const;
type EntryArea = (typeof ENTRY_AREAS)[number];

/**
 * The records a mutation touched. Listed IDs are written if the record still
 * exists and deleted if it does not. Collection and series memberships are
 * small and have no IDs, so they are saved as a whole area.
 */
export type ChangeMarks = { [A in IdArea]?: Iterable<number> } & {
  [A in EntryArea]?: boolean;
} & { settings?: boolean };

interface PendingChanges {
  ids: Record<IdArea, Set<number>>;
  entryAreas: Set<EntryArea>;
  settings: boolean;
}

function emptyPending(): PendingChanges {
  return {
    ids: {
      media: new Set(),
      episodes: new Set(),
      watchEvents: new Set(),
      library: new Set(),
      collections: new Set(),
      series: new Set(),
    },
    entryAreas: new Set(),
    settings: false,
  };
}

// Private — not reactive, used to debounce and serialize native writes.
let _pending = emptyPending();
let _saveTimer: ReturnType<typeof setTimeout> | undefined;
let _writeQueue: Promise<void> = Promise.resolve();
let _queuedWrites = 0;

function mark(pending: PendingChanges, changes: ChangeMarks) {
  for (const area of ID_AREAS) {
    for (const id of changes[area] ?? []) pending.ids[area].add(id);
  }
  for (const area of ENTRY_AREAS) {
    if (changes[area]) pending.entryAreas.add(area);
  }
  if (changes.settings) pending.settings = true;
}

/** Record which data changed and schedule a save of just those records. */
export function persist(changes: ChangeMarks) {
  mark(_pending, changes);
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => void doSave(), 200);
}

function buildChanges(pending: PendingChanges): AppDataChanges | null {
  const changes: AppDataChanges = {};
  let empty = true;
  for (const area of ID_AREAS) {
    const ids = pending.ids[area];
    if (ids.size === 0) continue;
    const found = new Set<number>();
    const upserts: unknown[] = [];
    for (const record of appData[area] as Array<{ id: number }>) {
      if (!ids.has(record.id)) continue;
      found.add(record.id);
      upserts.push($state.snapshot(record));
    }
    const deletes = [...ids].filter((id) => !found.has(id));
    if (upserts.length) (changes.upsert ??= {})[area] = upserts as never;
    if (deletes.length) (changes.delete ??= {})[area] = deletes;
    empty = false;
  }
  for (const area of pending.entryAreas) {
    (changes.replace ??= {})[area] = $state.snapshot(appData[area]) as never;
    empty = false;
  }
  if (pending.settings) {
    changes.settings = $state.snapshot(appData.settings);
    empty = false;
  }
  return empty ? null : changes;
}

/** Run native writes one at a time, in the order they were requested. */
function enqueueWrite(write: () => Promise<void>): Promise<void> {
  _queuedWrites++;
  fs.isSaving = true;
  const result = _writeQueue.then(write);
  _writeQueue = result
    .catch(() => undefined)
    .finally(() => {
      if (--_queuedWrites === 0) fs.isSaving = false;
    });
  return result;
}

function doSave(): Promise<void> {
  _saveTimer = undefined;
  const pending = _pending;
  _pending = emptyPending();
  // Copy the records now; edits made while this write runs join the next one.
  const changes = buildChanges(pending);
  if (!changes) return _writeQueue;
  return enqueueWrite(() => desktopAppDataRepository.applyChanges(changes)).then(
    () => {
      fs.saveError = "";
    },
    (e: unknown) => {
      fs.saveError = e instanceof Error ? e.message : "Save failed";
      // Keep the failed records queued so the next save retries them.
      mark(_pending, {
        ...Object.fromEntries(ID_AREAS.map((area) => [area, pending.ids[area]])),
        ...Object.fromEntries([...pending.entryAreas].map((area) => [area, true])),
        settings: pending.settings,
      });
    },
  );
}

/** Finish any queued native write, e.g. before a restart or window close. */
export async function flushPendingSave(): Promise<void> {
  if (_saveTimer !== undefined) {
    clearTimeout(_saveTimer);
    await doSave();
  }
  await _writeQueue;

  if (fs.saveError) {
    throw new Error(`PLATYPUS could not save your library: ${fs.saveError}`);
  }
}

// ─── Public file operations ───────────────────────────────────────────────────

export async function initFile(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const saved = await desktopAppDataRepository.load();
    if (saved) applyData(saved);
    fs.fileName = "PLATYPUS SQLite library";
    fs.status = "ready";
  } catch (e) {
    fs.saveError = e instanceof Error ? e.message : "Failed to load desktop data";
    fs.status = "error";
  }
}

// ─── ID helper ────────────────────────────────────────────────────────────────

// Loops instead of Math.max(...array): spreading a very large array into call
// arguments is slow and can overflow the engine's argument limit.
function maxOf<T>(arr: T[], value: (item: T) => number, initial: number): number {
  let max = initial;
  for (const item of arr) {
    const v = value(item);
    if (v > max) max = v;
  }
  return max;
}

function nextId<T extends { id: number }>(arr: T[]): number {
  return maxOf(arr, (x) => x.id, 0) + 1;
}

// Provider records from the legacy application use positive provider IDs. Keep
// locally-created records in a separate numeric namespace until the UUID
// migration lands, so adding an item manually can never overwrite a later
// imported provider record with the same number.
function nextLocalId<T extends { id: number }>(arr: T[]): number {
  return -maxOf(arr, (item) => -item.id, 0) - 1;
}

// ─── Media ────────────────────────────────────────────────────────────────────

export function upsertMedia(media: Media) {
  const idx = appData.media.findIndex((m) => m.id === media.id);
  if (idx >= 0) appData.media[idx] = media;
  else appData.media.push(media);
  persist({ media: [media.id] });
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
  persist({ media: [media.id] });
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
    titleRomaji: source.titleRomaji ?? source.title,
    titleEnglish: source.titleEnglish ?? source.title,
    titleNative: source.titleNative ?? source.originalTitle ?? null,
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
  persist({ media: [media.id] });
  return media;
}

/** Attach a configured provider identity to an existing local or legacy item. */
export function attachSourceToMedia(
  mediaId: number,
  source: NormalizedMedia,
  connection: { id: string; name: string },
): Media | undefined {
  const media = getMedia(mediaId);
  if (!media) return undefined;

  const providerId = String(source.providerId);
  const canonicalUrl = source.canonicalUrl ?? undefined;
  const providerLinks = media.providerLinks ?? [];
  const alreadyAttached = providerLinks.some(
    (link) => link.connectionId === connection.id && link.providerId === providerId,
  );

  if (!alreadyAttached) {
    media.providerLinks = [
      ...providerLinks,
      {
        connectionId: connection.id,
        connectionName: connection.name,
        providerId,
        ...(canonicalUrl ? { canonicalUrl } : {}),
      },
    ];
  }
  media.syncSource = { kind: "connection", connectionId: connection.id, providerId };

  if (canonicalUrl && !media.externalLinks.some((link) => link.url === canonicalUrl)) {
    media.externalLinks = [
      ...media.externalLinks,
      {
        url: canonicalUrl,
        site: connection.name,
        type: "source",
        color: null,
        icon: null,
      },
    ];
  }

  persist({ media: [media.id] });
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
  persist({ media: [media.id] });
}

/** Add an episode to a manually-created series. Episode IDs use the same local namespace. */
export function createManualEpisode(mediaId: number, title?: string): Episode | undefined {
  const media = getMedia(mediaId);
  if (!media || (media.kind ?? "series") !== "series") return undefined;
  const existing = appData.episodes.filter((episode) => episode.mediaId === mediaId);
  const episode: Episode = {
    id: nextLocalId(appData.episodes),
    mediaId,
    number: maxOf(existing, (item) => item.number, 0) + 1,
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
  persist({ media: [mediaId], episodes: [episode.id] });
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
  const changedEvents: number[] = [];
  if (watched && eventIndex < 0) {
    const id = nextId(appData.watchEvents);
    changedEvents.push(id);
    appData.watchEvents.push({
      id,
      mediaId,
      episodeId: null,
      watchedAt: Date.now(),
      progress: 1,
      origin: "manual",
    });
  } else if (!watched && eventIndex >= 0) {
    changedEvents.push(appData.watchEvents[eventIndex].id);
    appData.watchEvents.splice(eventIndex, 1);
  }
  const entry = getLibraryEntry(mediaId);
  if (entry)
    updateLibraryEntry(entry.id, {
      status: watched ? "COMPLETED" : "PLAN_TO_WATCH",
      completedAt: watched ? Date.now() : null,
    });
  persist({ watchEvents: changedEvents });
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

type ProviderLink = NonNullable<Episode["providerLinks"]>[number];

const numberKey = (episode: Pick<Episode, "mediaId" | "number">) =>
  `${episode.mediaId}:${episode.number}`;
const providerKey = (link: ProviderLink) => `${link.connectionId}\u0000${link.providerId}`;

function sharesProviderLink(a: Episode, b: Episode): boolean {
  return !!a.providerLinks?.some((incomingLink) =>
    b.providerLinks?.some(
      (existingLink) =>
        existingLink.connectionId === incomingLink.connectionId &&
        existingLink.providerId === incomingLink.providerId,
    ),
  );
}

/**
 * Merge synced episodes into the library. Episodes match an existing record by
 * ID, by media and episode number, or by a shared provider identity; several
 * matches are collapsed into one record that keeps the user's watch state.
 */
export function upsertEpisodes(incoming: Episode[]) {
  if (incoming.length === 0) return;

  // Work on plain records with lookup tables built once. Searching the
  // reactive array for every incoming episode made each sync O(stored × new).
  const slots: Array<Episode | null> = $state.snapshot(appData.episodes) as Episode[];
  const byId = new Map<number, number>();
  const byNumber = new Map<string, Set<number>>();
  const byProvider = new Map<string, Set<number>>();
  const addToIndex = (map: Map<string, Set<number>>, key: string, index: number) => {
    const indexes = map.get(key);
    if (indexes) indexes.add(index);
    else map.set(key, new Set([index]));
  };
  const index = (episode: Episode, slot: number) => {
    byId.set(episode.id, slot);
    addToIndex(byNumber, numberKey(episode), slot);
    for (const link of episode.providerLinks ?? []) addToIndex(byProvider, providerKey(link), slot);
  };
  slots.forEach((episode, slot) => episode && index(episode, slot));
  const changedEpisodes = new Set<number>();
  const changedEvents = new Set<number>();

  for (const ep of incoming) {
    // Index entries can go stale as records are replaced, so every candidate
    // is re-checked against the record currently in its slot.
    const candidates = new Set<number>();
    const idSlot = byId.get(ep.id);
    if (idSlot !== undefined) candidates.add(idSlot);
    for (const slot of byNumber.get(numberKey(ep)) ?? []) candidates.add(slot);
    for (const link of ep.providerLinks ?? []) {
      for (const slot of byProvider.get(providerKey(link)) ?? []) candidates.add(slot);
    }
    const matchingIndexes = [...candidates]
      .filter((slot) => {
        const existing = slots[slot];
        return (
          !!existing &&
          (existing.id === ep.id ||
            (existing.mediaId === ep.mediaId && existing.number === ep.number) ||
            sharesProviderLink(ep, existing))
        );
      })
      .sort((a, b) => a - b);

    if (matchingIndexes.length === 0) {
      slots.push(ep);
      index(ep, slots.length - 1);
      changedEpisodes.add(ep.id);
      continue;
    }

    const matches = matchingIndexes.map((slot) => slots[slot] as Episode);
    const watchedMatch = matches.find((episode) => episode.watched);
    const skippedMatch = matches.find((episode) => episode.skipped);
    const identityMatch = matches.find((episode) => sharesProviderLink(ep, episode));
    const canonical = watchedMatch ?? skippedMatch ?? identityMatch ?? matches[0];
    const canonicalIndex = matchingIndexes[matches.indexOf(canonical)];
    const watched = !!watchedMatch;
    const merged: Episode = {
      ...ep,
      id: canonical.id,
      title: ep.title ?? matches.find((episode) => episode.title)?.title ?? null,
      thumbnail: ep.thumbnail ?? matches.find((episode) => episode.thumbnail)?.thumbnail ?? null,
      watched,
      skipped: !watched && !!skippedMatch,
      watchedAt: watched ? (watchedMatch?.watchedAt ?? Date.now()) : null,
    };
    slots[canonicalIndex] = merged;
    index(merged, canonicalIndex);
    changedEpisodes.add(merged.id);

    const duplicateIds = new Set<number>();
    for (const [position, slot] of matchingIndexes.entries()) {
      if (slot === canonicalIndex) continue;
      duplicateIds.add(matches[position].id);
      changedEpisodes.add(matches[position].id);
      slots[slot] = null;
    }
    if (duplicateIds.size > 0) {
      for (const event of appData.watchEvents) {
        if (event.episodeId !== null && duplicateIds.has(event.episodeId)) {
          event.episodeId = canonical.id;
          changedEvents.add(event.id);
        }
      }
    }
  }

  appData.episodes = slots.filter((episode): episode is Episode => episode !== null);
  persist({ episodes: changedEpisodes, watchEvents: changedEvents });
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
    persist({ library: [entry.id] });
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
  const changedEvents: number[] = [];
  if (state === "watched" && eventIndex < 0) {
    const id = nextId(appData.watchEvents);
    changedEvents.push(id);
    appData.watchEvents.push({
      id,
      mediaId: ep.mediaId,
      episodeId,
      watchedAt: ep.watchedAt ?? Date.now(),
      progress: 1,
      origin: "manual",
    });
  } else if (state !== "watched" && eventIndex >= 0) {
    changedEvents.push(appData.watchEvents[eventIndex].id);
    appData.watchEvents.splice(eventIndex, 1);
  }
  autoUpdateLibraryStatus(ep.mediaId);
  persist({ episodes: [episodeId], watchEvents: changedEvents });
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
  const episodesWithEvents = new Set(appData.watchEvents.map((event) => event.episodeId));
  let eventId = nextId(appData.watchEvents);
  const changedEpisodes: number[] = [];
  const changedEvents: number[] = [];
  for (const ep of appData.episodes.filter((e) => e.mediaId === mediaId)) {
    ep.watched = true;
    ep.skipped = false;
    ep.watchedAt = ep.watchedAt ?? watchedAt;
    changedEpisodes.push(ep.id);
    if (!episodesWithEvents.has(ep.id)) {
      changedEvents.push(eventId);
      appData.watchEvents.push({
        id: eventId++,
        mediaId,
        episodeId: ep.id,
        watchedAt: ep.watchedAt,
        progress: 1,
        origin: "manual",
      });
    }
  }
  autoUpdateLibraryStatus(mediaId);
  persist({ episodes: changedEpisodes, watchEvents: changedEvents });
}

/** Clear every episode's watch state for a title, optionally marking them skipped. */
function resetAllEpisodes(mediaId: number, skipped: boolean) {
  const changedEpisodes: number[] = [];
  for (const ep of appData.episodes.filter((e) => e.mediaId === mediaId)) {
    ep.skipped = skipped;
    ep.watched = false;
    ep.watchedAt = null;
    changedEpisodes.push(ep.id);
  }
  const removedEvents: number[] = [];
  appData.watchEvents = appData.watchEvents.filter((event) => {
    const keep = event.mediaId !== mediaId || event.episodeId === null;
    if (!keep) removedEvents.push(event.id);
    return keep;
  });
  autoUpdateLibraryStatus(mediaId);
  persist({ episodes: changedEpisodes, watchEvents: removedEvents });
}

export function skipAllEpisodes(mediaId: number) {
  resetAllEpisodes(mediaId, true);
}

export function clearAllWatched(mediaId: number) {
  resetAllEpisodes(mediaId, false);
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
  persist({ library: [entry.id] });
  return entry;
}

export function updateLibraryEntry(
  id: number,
  updates: Partial<Omit<LibraryEntry, "id" | "mediaId" | "addedAt">>,
) {
  const entry = appData.library.find((l) => l.id === id);
  if (!entry) return;
  Object.assign(entry, updates, { updatedAt: Date.now() });
  persist({ library: [entry.id] });
}

export function removeFromLibrary(mediaId: number) {
  const idx = appData.library.findIndex((l) => l.mediaId === mediaId);
  if (idx < 0) return;
  const [removed] = appData.library.splice(idx, 1);
  persist({ library: [removed.id] });
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
  persist({ collections: [collection.id] });
  return collection;
}

export function updateCollection(
  id: number,
  updates: Partial<Omit<Collection, "id" | "createdAt">>,
) {
  const c = appData.collections.find((c) => c.id === id);
  if (!c) return;
  Object.assign(c, updates);
  persist({ collections: [id] });
}

export function deleteCollection(id: number) {
  const idx = appData.collections.findIndex((c) => c.id === id);
  if (idx >= 0) appData.collections.splice(idx, 1);
  let i = appData.collectionEntries.length;
  while (i--) {
    if (appData.collectionEntries[i].collectionId === id) appData.collectionEntries.splice(i, 1);
  }
  persist({ collections: [id], collectionEntries: true });
}

export function addMediaToCollection(collectionId: number, mediaId: number) {
  if (
    appData.collectionEntries.find((e) => e.collectionId === collectionId && e.mediaId === mediaId)
  )
    return;
  const maxOrder = maxOf(
    appData.collectionEntries.filter((e) => e.collectionId === collectionId),
    (e) => e.order,
    0,
  );
  appData.collectionEntries.push({ collectionId, mediaId, order: maxOrder + 1 });
  persist({ collectionEntries: true });
}

export function removeMediaFromCollection(collectionId: number, mediaId: number) {
  const idx = appData.collectionEntries.findIndex(
    (e) => e.collectionId === collectionId && e.mediaId === mediaId,
  );
  if (idx >= 0) appData.collectionEntries.splice(idx, 1);
  persist({ collectionEntries: true });
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
  persist({ series: [s.id] });
  return s;
}

export function updateSeries(id: number, updates: Partial<Omit<Series, "id" | "createdAt">>) {
  const s = appData.series.find((s) => s.id === id);
  if (!s) return;
  Object.assign(s, updates);
  persist({ series: [id] });
}

export function deleteSeries(id: number) {
  const idx = appData.series.findIndex((s) => s.id === id);
  if (idx >= 0) appData.series.splice(idx, 1);
  let i = appData.seriesEntries.length;
  while (i--) {
    if (appData.seriesEntries[i].seriesId === id) appData.seriesEntries.splice(i, 1);
  }
  persist({ series: [id], seriesEntries: true });
}

export function addMediaToSeries(seriesId: number, mediaId: number) {
  if (appData.seriesEntries.find((e) => e.seriesId === seriesId && e.mediaId === mediaId)) return;
  const maxOrder = maxOf(
    appData.seriesEntries.filter((e) => e.seriesId === seriesId),
    (e) => e.order,
    0,
  );
  appData.seriesEntries.push({ seriesId, mediaId, order: maxOrder + 1 });
  persist({ seriesEntries: true });
}

export function removeMediaFromSeries(seriesId: number, mediaId: number) {
  const idx = appData.seriesEntries.findIndex(
    (e) => e.seriesId === seriesId && e.mediaId === mediaId,
  );
  if (idx >= 0) appData.seriesEntries.splice(idx, 1);
  persist({ seriesEntries: true });
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
  persist({ settings: true });
}

export function reorderFilters(order: CollectionFilter[]) {
  appData.settings.filterOrder = order;
  persist({ settings: true });
}
