import { describe, expect, test } from "vite-plus/test";
import {
  airingState,
  catchUpDetails,
  isWatchingAndAiring,
  RECENTLY_FINISHED_MS,
  selectCatchUpItems,
  sortItems,
  weekdayFromToday,
} from "./library-view.js";

describe("library view selection", () => {
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

  test("uses episode dates to suppress stale provider airing status", () => {
    const now = 10 * RECENTLY_FINISHED_MS;
    expect(airingState("RELEASING", null, now)).toBe("airing");
    expect(airingState("RELEASING", now - RECENTLY_FINISHED_MS, now)).toBe("airing");
    expect(airingState("RELEASING", Date.UTC(2022, 8, 27), Date.UTC(2026, 8, 22))).toBeNull();
    expect(
      airingState("RELEASING", now - 90 * 24 * 60 * 60 * 1000, now, now + 7 * 24 * 60 * 60 * 1000),
    ).toBe("airing");
    expect(airingState("FINISHED", now - RECENTLY_FINISHED_MS + 1, now)).toBe("finished");
    expect(airingState("FINISHED", now - RECENTLY_FINISHED_MS, now)).toBeNull();
    expect(airingState("FINISHED", null, now)).toBeNull();
    expect(airingState("NOT_YET_RELEASED", now, now)).toBeNull();
  });

  test("filters active titles by the Airing column, including recent finales", () => {
    const now = Date.UTC(2026, 8, 22);
    const releasing = { status: "RELEASING" as const, nextAiringAt: now + 7 * 24 * 60 * 60 * 1000 };
    const finished = { status: "FINISHED" as const, nextAiringAt: null };
    expect(isWatchingAndAiring({ status: "WATCHING" }, releasing, null, now)).toBe(true);
    expect(
      isWatchingAndAiring({ status: "REWATCHING" }, finished, now - 24 * 60 * 60 * 1000, now),
    ).toBe(true);
    expect(isWatchingAndAiring({ status: "WATCHING" }, finished, Date.UTC(2022, 8, 27), now)).toBe(
      false,
    );
    expect(isWatchingAndAiring({ status: "PLAN_TO_WATCH" }, releasing, null, now)).toBe(false);
  });

  test("sorts in both directions, keeps missing values last, and breaks ties by title", () => {
    const items = [
      { title: "b", value: 2 },
      { title: "a", value: null },
      { title: "c", value: 1 },
      { title: "d", value: 2 },
    ];
    const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
    const titles = (sorted: typeof items) => sorted.map((item) => item.title);

    expect(titles(sortItems(items, (item) => item.value, false, byTitle))).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
    expect(titles(sortItems(items, (item) => item.value, true, byTitle))).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
    expect(titles(sortItems(items, null, true, byTitle))).toEqual(["d", "c", "b", "a"]);
  });

  test("orders airing weekdays starting from today and ending with yesterday", () => {
    // Local dates: 2026-09-22 is a Tuesday.
    const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime();
    const tuesday = 2;
    const friday = 5;
    const shows = {
      mondayMorning: at(21, 9),
      tuesdayEvening: at(22, 20),
      tuesdayMorning: at(29, 8),
      thursdayNoon: at(24, 12),
      fridayNight: at(25, 23),
    };
    const order = (todayIndex: number) =>
      Object.entries(shows)
        .sort(([, a], [, b]) => weekdayFromToday(a, todayIndex) - weekdayFromToday(b, todayIndex))
        .map(([name]) => name);

    expect(order(tuesday)).toEqual([
      "tuesdayMorning",
      "tuesdayEvening",
      "thursdayNoon",
      "fridayNight",
      "mondayMorning",
    ]);
    expect(order(friday)).toEqual([
      "fridayNight",
      "mondayMorning",
      "tuesdayMorning",
      "tuesdayEvening",
      "thursdayNoon",
    ]);
  });
});
