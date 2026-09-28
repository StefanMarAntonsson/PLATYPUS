import { plainText } from "../utils.js";
import type { Media, Episode } from "$lib/types.js";
import { isConnectorUnavailableError } from "$lib/connectors/engine.js";
import { sleep } from "./http.js";
import { resolveSchedule } from "./schedule.js";
import { findPlatformsElsewhere } from "./platforms.js";
import { startDateMs } from "$lib/schedule-match.js";
import { mergeStreamingLinks, streamingLinksFrom } from "$lib/watch-destination.js";
import { notify } from "$lib/notifications.svelte.js";
import { appData, getMedia, persist, upsertMedia, upsertEpisodes } from "$lib/store.svelte.js";
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
  /** Streaming platforms found that the title did not list before. */
  platformsAdded?: number;
  /** Internal bulk-sync signal: retrying another item on this connection is unsafe. */
  connectionUnavailable?: boolean;
}

export interface SyncItemEvent {
  mediaId: number;
  state: "queued" | "syncing" | "completed" | "skipped";
  result?: SyncResult;
  message?: string;
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

const MEDIA_FORMATS: Media["format"][] = [
  "TV",
  "TV_SHORT",
  "MOVIE",
  "OVA",
  "ONA",
  "SPECIAL",
  "MUSIC",
];

/** A provider's format label as a local format, e.g. Kitsu's "ova" → "OVA". */
function mediaFormat(value: unknown, kind: Media["kind"]): Media["format"] {
  const format = typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "_") : "";
  return (MEDIA_FORMATS as string[]).includes(format)
    ? (format as Media["format"])
    : kind === "movie"
      ? "MOVIE"
      : "TV";
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Tauri's native request can keep running after AbortSignal fires. Stop
 * waiting for it so a cancelled sync finishes promptly. */
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  const reason = () => signal.reason ?? new DOMException("Sync cancelled", "AbortError");
  if (signal.aborted) return Promise.reject(reason());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(reason());
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
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
  options: { signal?: AbortSignal; quiet?: boolean } = {},
): Promise<SyncResult> {
  const label = media.titleEnglish ?? media.titleRomaji;
  try {
    options.signal?.throwIfAborted();
    const update = await abortable(
      options.signal
        ? fetchSourceMediaUpdate(connectionId, providerId, options.signal)
        : fetchSourceMediaUpdate(connectionId, providerId),
      options.signal,
    );
    options.signal?.throwIfAborted();
    const { details } = update;
    let platformsAdded = 0;

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
        format: mediaFormat(details.format, details.kind),
        coverImageLarge: poster ?? media.coverImageLarge,
        coverImageMedium: poster ?? media.coverImageMedium,
        bannerImage: backdrop ?? media.bannerImage,
        seasonYear: Number.isInteger(year) ? year : media.seasonYear,
        genres: details.genres ?? media.genres,
        description: plainText(details.overview) ?? media.description,
        siteUrl: details.canonicalUrl ?? media.siteUrl,
      });
      let found = streamingLinksFrom(details.streamingLinks);
      if (!found.length) {
        try {
          found = await abortable(
            findPlatformsElsewhere(
              media,
              update.source.template.id,
              details.startDate ?? details.releaseDate,
              options.signal,
            ),
            options.signal,
          );
        } catch (error) {
          if (options.signal?.aborted) throw error;
          // Platforms are extra information; the item still syncs without them.
        }
      }
      options.signal?.throwIfAborted();
      const merged = mergeStreamingLinks(media.externalLinks, found);
      media.externalLinks = merged.links;
      platformsAdded = merged.added;
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
    // AniList's airing schedule is a moving window of absolute episode
    // numbers. It may begin at episode 1123 for a long-running show.
    const absoluteEpisodeNumbers = update.source.template.id === "anilist";
    const now = Date.now();
    const sourceBuilt: Episode[] = sourceEpisodes.map((item, index) => {
      const airingAt =
        sourceTimestamp(item.record.airingAt) ?? sourceTimestamp(item.record.airDate);
      return {
        id: -Math.abs(media.id * 100000) - (absoluteEpisodeNumbers ? item.episode : index + 1),
        mediaId: media.id,
        number: absoluteEpisodeNumbers ? item.episode : index + 1,
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

    // Sources like Kitsu list a season without per-episode air times. For an
    // airing season, take the schedule from TVmaze; otherwise the episode
    // count is all there is, and airing shows get a weekly estimate.
    const episodeCount = positiveInteger(details?.episodeCount);
    const startDate = details?.startDate ?? details?.releaseDate;
    const isSeries = (details?.kind ?? media.kind) !== "movie";
    const upcomingOrAiring = media.status === "RELEASING" || media.status === "NOT_YET_RELEASED";
    let schedule: Awaited<ReturnType<typeof resolveSchedule>> = null;
    if (
      isSeries &&
      upcomingOrAiring &&
      update.source.template.id !== "tvmaze" &&
      !sourceBuilt.some((episode) => episode.airingAt !== null)
    ) {
      try {
        schedule = await abortable(
          resolveSchedule(media, startDate, episodeCount, options.signal),
          options.signal,
        );
        options.signal?.throwIfAborted();
        if (schedule) media.scheduleLink = schedule.link;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // The schedule is extra information; the item still syncs without it.
      }
    }
    const scheduled = schedule?.episodes ?? [];
    const estimateFrom = scheduled.length === 0 && upcomingOrAiring ? startDateMs(startDate) : null;
    const total = absoluteEpisodeNumbers
      ? 0
      : isSeries
        ? Math.max(
            sourceBuilt.length,
            scheduled.length,
            sourceBuilt.length ? 0 : (episodeCount ?? 0),
          )
        : sourceBuilt.length;
    const episodes: Episode[] = absoluteEpisodeNumbers
      ? sourceBuilt
      : Array.from({ length: total }, (_, index) => {
          const own = sourceBuilt[index];
          const timed = scheduled[index];
          const airingAt =
            own?.airingAt ??
            timed?.airingAt ??
            (estimateFrom !== null ? estimateFrom + index * WEEK_MS : null);
          return {
            id: own?.id ?? -Math.abs(media.id * 100000) - index - 1,
            mediaId: media.id,
            number: index + 1,
            title: own?.title ?? timed?.title ?? null,
            airingAt,
            aired: airingAt === null || airingAt <= now,
            watched: false,
            watchedAt: null,
            skipped: false,
            isFiller: false,
            isRecap: false,
            thumbnail: own?.thumbnail ?? null,
            seasonNumber: own?.seasonNumber ?? timed?.season ?? null,
            sourceEpisodeNumber: own?.sourceEpisodeNumber ?? timed?.number ?? null,
            providerLinks: [
              ...(own?.providerLinks ?? []),
              ...(timed && schedule && "providerId" in schedule.link
                ? [{ connectionId: schedule.link.connectionId, providerId: timed.providerId }]
                : []),
            ],
          };
        });

    // Native requests cannot be interrupted while in flight. Ignore their
    // eventual response if the user cancelled before it arrived.
    options.signal?.throwIfAborted();
    if (absoluteEpisodeNumbers) {
      const actualNumbers = new Map(sourceEpisodes.map((item) => [item.providerId, item.episode]));
      const repaired = new Set<number>();
      for (const episode of appData.episodes) {
        if (episode.mediaId !== media.id || !episode.providerLinks?.length) continue;
        const stale = episode.providerLinks.find(
          (link) =>
            link.connectionId === connectionId &&
            actualNumbers.has(link.providerId) &&
            actualNumbers.get(link.providerId) !== episode.number,
        );
        if (!stale) continue;
        episode.providerLinks = episode.providerLinks.filter(
          (link) => link.connectionId !== connectionId || link.providerId !== stale.providerId,
        );
        const correct = sourceBuilt.find(
          (item) => item.providerLinks?.[0]?.providerId === stale.providerId,
        );
        if (correct && episode.airingAt === correct.airingAt) episode.airingAt = null;
        if (correct && episode.sourceEpisodeNumber === correct.number)
          episode.sourceEpisodeNumber = null;
        repaired.add(episode.id);
      }
      if (repaired.size) persist({ episodes: repaired });
    }
    if (update.episodes || episodes.length > 0) {
      upsertEpisodes(episodes);
      const storedEpisodes = appData.episodes.filter((episode) => episode.mediaId === media.id);
      media.totalEpisodes = Math.max(
        episodeCount ?? media.totalEpisodes ?? 0,
        storedEpisodes.length,
        ...episodes.map((episode) => episode.number),
      );
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
    return {
      status: "success",
      added: episodes.length,
      ...(platformsAdded ? { platformsAdded } : {}),
    };
  } catch (error) {
    const message = errMsg(error);
    if (!options.quiet && !options.signal?.aborted)
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

export function syncMedia(
  mediaId: number,
  options: { signal?: AbortSignal; quiet?: boolean } = {},
): Promise<SyncResult> {
  const existing = inFlight.get(mediaId);
  if (existing) return existing;
  const target = syncTarget(mediaId);
  const media = getMedia(mediaId);
  const promise = (
    target?.kind === "connection" && media
      ? _syncConfiguredSourceMedia(
          { ...media },
          target.connectionId,
          target.providerId,
          options,
        ).then((result) => {
          // Existing callers may retain the original record reference. Keep
          // it current only after the detached draft was committed.
          if (result.status === "success") {
            const index = appData.media.findIndex((item) => item.id === mediaId);
            if (index >= 0) {
              Object.assign(media, appData.media[index]);
              appData.media[index] = media;
            }
          }
          return result;
        })
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
  onItem?: (event: SyncItemEvent) => void,
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
  let firstFailure: string | null = null;
  const unavailableConnections = new Set<string>();
  onProgress?.(0, targets.length);
  for (const target of targets) onItem?.({ mediaId: target.mediaId, state: "queued" });

  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) break;
    const target = targets[i];
    if (unavailableConnections.has(target.connectionId)) {
      onItem?.({
        mediaId: target.mediaId,
        state: "skipped",
        message: "Source unavailable after an earlier error",
      });
      skipped++;
      done++;
      onProgress?.(done, targets.length);
      continue;
    }

    onItem?.({ mediaId: target.mediaId, state: "syncing" });
    const result = await syncMedia(target.mediaId, { signal, quiet: true });
    if (signal?.aborted) break;
    onItem?.({ mediaId: target.mediaId, state: "completed", result });
    if (result.status === "error") {
      errors++;
      firstFailure ??= `${getMedia(target.mediaId)?.titleEnglish ?? getMedia(target.mediaId)?.titleRomaji ?? "Title"}: ${result.message ?? "Sync failed"}`;
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
    const message = `${errors} of ${targets.length} failed${skippedMessage}`;
    if (!signal?.aborted && !onItem)
      notify(
        "warning",
        "Sync incomplete",
        `${message}${firstFailure ? `. First error: ${firstFailure}` : ""}`,
      );
    return {
      status: "error",
      message,
      updated: done - errors - skipped,
    };
  }
  // Don't announce a cancelled or no-op run.
  if (!signal?.aborted && done > 0 && !onItem) {
    notify("success", "Airing titles synced", `${done} title${done === 1 ? "" : "s"} updated.`);
  }
  return { status: "success", updated: done - skipped };
}
