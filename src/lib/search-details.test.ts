import { describe, expect, test } from "vite-plus/test";
import type { NormalizedMedia } from "./connectors/contracts.js";
import { isLikelyAnime, searchResultFacts } from "./search-details.js";

const base: NormalizedMedia = { providerId: "1", kind: "series", title: "Orient" };

describe("search result facts", () => {
  test("summarizes an AniList-style result with season and episode count", () => {
    expect(
      searchResultFacts({
        ...base,
        format: "TV",
        season: "WINTER",
        seasonYear: 2022,
        episodeCount: 12,
        lifecycle: "ended",
      }),
    ).toEqual(["TV", "Winter 2022", "12 eps", "Finished"]);
  });

  test("falls back to a date range, network, and generic kind", () => {
    expect(
      searchResultFacts({
        ...base,
        startDate: "2021-01-10",
        endDate: "2022-03-16",
        network: "Tokyo MX",
      }),
    ).toEqual(["Series", "Jan 2021 – Mar 2022", "Tokyo MX"]);
  });

  test("shows only the release month for films and ignores unusable values", () => {
    expect(
      searchResultFacts({
        ...base,
        kind: "movie",
        format: "MOVIE",
        releaseDate: "2001-07-20T00:00:00+00:00",
        episodeCount: 1,
        seasonYear: null as unknown as number,
        network: "  ",
      }),
    ).toEqual(["Film", "Jul 2001"]);
  });
});

describe("anime detection", () => {
  test("uses the content type when the source provides one", () => {
    expect(isLikelyAnime({ ...base, mediaType: "Animation", originalLanguage: "Japanese" })).toBe(
      true,
    );
    expect(isLikelyAnime({ ...base, mediaType: "Animation", originalLanguage: "English" })).toBe(
      false,
    );
    expect(isLikelyAnime({ ...base, mediaType: "Scripted", genres: ["Anime"] })).toBe(false);
  });

  test("falls back to genres, then language, and keeps unknowns", () => {
    expect(isLikelyAnime({ ...base, genres: ["Anime"], originalLanguage: "English" })).toBe(true);
    expect(isLikelyAnime({ ...base, genres: ["Comedy"], originalLanguage: "Croatian" })).toBe(
      false,
    );
    expect(isLikelyAnime({ ...base, originalLanguage: "Japanese" })).toBe(true);
    expect(isLikelyAnime(base)).toBe(true);
  });
});
