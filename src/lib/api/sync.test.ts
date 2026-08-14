import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const { canRefreshFromSource, fetchSourceMediaUpdate, refreshConnectionForTemplate } = vi.hoisted(
  () => ({
    canRefreshFromSource: vi.fn(() => true),
    fetchSourceMediaUpdate: vi.fn(),
    refreshConnectionForTemplate: vi.fn(),
  }),
);
vi.mock("$lib/notifications.svelte.js", () => ({ notify: vi.fn() }));
vi.mock("$lib/sources.svelte.js", () => ({
  canRefreshFromSource,
  fetchSourceMediaUpdate,
  refreshConnectionForTemplate,
}));

import { appData } from "$lib/store.svelte.js";
import { EMPTY_APP_DATA } from "$lib/legacy-data.js";
import type { Media } from "$lib/types.js";
import { canSyncMedia, syncAllLibrary, syncMedia } from "./sync.js";

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
  canRefreshFromSource.mockClear();
  fetchSourceMediaUpdate.mockReset();
  refreshConnectionForTemplate.mockReset();
  vi.useRealTimers();
});

describe("bulk synchronization", () => {
  test("does not contact a provider for media without a configured source", async () => {
    appData.library.push({ ...appData.library[0], id: 3, mediaId: -1 });

    const result = await syncAllLibrary();

    expect(fetchSourceMediaUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "success", updated: 0 });
  });

  test("does not use a legacy embedded AniList target without an explicit connection", async () => {
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

  test("resolves a legacy AniList target through a configured AniList connection", async () => {
    appData.media.push({
      id: 1,
      kind: "series",
      titleRomaji: "Legacy title",
      titleEnglish: null,
      titleNative: null,
      status: "RELEASING",
      format: "TV",
      totalEpisodes: 12,
      airedEpisodes: 10,
      nextAiringEpisode: 11,
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
      syncSource: { kind: "anilist", providerId: "185874" },
    });
    refreshConnectionForTemplate.mockReturnValue({ id: "anilist-connection" });
    fetchSourceMediaUpdate.mockResolvedValue({ source: {}, episodes: [] });

    const result = await syncMedia(1);

    expect(fetchSourceMediaUpdate).toHaveBeenCalledWith("anilist-connection", "185874");
    expect(result.status).toBe("success");
    expect(appData.media[0].syncSource).toEqual({
      kind: "connection",
      connectionId: "anilist-connection",
      providerId: "185874",
    });
  });

  test("recovers a legacy AniList identity from a matching canonical URL", async () => {
    const legacyMedia: Media = {
      id: 185874,
      kind: "series",
      titleRomaji: "Legacy title",
      titleEnglish: null,
      titleNative: null,
      status: "RELEASING",
      format: "TV",
      totalEpisodes: 12,
      airedEpisodes: 10,
      nextAiringEpisode: 11,
      nextAiringAt: null,
      coverImageLarge: null,
      coverImageMedium: null,
      bannerImage: null,
      season: null,
      seasonYear: null,
      genres: [],
      description: null,
      siteUrl: "https://anilist.co/anime/185874/legacy-title/",
      externalLinks: [],
      syncedAt: 0,
      malId: null,
    };
    appData.media.push(legacyMedia);
    refreshConnectionForTemplate.mockReturnValue({ id: "anilist-connection" });
    fetchSourceMediaUpdate.mockResolvedValue({ source: {}, episodes: [] });

    expect(canSyncMedia(legacyMedia)).toBe(true);
    await syncMedia(legacyMedia.id);

    expect(fetchSourceMediaUpdate).toHaveBeenCalledWith("anilist-connection", "185874");
    expect(legacyMedia.syncSource).toEqual({
      kind: "connection",
      connectionId: "anilist-connection",
      providerId: "185874",
    });
  });

  test("does not infer a provider identity from a mismatched legacy URL", async () => {
    const legacyMedia: Media = {
      id: 185874,
      kind: "series",
      titleRomaji: "Legacy title",
      titleEnglish: null,
      titleNative: null,
      status: "RELEASING",
      format: "TV",
      totalEpisodes: 12,
      airedEpisodes: 10,
      nextAiringEpisode: 11,
      nextAiringAt: null,
      coverImageLarge: null,
      coverImageMedium: null,
      bannerImage: null,
      season: null,
      seasonYear: null,
      genres: [],
      description: null,
      siteUrl: "https://anilist.co/anime/999999",
      externalLinks: [],
      syncedAt: 0,
      malId: null,
    };
    appData.media.push(legacyMedia);
    refreshConnectionForTemplate.mockReturnValue({ id: "anilist-connection" });

    expect(canSyncMedia(legacyMedia)).toBe(false);
    expect(await syncMedia(legacyMedia.id)).toEqual({
      status: "error",
      message: "No configured sync source is attached",
    });
    expect(fetchSourceMediaUpdate).not.toHaveBeenCalled();
  });

  test("falls back from a retired AniList target to an attached connection", async () => {
    const media: Media = {
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
      syncSource: { kind: "anilist" as const, providerId: "1" },
      providerLinks: [
        { connectionId: "catalog-connection", connectionName: "Catalog", providerId: "remote-1" },
      ],
    };
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValue({ source: {}, episodes: [] });

    expect(canSyncMedia(media)).toBe(true);
    await syncMedia(1);

    expect(fetchSourceMediaUpdate).toHaveBeenCalledWith("catalog-connection", "remote-1");
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

  test("does not shrink a legacy episode total when a refresh is incomplete", async () => {
    appData.media.push({
      id: 1,
      kind: "series",
      titleRomaji: "Airing title",
      titleEnglish: null,
      titleNative: null,
      status: "RELEASING",
      format: "TV",
      totalEpisodes: 2,
      airedEpisodes: 1,
      nextAiringEpisode: 2,
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
      syncSource: {
        kind: "connection",
        connectionId: "catalog-connection",
        providerId: "show-1",
      },
    });
    appData.episodes.push(
      {
        id: 101,
        mediaId: 1,
        number: 1,
        title: "One",
        airingAt: 1,
        aired: true,
        watched: true,
        watchedAt: 1,
        skipped: false,
        isFiller: false,
        isRecap: false,
        thumbnail: null,
      },
      {
        id: 102,
        mediaId: 1,
        number: 2,
        title: "Two",
        airingAt: 2_000_000_000_000,
        aired: false,
        watched: false,
        watchedAt: null,
        skipped: false,
        isFiller: false,
        isRecap: false,
        thumbnail: null,
      },
    );
    fetchSourceMediaUpdate.mockResolvedValue({
      source: {},
      episodes: [{ providerId: "remote-1", episodeNumber: 1, title: "One", airingAt: 1 }],
    });

    await syncMedia(1);

    expect(appData.media.find((media) => media.id === 1)).toMatchObject({
      totalEpisodes: 2,
      airedEpisodes: 1,
    });
    expect(appData.episodes.filter((episode) => episode.mediaId === 1)).toHaveLength(2);
  });

  test("preserves English titles unless the source supplies an explicit English title", async () => {
    const media: Media = {
      id: 1,
      kind: "series",
      titleRomaji: "Original Romaji",
      titleEnglish: "Original English",
      titleNative: "Original Native",
      status: "RELEASING",
      format: "TV",
      totalEpisodes: 1,
      airedEpisodes: 1,
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
      syncSource: {
        kind: "connection",
        connectionId: "catalog-connection",
        providerId: "show-1",
      },
    };
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValueOnce({
      source: {},
      details: { providerId: "show-1", kind: "series", title: "Updated Romaji" },
    });

    await syncMedia(1);

    expect(media).toMatchObject({
      titleRomaji: "Updated Romaji",
      titleEnglish: "Original English",
      titleNative: "Original Native",
    });

    fetchSourceMediaUpdate.mockResolvedValueOnce({
      source: {},
      details: {
        providerId: "show-1",
        kind: "series",
        title: "Updated Romaji",
        titleRomaji: "Updated Romaji",
        titleEnglish: "Updated English",
        titleNative: "Updated Native",
      },
    });

    await syncMedia(1);

    expect(media).toMatchObject({
      titleRomaji: "Updated Romaji",
      titleEnglish: "Updated English",
      titleNative: "Updated Native",
    });
  });
});
