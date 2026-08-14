import { describe, expect, test } from "vite-plus/test";
import { filterLibraryItemsForView } from "./library-view.js";

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
});
