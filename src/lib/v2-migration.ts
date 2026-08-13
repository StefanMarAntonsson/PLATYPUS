import { parseV2Data } from "./legacy-data.js";
import type { AppData, WatchEvent } from "./types.js";

export interface V2MigrationReport {
  sourceVersion: 2;
  media: number;
  episodes: number;
  libraryEntries: number;
  collections: number;
  series: number;
  existingWatchEvents: number;
  watchEventsCreated: number;
  skippedEpisodes: number;
  providerLinksPreserved: number;
  /** Records which deliberately need review instead of being silently merged. */
  conflicts: string[];
  warnings: string[];
}

export interface V2MigrationPreview {
  data: AppData;
  report: V2MigrationReport;
}

function assertRecords(
  items: unknown[],
  label: string,
): asserts items is Record<string, unknown>[] {
  if (items.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    throw new Error(`Cannot import v2 backup: ${label} contains an invalid record.`);
  }
}

function assertUnique<T extends { id: number }>(items: T[], label: string) {
  const ids = new Set<number>();
  for (const item of items) {
    if (!Number.isInteger(item.id) || ids.has(item.id)) {
      throw new Error(`Cannot import v2 backup: ${label} contains a duplicate or invalid ID.`);
    }
    ids.add(item.id);
  }
}

function requireInteger(record: Record<string, unknown>, field: string, label: string): number {
  const value = record[field];
  if (!Number.isInteger(value)) {
    throw new Error(`Cannot import v2 backup: ${label} has an invalid ${field}.`);
  }
  return value as number;
}

/**
 * Produces an import-ready copy of a version 2 backup without changing the
 * active library. Reference failures are fatal so the caller can leave the
 * current SQLite transaction untouched.
 */
export function previewV2Migration(text: string): V2MigrationPreview {
  const data = structuredClone(parseV2Data(text));
  assertRecords(data.media, "media");
  assertRecords(data.episodes, "episodes");
  assertRecords(data.watchEvents, "watch events");
  assertRecords(data.library, "library entries");
  assertRecords(data.collections, "collections");
  assertRecords(data.collectionEntries, "collection entries");
  assertRecords(data.series, "series");
  assertRecords(data.seriesEntries, "series entries");
  assertUnique(data.media, "media");
  assertUnique(data.episodes, "episodes");
  assertUnique(data.library, "library entries");
  assertUnique(data.collections, "collections");
  assertUnique(data.series, "series");
  assertUnique(data.watchEvents, "watch events");

  const mediaIds = new Set(data.media.map((media) => media.id));
  const episodeIds = new Set(data.episodes.map((episode) => episode.id));
  const collectionIds = new Set(data.collections.map((collection) => collection.id));
  const seriesIds = new Set(data.series.map((series) => series.id));
  const requireMedia = (mediaId: number, label: string) => {
    if (!mediaIds.has(mediaId))
      throw new Error(`Cannot import v2 backup: ${label} refers to missing media ${mediaId}.`);
  };
  for (const episode of data.episodes) {
    requireMedia(
      requireInteger(episode, "mediaId", `episode ${episode.id}`),
      `episode ${episode.id}`,
    );
  }
  for (const entry of data.library) {
    requireMedia(
      requireInteger(entry, "mediaId", `library entry ${entry.id}`),
      `library entry ${entry.id}`,
    );
  }
  for (const entry of data.collectionEntries) {
    requireMedia(requireInteger(entry, "mediaId", "collection entry"), "collection entry");
    if (!collectionIds.has(requireInteger(entry, "collectionId", "collection entry")))
      throw new Error(
        `Cannot import v2 backup: collection entry refers to missing collection ${entry.collectionId}.`,
      );
  }
  for (const entry of data.seriesEntries) {
    requireMedia(requireInteger(entry, "mediaId", "series entry"), "series entry");
    if (!seriesIds.has(requireInteger(entry, "seriesId", "series entry")))
      throw new Error(
        `Cannot import v2 backup: series entry refers to missing series ${entry.seriesId}.`,
      );
  }
  for (const event of data.watchEvents) {
    const mediaId = requireInteger(event, "mediaId", `watch event ${event.id}`);
    requireMedia(mediaId, `watch event ${event.id}`);
    if (event.episodeId !== null) {
      const episodeId = requireInteger(event, "episodeId", `watch event ${event.id}`);
      if (!episodeIds.has(episodeId))
        throw new Error(
          `Cannot import v2 backup: watch event ${event.id} refers to a missing episode.`,
        );
      const episode = data.episodes.find((candidate) => candidate.id === episodeId)!;
      if (episode.mediaId !== mediaId)
        throw new Error(
          `Cannot import v2 backup: watch event ${event.id} belongs to a different media item than episode ${event.episodeId}.`,
        );
    }
  }

  const eventTargets = new Set(
    data.watchEvents.map((event) => `${event.mediaId}:${event.episodeId ?? "movie"}`),
  );
  let nextEventId = data.watchEvents.reduce((max, event) => Math.max(max, event.id), 0) + 1;
  let watchEventsCreated = 0;
  for (const episode of data.episodes) {
    const target = `${episode.mediaId}:${episode.id}`;
    if (episode.watched && !eventTargets.has(target)) {
      const event: WatchEvent = {
        id: nextEventId++,
        mediaId: episode.mediaId,
        episodeId: episode.id,
        watchedAt: episode.watchedAt ?? Date.now(),
        progress: 1,
        origin: "legacy",
      };
      data.watchEvents.push(event);
      eventTargets.add(target);
      watchEventsCreated++;
    }
  }

  const providerLinksPreserved = data.media.reduce(
    (count, media) => count + (media.id > 0 ? 1 : 0) + (media.malId !== null ? 1 : 0),
    0,
  );
  const conflicts: string[] = [];
  const collectionNames = new Set(
    data.collections.map((collection) => collection.name.trim().toLocaleLowerCase()),
  );
  for (const series of data.series) {
    if (collectionNames.has(series.name.trim().toLocaleLowerCase())) {
      conflicts.push(`"${series.name}" exists as both a collection and a legacy series group.`);
    }
  }

  return {
    data,
    report: {
      sourceVersion: 2,
      media: data.media.length,
      episodes: data.episodes.length,
      libraryEntries: data.library.length,
      collections: data.collections.length,
      series: data.series.length,
      existingWatchEvents: data.watchEvents.length - watchEventsCreated,
      watchEventsCreated,
      skippedEpisodes: data.episodes.filter((episode) => episode.skipped).length,
      providerLinksPreserved,
      conflicts,
      warnings: data.series.length
        ? ["Legacy series groups were preserved separately from collections."]
        : [],
    },
  };
}
