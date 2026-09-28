import type { Media } from "$lib/types.js";
import { isLikelyAnime } from "$lib/search-details.js";
import {
  baseShowTitle,
  matchScheduleSeason,
  scheduleForMatch,
  startDateMs,
  type ScheduleEpisode,
} from "$lib/schedule-match.js";
import {
  enabledSourceForTemplate,
  fetchEpisodeRecords,
  searchSource,
  type ConfiguredSource,
} from "$lib/sources.svelte.js";

/** A failed lookup is retried after this long, e.g. once TVmaze lists a new season. */
const RETRY_UNMATCHED_MS = 3 * 24 * 60 * 60 * 1000;
/** TVmaze shows to try per lookup; each costs one request for its episode list. */
const MAX_CANDIDATES = 3;
const START_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000;

export interface ResolvedSchedule {
  link: NonNullable<Media["scheduleLink"]>;
  /** The item's own episodes, numbered from 1; empty when nothing matched. */
  episodes: Array<ScheduleEpisode & { localNumber: number }>;
}

function toScheduleEpisodes(records: Record<string, unknown>[]): ScheduleEpisode[] {
  return records.flatMap((record) => {
    const season = Number(record.seasonNumber);
    const number = Number(record.episodeNumber);
    const providerId =
      typeof record.providerId === "number" || typeof record.providerId === "string"
        ? String(record.providerId)
        : null;
    if (!providerId || !Number.isFinite(season) || !Number.isFinite(number)) return [];
    const airingAt =
      typeof record.airingAt === "string" ? new Date(record.airingAt).getTime() : Number.NaN;
    return [
      {
        providerId,
        season,
        number,
        title: typeof record.title === "string" && record.title.trim() ? record.title : null,
        airingAt: Number.isFinite(airingAt) ? airingAt : null,
      },
    ];
  });
}

async function candidateShows(
  source: ConfiguredSource,
  media: Media,
  startDate: number,
  signal?: AbortSignal,
): Promise<Array<{ providerId: string; canonicalUrl?: string }>> {
  const queries = [
    ...new Set(
      [media.titleEnglish, media.titleRomaji]
        .filter((title): title is string => !!title?.trim())
        .map(baseShowTitle)
        .filter(Boolean),
    ),
  ];
  const candidates: Array<{ providerId: string; canonicalUrl?: string }> = [];
  for (const query of queries) {
    const results = await searchSource(source, query, signal);
    for (const result of results) {
      const premiered = startDateMs(result.startDate);
      if (!isLikelyAnime(result)) continue;
      // A show that premiered after this season started cannot contain it.
      if (premiered !== null && premiered > startDate + START_TOLERANCE_MS) continue;
      if (candidates.some((candidate) => candidate.providerId === result.providerId)) continue;
      candidates.push({ providerId: result.providerId, canonicalUrl: result.canonicalUrl });
      if (candidates.length >= MAX_CANDIDATES) return candidates;
    }
  }
  return candidates;
}

/**
 * Find (or refresh) the TVmaze schedule for an airing item whose own source
 * has no air times. Returns null when TVmaze isn't available or a recent
 * lookup already failed, so the caller keeps its current data.
 */
export async function resolveSchedule(
  media: Media,
  startDate: string | undefined,
  episodeCount: number | null,
  signal?: AbortSignal,
): Promise<ResolvedSchedule | null> {
  const source = enabledSourceForTemplate("tvmaze", ["search", "episodes"]);
  if (!source) return null;
  const now = Date.now();
  const existing = media.scheduleLink;

  if (existing && "providerId" in existing && existing.connectionId === source.connection.id) {
    const episodes = toScheduleEpisodes(
      await fetchEpisodeRecords(source, existing.providerId, signal),
    );
    return {
      link: { ...existing, checkedAt: now },
      episodes: scheduleForMatch(episodes, existing, episodeCount),
    };
  }
  if (existing && !("providerId" in existing) && now - existing.checkedAt < RETRY_UNMATCHED_MS) {
    return null;
  }

  const start = startDateMs(startDate);
  if (start === null) return { link: { checkedAt: now }, episodes: [] };

  for (const candidate of await candidateShows(source, media, start, signal)) {
    const episodes = toScheduleEpisodes(
      await fetchEpisodeRecords(source, candidate.providerId, signal),
    );
    const match = matchScheduleSeason(start, episodes);
    if (!match) continue;
    return {
      link: {
        connectionId: source.connection.id,
        providerId: candidate.providerId,
        ...match,
        ...(candidate.canonicalUrl ? { canonicalUrl: candidate.canonicalUrl } : {}),
        checkedAt: now,
      },
      episodes: scheduleForMatch(episodes, match, episodeCount),
    };
  }
  return { link: { checkedAt: now }, episodes: [] };
}
