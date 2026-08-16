import type { Episode, LibraryEntry } from "./types.js";

export type LibraryView = "library" | "watchlist";
export type CatchUpSort = "backlog" | "oldest" | "newest";

export interface CatchUpDetails {
  count: number;
  oldestAiringAt: number | null;
  newestAiringAt: number | null;
}

/**
 * Select items for the completed Library or the active Watchlist.
 *
 * Provider lifecycle metadata is deliberately not considered here. A title
 * can still be releasing after the user has completed every available
 * episode, and it must remain visible in the completed Library.
 */
export function filterLibraryItemsForView<T extends { entry: Pick<LibraryEntry, "status"> }>(
  items: T[],
  view: LibraryView,
): T[] {
  return items.filter(({ entry }) =>
    view === "watchlist" ? entry.status !== "COMPLETED" : entry.status === "COMPLETED",
  );
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
