import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const { fetchSourceMediaUpdate } = vi.hoisted(() => ({
  fetchSourceMediaUpdate: vi.fn(),
}));
vi.mock("$lib/notifications.svelte.js", () => ({ notify: vi.fn() }));
vi.mock("$lib/sources.svelte.js", () => ({ fetchSourceMediaUpdate }));

import { appData } from "$lib/store.svelte.js";
import { EMPTY_APP_DATA } from "$lib/legacy-data.js";
import { syncAllLibrary, syncMedia } from "./sync.js";

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(appData, structuredClone(EMPTY_APP_DATA));
  appData.library.push(
    {
      id: 1,
      mediaId: 1,
      status: "WATCHING",
      score: null,
      notes: null,
      startedAt: null,
      completedAt: null,
      addedAt: 1,
      updatedAt: 1,
    },
    {
      id: 2,
      mediaId: 2,
      status: "WATCHING",
      score: null,
      notes: null,
      startedAt: null,
      completedAt: null,
      addedAt: 1,
      updatedAt: 1,
    },
  );
});

afterEach(() => {
  fetchSourceMediaUpdate.mockReset();
  vi.useRealTimers();
});

describe("bulk synchronization", () => {
  test("does not contact a provider for media without a configured source", async () => {
    appData.library.push({ ...appData.library[0], id: 3, mediaId: -1 });

    const result = await syncAllLibrary();

    expect(fetchSourceMediaUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "success", updated: 0 });
  });

  test("does not use a legacy embedded AniList sync target", async () => {
    appData.media.push({
      id: 1,
      kind: "series",
      titleRomaji: "Legacy title",
      titleEnglish: null,
      titleNative: null,
      status: "FINISHED",
      format: "TV",
      totalEpisodes: 12,
      airedEpisodes: 12,
      nextAiringEpisode: null,
      nextAiringAt: null,
      coverImageLarge: null,
      coverImageMedium: null,
      bannerImage: null,
      season: null,
      seasonYear: null,
      genres: [],
      description: null,
      siteUrl: "",
      externalLinks: [],
      syncedAt: 0,
      malId: null,
      syncSource: { kind: "anilist", providerId: "1" },
    });

    const result = await syncMedia(1);

    expect(fetchSourceMediaUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "error", message: "No configured sync source is attached" });
  });

  test("syncs source-backed media with its connection and imports episodes", async () => {
    appData.media.push({
      id: -1,
      kind: "series",
      titleRomaji: "Castlevania",
      titleEnglish: "Castlevania",
      titleNative: null,
      status: "FINISHED",
      format: "TV",
      totalEpisodes: null,
      airedEpisodes: 0,
      nextAiringEpisode: null,
      nextAiringAt: null,
      coverImageLarge: null,
      coverImageMedium: null,
      bannerImage: null,
      season: null,
      seasonYear: 2017,
      genres: [],
      description: null,
      siteUrl: "",
      externalLinks: [],
      syncedAt: 0,
      malId: null,
      syncSource: { kind: "connection", connectionId: "catalog-connection", providerId: "12036" },
      providerLinks: [
        { connectionId: "catalog-connection", connectionName: "Catalog", providerId: "12036" },
      ],
    });
    appData.library.push({ ...appData.library[0], id: 3, mediaId: -1 });
    fetchSourceMediaUpdate.mockResolvedValue({
      source: {},
      details: {
        providerId: "12036",
        kind: "series",
        title: "Castlevania",
        lifecycle: "ended",
      },
      episodes: [
        {
          providerId: 1,
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Witchbottle",
          airingAt: "2017-07-07T12:00:00Z",
        },
        {
          providerId: 2,
          seasonNumber: 1,
          episodeNumber: 2,
          title: "Necropolis",
          airingAt: 1_899_820_800,
        },
      ],
    });

    const result = await syncMedia(-1);

    expect(fetchSourceMediaUpdate).toHaveBeenCalledWith("catalog-connection", "12036");
    expect(result).toEqual({ status: "success", added: 2 });
    expect(appData.episodes.filter((episode) => episode.mediaId === -1)).toHaveLength(2);
    expect(appData.media.find((media) => media.id === -1)).toMatchObject({
      nextAiringEpisode: 2,
      nextAiringAt: 1_899_820_800_000,
    });
    expect(appData.media.find((media) => media.id === -1)).toMatchObject({
      totalEpisodes: 2,
      airedEpisodes: 1,
    });
  });
});
