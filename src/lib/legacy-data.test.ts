import { describe, expect, test } from "vite-plus/test";
import fixture from "./fixtures/v2-library.json";
import { DEFAULT_SETTINGS, parseV2Data } from "./legacy-data.js";

describe("v2 data parsing", () => {
  test("preserves representative library, history, organization, and settings data", () => {
    const data = parseV2Data(JSON.stringify(fixture));

    expect(data.media).toHaveLength(1);
    expect(
      data.episodes.map(({ watched, watchedAt, skipped }) => ({ watched, watchedAt, skipped })),
    ).toEqual([
      { watched: true, watchedAt: 1786100000000, skipped: false },
      { watched: false, watchedAt: null, skipped: true },
    ]);
    expect(data.library[0]).toMatchObject({ status: "COMPLETED", score: 9, notes: "keep me" });
    expect(data.collections[0].name).toBe("Favorites");
    expect(data.series[0].name).toBe("Franchise");
    expect(data.settings).toMatchObject({
      ...DEFAULT_SETTINGS,
      titleLanguage: "romaji",
    });
    expect(data.settings).not.toHaveProperty("accentColor");
  });

  test("fills optional v2 additions while retaining early series records", () => {
    const early = {
      version: 2,
      media: [],
      episodes: [],
      library: [],
      series: [{ id: 4, name: "Old collection" }],
      seriesEntries: [{ seriesId: 4, mediaId: 9, order: 2 }],
    };
    const data = parseV2Data(JSON.stringify(early));
    expect(data.collections).toEqual(early.series);
    expect(data.collectionEntries).toEqual([{ collectionId: 4, mediaId: 9, order: 2 }]);
    expect(data.series).toEqual(early.series);
  });

  test.each([
    ["invalid JSON", "{"],
    ["wrong version", JSON.stringify({ ...fixture, version: 1 })],
    ["missing required arrays", JSON.stringify({ version: 2, media: [], episodes: [] })],
    ["invalid settings", JSON.stringify({ ...fixture, settings: [] })],
  ])("rejects %s", (_label, input) => {
    expect(() => parseV2Data(input)).toThrow();
  });

  test("does not mutate a caller's source object", () => {
    const source = structuredClone(fixture);
    const before = structuredClone(source);
    parseV2Data(JSON.stringify(source));
    expect(source).toEqual(before);
  });
});
