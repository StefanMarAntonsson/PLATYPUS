import { describe, expect, test } from "vite-plus/test";
import {
  groupSearchResults,
  interleaveSearchResults,
  normalizeSearchTitle,
} from "./search-grouping.js";

function result(
  key: string,
  sourceKey: string,
  title: string,
  kind: "movie" | "series" = "series",
  year: number | null = 2018,
) {
  return {
    key,
    sourceKey,
    sourceName: sourceKey,
    providerId: key,
    kind,
    title,
    alternateTitles: [],
    year,
  };
}

describe("search result grouping", () => {
  test("interleaves any number of sources without changing relevance within a source", () => {
    expect(
      interleaveSearchResults([
        ["a1", "a2", "a3"],
        ["b1", "b2"],
        ["c1", "c2", "c3", "c4"],
      ]),
    ).toEqual(["a1", "b1", "c1", "a2", "b2", "c2", "a3", "c3", "c4"]);
  });

  test("stacks the same work from any number of different sources", () => {
    const groups = groupSearchResults([
      result("anilist:1", "anilist", "Violet Evergarden"),
      result("tvmaze:2", "tvmaze", "Violet Evergarden"),
      result("third:3", "third", "Violet Evergarden"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].results.map((item) => item.sourceKey)).toEqual(["anilist", "tvmaze", "third"]);
  });

  test("keeps same-source results, movies, and distant release years separate", () => {
    const groups = groupSearchResults([
      result("anilist:series", "anilist", "Example"),
      result("anilist:special", "anilist", "Example"),
      result("tvmaze:movie", "tvmaze", "Example", "movie"),
      result("third:remake", "third", "Example", "series", 2025),
    ]);

    expect(groups).toHaveLength(4);
  });

  test("matches alternate titles and normalizes punctuation and accents", () => {
    const groups = groupSearchResults([
      {
        ...result("anilist:1", "anilist", "Kimi no Na wa"),
        alternateTitles: ["Your Name."],
      },
      result("source:2", "source", "Your Name"),
    ]);

    expect(groups).toHaveLength(1);
    expect(normalizeSearchTitle("Pokémon: Origins")).toBe("pokemon origins");
  });
});
