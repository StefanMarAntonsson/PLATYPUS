import type { LibraryEntry } from "./types.js";

export type LibraryView = "library" | "watchlist";

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
