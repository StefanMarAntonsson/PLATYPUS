import { describe, expect, test } from "vite-plus/test";
import { catchUpDetails, filterLibraryItemsForView, selectCatchUpItems } from "./library-view.js";

describe("library view selection", () => {
  test("keeps a completed title visible while its provider says it is releasing", () => {
    const completedReleasing = {
      entry: { status: "COMPLETED" as const },
      media: { status: "RELEASING" as const },
    };

    expect(filterLibraryItemsForView([completedReleasing], "library")).toEqual([
      completedReleasing,
    ]);
    expect(filterLibraryItemsForView([completedReleasing], "watchlist")).toEqual([]);
  });

  test("summarizes only aired episodes that are neither watched nor skipped", () => {
    expect(
      catchUpDetails([
        { mediaId: 1, airingAt: 300, aired: true, watched: false, skipped: false },
        { mediaId: 1, airingAt: 100, aired: true, watched: false, skipped: false },
        { mediaId: 1, airingAt: 200, aired: true, watched: true, skipped: false },
        { mediaId: 1, airingAt: 50, aired: true, watched: false, skipped: true },
        { mediaId: 1, airingAt: 400, aired: false, watched: false, skipped: false },
        { mediaId: 2, airingAt: null, aired: true, watched: false, skipped: false },
      ]),
    ).toEqual(
      new Map([
        [1, { count: 2, oldestAiringAt: 100, newestAiringAt: 300 }],
        [2, { count: 1, oldestAiringAt: null, newestAiringAt: null }],
      ]),
    );
  });

  test("selects only watching and rewatching shows and supports catch-up priorities", () => {
    const items = [
      { entry: { status: "WATCHING" as const }, media: { id: 1 } },
      { entry: { status: "REWATCHING" as const }, media: { id: 2 } },
      { entry: { status: "WATCHING" as const }, media: { id: 3 } },
      { entry: { status: "PLAN_TO_WATCH" as const }, media: { id: 4 } },
      { entry: { status: "PAUSED" as const }, media: { id: 5 } },
      { entry: { status: "WATCHING" as const }, media: { id: 6 } },
    ];
    const details = new Map([
      [1, { count: 2, oldestAiringAt: 100, newestAiringAt: 300 }],
      [2, { count: 3, oldestAiringAt: 200, newestAiringAt: 250 }],
      [3, { count: 1, oldestAiringAt: 150, newestAiringAt: 400 }],
      [4, { count: 8, oldestAiringAt: 50, newestAiringAt: 500 }],
      [5, { count: 7, oldestAiringAt: 25, newestAiringAt: 600 }],
      [6, { count: 4, oldestAiringAt: null, newestAiringAt: null }],
    ]);

    expect(selectCatchUpItems(items, details, "backlog")).toEqual([
      items[5],
      items[1],
      items[0],
      items[2],
    ]);
    expect(selectCatchUpItems(items, details, "oldest")).toEqual([
      items[0],
      items[2],
      items[1],
      items[5],
    ]);
    expect(selectCatchUpItems(items, details, "newest")).toEqual([
      items[2],
      items[0],
      items[1],
      items[5],
    ]);
  });
});
