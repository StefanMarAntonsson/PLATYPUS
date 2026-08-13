import type { Media, Episode } from "$lib/types.js";
import { sleep } from "./http.js";
import { notify } from "$lib/notifications.svelte.js";
import { appData, getMedia, upsertMedia, upsertEpisodes } from "$lib/store.svelte.js";
import { fetchSourceMediaUpdate } from "$lib/sources.svelte.js";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : "Unknown error");

export interface SyncResult {
  status: "success" | "up-to-date" | "error";
  message?: string;
  added?: number;
  updated?: number;
}

// In-flight deduplication: if syncMedia(id) is called while id is already syncing,
// both callers share the same promise and get the same result.
const inFlight = new Map<number, Promise<SyncResult>>();

function sourceTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sourceNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return sourceText(value);
}

function plainText(value: string | undefined): string | null {
  if (!value) return null;
  return (
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}

function mediaStatusFromLifecycle(
  lifecycle: NonNullable<
    Awaited<ReturnType<typeof fetchSourceMediaUpdate>>["details"]
  >["lifecycle"],
  fallback: Media["status"],
): Media["status"] {
  if (lifecycle === "releasing") return "RELEASING";
  if (lifecycle === "ended") return "FINISHED";
  if (lifecycle === "cancelled") return "CANCELLED";
  if (lifecycle === "announced" || lifecycle === "in_production") return "NOT_YET_RELEASED";
  return fallback;
}

async function _syncConfiguredSourceMedia(
  media: Media,
  connectionId: string,
  providerId: string,
): Promise<SyncResult> {
  const label = media.titleEnglish ?? media.titleRomaji;
  try {
    const update = await fetchSourceMediaUpdate(connectionId, providerId);
    const { details } = update;

    if (details) {
      const poster = details.artwork?.find((artwork) => artwork.kind === "poster")?.url;
      const backdrop = details.artwork?.find((artwork) => artwork.kind === "backdrop")?.url;
      const year = Number.parseInt(
        (details.releaseDate ?? details.startDate ?? "").slice(0, 4),
        10,
      );
      Object.assign(media, {
        kind: details.kind,
        titleRomaji: details.title,
        titleEnglish: details.title,
        titleNative: details.originalTitle ?? media.titleNative,
        status: details.lifecycle
          ? mediaStatusFromLifecycle(details.lifecycle, media.status)
          : media.status,
        format: details.kind === "movie" ? "MOVIE" : "TV",
        coverImageLarge: poster ?? media.coverImageLarge,
        coverImageMedium: poster ?? media.coverImageMedium,
        bannerImage: backdrop ?? media.bannerImage,
        seasonYear: Number.isInteger(year) ? year : media.seasonYear,
        genres: details.genres ?? media.genres,
        description: plainText(details.overview) ?? media.description,
        siteUrl: details.canonicalUrl ?? media.siteUrl,
      });
    }

    const episodeRecords = update.episodes ?? [];
    const sourceEpisodes = episodeRecords
      .map((record) => ({
        record,
        providerId: sourceId(record.providerId),
        season: sourceNumber(record.seasonNumber),
        episode: sourceNumber(record.episodeNumber),
      }))
      .filter(
        (item): item is typeof item & { providerId: string; episode: number } =>
          item.providerId !== null && item.episode !== null,
      )
      .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.episode - b.episode);
    const now = Date.now();
    const episodes: Episode[] = sourceEpisodes.map((item, index) => {
      const airingAt =
        sourceTimestamp(item.record.airingAt) ?? sourceTimestamp(item.record.airDate);
      return {
        id: -Math.abs(media.id * 100000) - index - 1,
        mediaId: media.id,
        number: index + 1,
        title: sourceText(item.record.title),
        airingAt,
        aired: airingAt === null || airingAt <= now,
        watched: false,
        watchedAt: null,
        skipped: false,
        isFiller: false,
        isRecap: false,
        thumbnail: null,
        seasonNumber: item.season,
        sourceEpisodeNumber: item.episode,
        providerLinks: [{ connectionId, providerId: item.providerId }],
      };
    });

    if (update.episodes) {
      upsertEpisodes(episodes);
      media.totalEpisodes = episodes.length;
      media.airedEpisodes = episodes.filter((episode) => episode.aired).length;
      const nextAiring = episodes
        .filter((episode) => episode.airingAt !== null && episode.airingAt > now)
        .sort((a, b) => (a.airingAt as number) - (b.airingAt as number))[0];
      media.nextAiringEpisode = nextAiring?.number ?? null;
      media.nextAiringAt = nextAiring?.airingAt ?? null;
    }
    media.syncedAt = Date.now();
    media.syncSource = { kind: "connection", connectionId, providerId };
    upsertMedia(media);
    return { status: "success", added: episodes.length };
  } catch (error) {
    const message = errMsg(error);
    notify("error", "Failed to sync", `${label}: ${message}`);
    return { status: "error", message };
  }
}

function syncTarget(mediaId: number): Media["syncSource"] | undefined {
  const media = getMedia(mediaId);
  if (media?.syncSource) return media.syncSource;
  const sourceLink = media?.providerLinks?.[0];
  if (sourceLink) {
    return {
      kind: "connection",
      connectionId: sourceLink.connectionId,
      providerId: sourceLink.providerId,
    };
  }
  return undefined;
}

export function syncMedia(mediaId: number): Promise<SyncResult> {
  const existing = inFlight.get(mediaId);
  if (existing) return existing;
  const target = syncTarget(mediaId);
  const media = getMedia(mediaId);
  const promise = (
    target?.kind === "connection" && media
      ? _syncConfiguredSourceMedia(media, target.connectionId, target.providerId)
      : Promise.resolve({
          status: "error",
          message: "No configured sync source is attached",
        } as SyncResult)
  ).finally(() => inFlight.delete(mediaId));
  inFlight.set(mediaId, promise);
  return promise;
}

// Keep bulk synchronization conservative across user-configured providers.
const BULK_THROTTLE_MS = 700;

export async function syncAllLibrary(): Promise<SyncResult> {
  const ids = appData.library
    .map((entry) => entry.mediaId)
    .filter((mediaId) => syncTarget(mediaId) !== undefined);
  let errors = 0;

  for (let i = 0; i < ids.length; i++) {
    const r = await syncMedia(ids[i]);
    if (r.status === "error") errors++;
    if (i < ids.length - 1) await sleep(BULK_THROTTLE_MS);
  }

  if (errors === 0) {
    notify(
      "success",
      "Library synced",
      `${ids.length} title${ids.length === 1 ? "" : "s"} updated.`,
    );
    return { status: "success", updated: ids.length };
  }
  // Per-title failures are surfaced individually from _syncMedia.
  return { status: "error", message: `${errors} of ${ids.length} failed` };
}

export async function syncAiringLibrary(
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
  const { syncFilters } = appData.settings;
  const ids = appData.library
    .map((l) => appData.media.find((m) => m.id === l.mediaId))
    .filter((m): m is Media => !!m)
    .filter(
      (m) =>
        (syncFilters.airing && m.status === "RELEASING") ||
        (syncFilters.upcoming && m.status === "NOT_YET_RELEASED") ||
        (syncFilters.hiatus && m.status === "HIATUS"),
    )
    .filter((media) => syncTarget(media.id) !== undefined)
    .map((m) => m.id);

  let errors = 0;
  let done = 0;
  onProgress?.(0, ids.length);

  for (let i = 0; i < ids.length; i++) {
    if (signal?.aborted) break;
    const r = await syncMedia(ids[i]);
    if (r.status === "error") errors++;
    done++;
    onProgress?.(done, ids.length);
    if (i < ids.length - 1) {
      try {
        await sleep(BULK_THROTTLE_MS, signal);
      } catch {
        break; // aborted during the throttle gap
      }
    }
  }

  if (errors > 0) {
    // Per-title failures are surfaced individually from _syncMedia.
    return { status: "error", message: `${errors} of ${ids.length} failed` };
  }
  // Don't announce a cancelled or no-op run.
  if (!signal?.aborted && done > 0) {
    notify("success", "Airing titles synced", `${done} title${done === 1 ? "" : "s"} updated.`);
  }
  return { status: "success", updated: done };
}
