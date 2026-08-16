import type { Media, Episode } from "$lib/types.js";
import { isConnectorUnavailableError } from "$lib/connectors/engine.js";
import { sleep } from "./http.js";
import { notify } from "$lib/notifications.svelte.js";
import { appData, getMedia, upsertMedia, upsertEpisodes } from "$lib/store.svelte.js";
import {
  canRefreshFromSource,
  fetchSourceMediaUpdate,
  refreshConnectionForTemplate,
} from "$lib/sources.svelte.js";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : "Unknown error");

export interface SyncResult {
  status: "success" | "up-to-date" | "error";
  message?: string;
  added?: number;
  updated?: number;
  /** Internal bulk-sync signal: retrying another item on this connection is unsafe. */
  connectionUnavailable?: boolean;
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

function legacyAniListProviderId(media: Media): string | undefined {
  if (media.id <= 0 || !media.siteUrl) return undefined;
  try {
    const url = new URL(media.siteUrl);
    const [kind, providerId] = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol === "https:" &&
      url.hostname === "anilist.co" &&
      kind === "anime" &&
      /^\d+$/.test(providerId ?? "") &&
      Number(providerId) === media.id
    ) {
      return providerId;
    }
  } catch {
    // Imported legacy URLs are untrusted data. An invalid URL is simply not a sync identity.
  }
  return undefined;
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
        titleRomaji:
          sourceText(details.titleRomaji) ?? sourceText(details.title) ?? media.titleRomaji,
        titleEnglish: sourceText(details.titleEnglish) ?? media.titleEnglish,
        titleNative:
          sourceText(details.titleNative) ?? sourceText(details.originalTitle) ?? media.titleNative,
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
      const storedEpisodes = appData.episodes.filter((episode) => episode.mediaId === media.id);
      media.totalEpisodes = Math.max(media.totalEpisodes ?? 0, storedEpisodes.length);
      media.airedEpisodes = storedEpisodes.filter((episode) => episode.aired).length;
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
    return {
      status: "error",
      message,
      ...(isConnectorUnavailableError(error) ? { connectionUnavailable: true } : {}),
    };
  }
}

function syncTarget(
  mediaId: number,
): Extract<Media["syncSource"], { kind: "connection" }> | undefined {
  const media = getMedia(mediaId);
  if (media?.syncSource?.kind === "connection") return media.syncSource;
  const sourceLink =
    media?.providerLinks?.find((link) => canRefreshFromSource(link.connectionId)) ??
    media?.providerLinks?.[0];
  if (sourceLink) {
    return {
      kind: "connection",
      connectionId: sourceLink.connectionId,
      providerId: sourceLink.providerId,
    };
  }
  const legacyAniListId =
    media?.syncSource?.kind === "anilist"
      ? media.syncSource.providerId
      : media
        ? legacyAniListProviderId(media)
        : undefined;
  if (legacyAniListId) {
    const connection = refreshConnectionForTemplate("anilist");
    if (connection) {
      return {
        kind: "connection",
        connectionId: connection.id,
        providerId: legacyAniListId,
      };
    }
  }
  return undefined;
}

/** Whether this item has a provider identity that the connector engine can refresh. */
export function canSyncMedia(media: Media | undefined): boolean {
  if (!media) return false;
  const target = syncTarget(media.id);
  return !!target && canRefreshFromSource(target.connectionId);
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

export async function syncAiringLibrary(
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
  const { syncFilters } = appData.settings;
  const targets = appData.library
    .map((l) => appData.media.find((m) => m.id === l.mediaId))
    .filter((m): m is Media => !!m)
    .filter(
      (m) =>
        (syncFilters.airing && m.status === "RELEASING") ||
        (syncFilters.upcoming && m.status === "NOT_YET_RELEASED") ||
        (syncFilters.hiatus && m.status === "HIATUS"),
    )
    .map((media) => ({ media, target: syncTarget(media.id) }))
    .filter(
      (
        item,
      ): item is typeof item & {
        target: Extract<Media["syncSource"], { kind: "connection" }>;
      } => !!item.target && canRefreshFromSource(item.target.connectionId),
    )
    .map(({ media, target }) => ({ mediaId: media.id, connectionId: target.connectionId }));

  let errors = 0;
  let done = 0;
  let skipped = 0;
  const unavailableConnections = new Set<string>();
  onProgress?.(0, targets.length);

  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) break;
    const target = targets[i];
    if (unavailableConnections.has(target.connectionId)) {
      skipped++;
      done++;
      onProgress?.(done, targets.length);
      continue;
    }

    const result = await syncMedia(target.mediaId);
    if (result.status === "error") {
      errors++;
      if (result.connectionUnavailable) {
        unavailableConnections.add(target.connectionId);
      }
    }
    done++;
    onProgress?.(done, targets.length);
    const hasAnotherRequest = targets
      .slice(i + 1)
      .some((next) => !unavailableConnections.has(next.connectionId));
    if (hasAnotherRequest) {
      try {
        await sleep(BULK_THROTTLE_MS, signal);
      } catch {
        break; // aborted during the throttle gap
      }
    }
  }

  if (errors > 0) {
    const skippedMessage =
      skipped > 0 ? `; ${skipped} skipped because a source was unavailable` : "";
    return {
      status: "error",
      message: `${errors} of ${targets.length} failed${skippedMessage}`,
      updated: done - errors - skipped,
    };
  }
  // Don't announce a cancelled or no-op run.
  if (!signal?.aborted && done > 0) {
    notify("success", "Airing titles synced", `${done} title${done === 1 ? "" : "s"} updated.`);
  }
  return { status: "success", updated: done - skipped };
}
