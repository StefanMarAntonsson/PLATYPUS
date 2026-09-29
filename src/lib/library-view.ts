import type { Episode, LibraryEntry, Media } from "./types.js";

export type CatchUpSort = "backlog" | "oldest" | "newest";

export interface CatchUpDetails {
  count: number;
  oldestAiringAt: number | null;
  newestAiringAt: number | null;
}

/** Summarize aired episodes that still need an explicit watched or skipped state. */
export function catchUpDetails(
  episodes: Array<Pick<Episode, "mediaId" | "airingAt" | "aired" | "watched" | "skipped">>,
): Map<number, CatchUpDetails> {
  const details = new Map<number, CatchUpDetails>();
  for (const episode of episodes) {
    if (episode.aired && !episode.watched && !episode.skipped) {
      const current = details.get(episode.mediaId) ?? {
        count: 0,
        oldestAiringAt: null,
        newestAiringAt: null,
      };
      current.count++;
      if (episode.airingAt !== null) {
        current.oldestAiringAt = Math.min(current.oldestAiringAt ?? Infinity, episode.airingAt);
        current.newestAiringAt = Math.max(current.newestAiringAt ?? -Infinity, episode.airingAt);
      }
      details.set(episode.mediaId, current);
    }
  }
  return details;
}

/** Select active shows with a backlog and apply the requested catch-up priority. */
export function selectCatchUpItems<
  T extends {
    entry: Pick<LibraryEntry, "status">;
    media: { id: number };
  },
>(items: T[], details: ReadonlyMap<number, CatchUpDetails>, sort: CatchUpSort): T[] {
  return items
    .filter(
      ({ entry, media }) =>
        (entry.status === "WATCHING" || entry.status === "REWATCHING") &&
        (details.get(media.id)?.count ?? 0) > 0,
    )
    .sort((a, b) => {
      const aDetails = details.get(a.media.id);
      const bDetails = details.get(b.media.id);
      const backlogDifference = (bDetails?.count ?? 0) - (aDetails?.count ?? 0);
      const aTime = sort === "oldest" ? aDetails?.oldestAiringAt : aDetails?.newestAiringAt;
      const bTime = sort === "oldest" ? bDetails?.oldestAiringAt : bDetails?.newestAiringAt;

      if (sort === "backlog" || aTime === bTime) return backlogDifference;
      if (aTime === null || aTime === undefined) return 1;
      if (bTime === null || bTime === undefined) return -1;
      return sort === "oldest" ? aTime - bTime : bTime - aTime;
    });
}

/** How long a title keeps its "finished" marker after its last episode aired. */
export const RECENTLY_FINISHED_MS = 7 * 24 * 60 * 60 * 1000;
/** Allow for a skipped week before treating a scheduled series as inactive. */
export const RECENTLY_AIRING_MS = 14 * 24 * 60 * 60 * 1000;
/** A gap between episodes longer than this is a season break, not a skipped week. */
export const SEASON_BREAK_GAP_MS = 21 * 24 * 60 * 60 * 1000;
/** A show on a season break counts as airing again this close to its return. */
export const RETURNING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export type AiringState = "airing" | "returning" | "finished" | null;

/**
 * A provider may leave a show marked "running" long after its last episode.
 * When episode dates exist, use them to avoid a stale Airing badge. Keep the
 * provider status as a fallback for sources without episode dates.
 *
 * A seasonal show whose next episode is scheduled after a long gap is
 * "returning" rather than airing, until its return date is close.
 */
export function airingState(
  status: Media["status"],
  lastAiredAt: number | null,
  now: number,
  nextAiringAt: number | null = null,
): AiringState {
  if (status === "RELEASING") {
    if (nextAiringAt !== null && nextAiringAt > now) {
      const onBreak =
        nextAiringAt - now > RETURNING_SOON_MS &&
        nextAiringAt - (lastAiredAt ?? now) > SEASON_BREAK_GAP_MS;
      return onBreak ? "returning" : "airing";
    }
    if (lastAiredAt === null) return "airing";
    return now - lastAiredAt <= RECENTLY_AIRING_MS ? "airing" : null;
  }
  if (status === "FINISHED" && lastAiredAt !== null && now - lastAiredAt < RECENTLY_FINISHED_MS) {
    return "finished";
  }
  return null;
}

/**
 * The Airing filter is a subset of Watching and follows the column label.
 * Shows on a season break are left out until they return.
 */
export function isWatchingAndAiring(
  entry: Pick<LibraryEntry, "status">,
  media: Pick<Media, "status" | "nextAiringAt">,
  lastAiredAt: number | null,
  now: number,
): boolean {
  if (entry.status !== "WATCHING" && entry.status !== "REWATCHING") return false;
  const state = airingState(media.status, lastAiredAt, now, media.nextAiringAt);
  return state === "airing" || state === "finished";
}

/**
 * Sort by a numeric value in either direction. Items without a value (for
 * example a show with no upcoming episode) always come last, and ties fall
 * back to `compareTitle`. Without a value function, items sort by title.
 */
export function sortItems<T>(
  items: T[],
  value: ((item: T) => number | null) | null,
  descending: boolean,
  compareTitle: (a: T, b: T) => number,
): T[] {
  const direction = descending ? -1 : 1;
  if (!value) return [...items].sort((a, b) => direction * compareTitle(a, b));
  return items
    .map((item) => ({ item, value: value(item) }))
    .sort((a, b) => {
      if (a.value === b.value) return compareTitle(a.item, b.item);
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return direction * (a.value - b.value);
    })
    .map(({ item }) => item);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds since local midnight, so shows on the same day order by time. */
export function localTimeOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return (
    date.getHours() * 60 * 60 * 1000 +
    date.getMinutes() * 60 * 1000 +
    date.getSeconds() * 1000 +
    date.getMilliseconds()
  );
}

/**
 * Position of an airing time in a week that starts today: today's shows come
 * first and yesterday's come last, ordered by time within each day.
 * `todayIndex` is a Date.getDay() value (0 = Sunday).
 */
export function weekdayFromToday(timestamp: number, todayIndex: number): number {
  const daysAhead = (new Date(timestamp).getDay() - todayIndex + 7) % 7;
  return daysAhead * DAY_MS + localTimeOfDay(timestamp);
}
