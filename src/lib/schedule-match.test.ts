import { describe, expect, test } from "vite-plus/test";
import {
  baseShowTitle,
  matchScheduleSeason,
  scheduleForMatch,
  startDateMs,
  type ScheduleEpisode,
} from "./schedule-match.js";

const DAY = 24 * 60 * 60 * 1000;

/** Weekly episodes; Japanese midnight broadcasts are 15:00 UTC the day before. */
function season(seasonNumber: number, firstDate: string, count: number): ScheduleEpisode[] {
  const first = (startDateMs(firstDate) as number) - 9 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, index) => ({
    providerId: `${seasonNumber}-${index + 1}`,
    season: seasonNumber,
    number: index + 1,
    title: null,
    airingAt: first + index * 7 * DAY,
  }));
}

const show = [
  ...season(1, "2021-01-10", 11),
  // Part 2 of season 1 continues TVmaze's numbering after a break.
  ...season(1, "2021-10-03", 12).map((episode) => ({
    ...episode,
    providerId: `1b-${episode.number}`,
    number: episode.number + 11,
  })),
  ...season(2, "2023-07-02", 12),
  ...season(3, "2026-07-04", 14),
];

describe("schedule matching", () => {
  test("strips season and part suffixes to find the parent show", () => {
    expect(baseShowTitle("Mushoku Tensei: Jobless Reincarnation Season 3")).toBe(
      "Mushoku Tensei: Jobless Reincarnation",
    );
    expect(baseShowTitle("Mushoku Tensei: Isekai Ittara Honki Dasu 3rd Season")).toBe(
      "Mushoku Tensei: Isekai Ittara Honki Dasu",
    );
    expect(baseShowTitle("ORIENT Part 2")).toBe("ORIENT");
    expect(baseShowTitle("Frieren")).toBe("Frieren");
  });

  test("matches a season by its first air date", () => {
    expect(matchScheduleSeason(startDateMs("2026-07-04") as number, show)).toEqual({
      seasonNumber: 3,
      episodeOffset: 0,
    });
  });

  test("matches a split-cour part that starts partway through a season", () => {
    const match = matchScheduleSeason(startDateMs("2021-10-03") as number, show);
    expect(match).toEqual({ seasonNumber: 1, episodeOffset: 11 });

    const part2 = scheduleForMatch(show, match!, 12);
    expect(part2.map((episode) => episode.localNumber)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(part2[0].number).toBe(12);
  });

  test("caps the first part at its own episode count", () => {
    const match = matchScheduleSeason(startDateMs("2021-01-10") as number, show)!;
    expect(scheduleForMatch(show, match, 11)).toHaveLength(11);
    expect(scheduleForMatch(show, match, null)).toHaveLength(23);
  });

  test("returns nothing when no episode aired near the start date", () => {
    expect(matchScheduleSeason(startDateMs("2024-01-01") as number, show)).toBeNull();
  });
});
