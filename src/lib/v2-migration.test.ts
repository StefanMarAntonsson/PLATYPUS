import { describe, expect, test } from "vite-plus/test";
import fixture from "./fixtures/v2-library.json";
import { previewV2Migration } from "./v2-migration.js";

describe("v2 migration preview", () => {
  test("reports preserved data and creates history for watched legacy episodes", () => {
    const preview = previewV2Migration(JSON.stringify(fixture));
    expect(preview.report).toMatchObject({
      media: 1,
      episodes: 2,
      collections: 1,
      series: 1,
      watchEventsCreated: 1,
      skippedEpisodes: 1,
      providerLinksPreserved: 2,
    });
    expect(preview.data.watchEvents).toContainEqual(
      expect.objectContaining({ mediaId: 101, episodeId: 10100001, origin: "legacy" }),
    );
  });

  test("rejects dangling references before anything can be imported", () => {
    const invalid = structuredClone(fixture);
    invalid.library[0].mediaId = 999;
    expect(() => previewV2Migration(JSON.stringify(invalid))).toThrow("missing media 999");
  });

  test("rejects malformed records before persistence", () => {
    const malformedEpisode = structuredClone(fixture);
    malformedEpisode.episodes[0] = null as never;
    expect(() => previewV2Migration(JSON.stringify(malformedEpisode))).toThrow(
      "episodes contains an invalid record",
    );

    const malformedReference = structuredClone(fixture);
    malformedReference.library[0].mediaId = "101" as never;
    expect(() => previewV2Migration(JSON.stringify(malformedReference))).toThrow(
      "library entry 1 has an invalid mediaId",
    );
  });

  test("rejects dangling groups and watch events with mismatched episodes", () => {
    const danglingCollection = structuredClone(fixture);
    danglingCollection.collectionEntries[0].collectionId = 999;
    expect(() => previewV2Migration(JSON.stringify(danglingCollection))).toThrow(
      "missing collection 999",
    );

    const mismatchedEvent = {
      ...structuredClone(fixture),
      media: [...fixture.media, { ...fixture.media[0], id: 102 }],
      watchEvents: [
        {
          id: 1,
          mediaId: 102,
          episodeId: 10100001,
          watchedAt: 1,
          progress: 1,
          origin: "legacy",
        },
      ],
    };
    expect(() => previewV2Migration(JSON.stringify(mismatchedEvent))).toThrow(
      "belongs to a different media item",
    );
  });

  test("reports names that cannot be safely merged between legacy groups", () => {
    const conflict = structuredClone(fixture);
    conflict.series[0].name = conflict.collections[0].name;

    expect(previewV2Migration(JSON.stringify(conflict)).report.conflicts).toEqual([
      '"Favorites" exists as both a collection and a legacy series group.',
    ]);
  });
});
