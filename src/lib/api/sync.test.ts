import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const {
  canRefreshFromSource,
  enabledSourceForTemplate,
  fetchEpisodeRecords,
  fetchSourceMediaUpdate,
  refreshConnectionForTemplate,
  searchSource,
} = vi.hoisted(() => ({
  canRefreshFromSource: vi.fn(() => true),
  enabledSourceForTemplate: vi.fn(),
  fetchEpisodeRecords: vi.fn(),
  fetchSourceMediaUpdate: vi.fn(),
  refreshConnectionForTemplate: vi.fn(),
  searchSource: vi.fn(),
}));
vi.mock("$lib/notifications.svelte.js", () => ({ notify: vi.fn() }));
vi.mock("$lib/sources.svelte.js", () => ({
  canRefreshFromSource,
  enabledSourceForTemplate,
  fetchEpisodeRecords,
  fetchSourceMediaUpdate,
  refreshConnectionForTemplate,
  searchSource,
}));

import { appData } from "$lib/store.svelte.js";
import { ConnectorRequestError } from "$lib/connectors/engine.js";
import { notify } from "$lib/notifications.svelte.js";
import { EMPTY_APP_DATA } from "$lib/legacy-data.js";
import type { Media } from "$lib/types.js";
import { canSyncMedia, syncAiringLibrary, syncMedia, type SyncItemEvent } from "./sync.js";

function sourceMedia(id: number, connectionId = "catalog-connection"): Media {
  return {
    id,
    kind: "series",
    titleRomaji: `Airing title ${id}`,
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
    syncSource: { kind: "connection", connectionId, providerId: String(id) },
  };
}

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
  enabledSourceForTemplate.mockReset();
  fetchEpisodeRecords.mockReset();
  searchSource.mockReset();
  vi.mocked(notify).mockClear();
  vi.useRealTimers();
});

describe("bulk synchronization", () => {
  test("ignores a native response that arrives after cancellation", async () => {
    const media = sourceMedia(1);
    const original = structuredClone(media);
    appData.media.push(media);
    const controller = new AbortController();
    let resolveUpdate!: (value: unknown) => void;
    fetchSourceMediaUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const syncing = syncAiringLibrary(controller.signal);
    expect(fetchSourceMediaUpdate).toHaveBeenCalledTimes(1);
    controller.abort();
    const result = await syncing;
    expect(result).toEqual({ status: "success", updated: 0 });
    resolveUpdate({
      source: { template: { id: "catalog" } },
      details: { kind: "series", title: "Changed by late response" },
      episodes: [],
    });
    await Promise.resolve();

    expect(appData.media[0]).toEqual(original);
    expect(appData.episodes).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  test("does not contact a provider for media without a configured source", async () => {
    appData.media.push({ ...sourceMedia(1), syncSource: undefined });

    const result = await syncAiringLibrary();

    expect(fetchSourceMediaUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "success", updated: 0 });
  });

  test("stops contacting a connection after a provider-wide failure", async () => {
    appData.media.push(sourceMedia(1), sourceMedia(2));
    fetchSourceMediaUpdate.mockRejectedValue(
      new ConnectorRequestError("Request failed (503)", true, 503),
    );

    const result = await syncAiringLibrary();

    expect(fetchSourceMediaUpdate).toHaveBeenCalledTimes(1);
    expect(fetchSourceMediaUpdate).toHaveBeenCalledWith("catalog-connection", "1");
    expect(result).toEqual({
      status: "error",
      message: "1 of 2 failed; 1 skipped because a source was unavailable",
      updated: 0,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "warning",
      "Sync incomplete",
      expect.stringContaining("Request failed (503)"),
    );
  });

  test("reports every title to a sync log, including skipped titles", async () => {
    appData.media.push(sourceMedia(1), sourceMedia(2));
    fetchSourceMediaUpdate.mockRejectedValue(
      new ConnectorRequestError("Request failed (429)", true, 429),
    );
    const events: SyncItemEvent[] = [];

    await syncAiringLibrary(undefined, undefined, (event) => events.push(event));

    expect(events.map((event) => [event.mediaId, event.state])).toEqual([
      [1, "queued"],
      [2, "queued"],
      [1, "syncing"],
      [1, "completed"],
      [2, "skipped"],
    ]);
    expect(events[3]).toMatchObject({
      result: { status: "error", message: "Request failed (429)" },
    });
    expect(events[4].message).toContain("Source unavailable");
    expect(notify).not.toHaveBeenCalled();
  });

  test("continues syncing other connections after one becomes unavailable", async () => {
    appData.media.push(sourceMedia(1, "down"), sourceMedia(2, "down"), sourceMedia(3, "healthy"));
    appData.library.push({ ...appData.library[0], id: 3, mediaId: 3 });
    fetchSourceMediaUpdate.mockImplementation(async (connectionId: string) => {
      if (connectionId === "down") {
        throw new ConnectorRequestError("Request failed (503)", true, 503);
      }
      return { source: { template: { id: "catalog" } }, episodes: [] };
    });

    const syncing = syncAiringLibrary();
    await vi.runAllTimersAsync();
    const result = await syncing;

    expect(fetchSourceMediaUpdate).toHaveBeenCalledTimes(2);
    expect(fetchSourceMediaUpdate).toHaveBeenLastCalledWith("healthy", "3");
    expect(result.updated).toBe(1);
  });

  test("does not block a connection after an item-specific failure", async () => {
    appData.media.push(sourceMedia(1), sourceMedia(2));
    fetchSourceMediaUpdate
      .mockRejectedValueOnce(new ConnectorRequestError("Request failed (404)", false, 404))
      .mockResolvedValueOnce({ source: { template: { id: "catalog" } }, episodes: [] });

    const syncing = syncAiringLibrary();
    await vi.runAllTimersAsync();
    const result = await syncing;

    expect(fetchSourceMediaUpdate).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(1);
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
    fetchSourceMediaUpdate.mockResolvedValue({
      source: { template: { id: "catalog" } },
      episodes: [],
    });

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
    fetchSourceMediaUpdate.mockResolvedValue({
      source: { template: { id: "catalog" } },
      episodes: [],
    });

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
    fetchSourceMediaUpdate.mockResolvedValue({
      source: { template: { id: "catalog" } },
      episodes: [],
    });

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
      source: { template: { id: "catalog" } },
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
      source: { template: { id: "catalog" } },
      episodes: [{ providerId: "remote-1", episodeNumber: 1, title: "One", airingAt: 1 }],
    });

    await syncMedia(1);

    expect(appData.media.find((media) => media.id === 1)).toMatchObject({
      totalEpisodes: 2,
      airedEpisodes: 1,
    });
    expect(appData.episodes.filter((episode) => episode.mediaId === 1)).toHaveLength(2);
  });

  test("appends absolute AniList episodes without renumbering its recent airing window", async () => {
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    const media = { ...sourceMedia(1, "anilist-connection"), totalEpisodes: 1173 };
    appData.media.push(media);
    appData.episodes.push(
      {
        id: -100001,
        mediaId: 1,
        number: 1,
        title: "The original first episode",
        airingAt: Date.parse("2026-08-09T00:00:00Z"),
        aired: true,
        watched: true,
        watchedAt: 1,
        skipped: false,
        isFiller: false,
        isRecap: false,
        thumbnail: null,
        sourceEpisodeNumber: 1173,
        providerLinks: [{ connectionId: "anilist-connection", providerId: "173" }],
      },
      {
        id: 1173,
        mediaId: 1,
        number: 1173,
        title: null,
        airingAt: null,
        aired: true,
        watched: true,
        watchedAt: 1,
        skipped: false,
        isFiller: false,
        isRecap: false,
        thumbnail: null,
      },
    );
    fetchSourceMediaUpdate.mockResolvedValue({
      source: { template: { id: "anilist" } },
      episodes: [
        { providerId: 173, episodeNumber: 1173, airingAt: "2026-08-09T00:00:00Z" },
        { providerId: 174, episodeNumber: 1174, airingAt: "2026-08-16T00:00:00Z" },
        { providerId: 180, episodeNumber: 1180, airingAt: "2026-09-27T00:00:00Z" },
        { providerId: 181, episodeNumber: 1181, airingAt: "2026-10-04T00:00:00Z" },
      ],
    });

    await syncMedia(1);

    const episodes = appData.episodes.filter((episode) => episode.mediaId === 1);
    expect(episodes.map((episode) => episode.number)).toEqual([1, 1173, 1174, 1180, 1181]);
    expect(episodes[0].watched).toBe(true);
    expect(episodes[0]).toMatchObject({
      title: "The original first episode",
      airingAt: null,
      sourceEpisodeNumber: null,
      providerLinks: [],
    });
    expect(episodes.map((episode) => episode.aired)).toEqual([true, true, true, true, false]);
    expect(media).toMatchObject({
      totalEpisodes: 1181,
      airedEpisodes: 4,
      nextAiringEpisode: 1181,
    });
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
      source: { template: { id: "catalog" } },
      details: { providerId: "show-1", kind: "series", title: "Updated Romaji" },
    });

    await syncMedia(1);

    expect(media).toMatchObject({
      titleRomaji: "Updated Romaji",
      titleEnglish: "Original English",
      titleNative: "Original Native",
    });

    fetchSourceMediaUpdate.mockResolvedValueOnce({
      source: { template: { id: "catalog" } },
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

describe("seasons from sources without episode lists", () => {
  const kitsu = { template: { id: "kitsu" } };
  const tvmaze = { template: { id: "tvmaze" }, connection: { id: "tvmaze-connection" } };
  const DAY = 24 * 60 * 60 * 1000;

  function seasonMedia(): Media {
    return {
      ...sourceMedia(1, "kitsu-connection"),
      titleEnglish: "Mushoku Tensei: Jobless Reincarnation Season 3",
      totalEpisodes: null,
      airedEpisodes: 0,
      nextAiringEpisode: null,
    };
  }

  function kitsuDetails(lifecycle: string, episodeCount: number) {
    return {
      source: kitsu,
      details: {
        providerId: "49002",
        kind: "series",
        format: "TV",
        title: "Mushoku Tensei: Isekai Ittara Honki Dasu 3rd Season",
        lifecycle,
        startDate: "2026-07-04",
        episodeCount,
      },
    };
  }

  test("creates the episodes of a finished season from its episode count", async () => {
    const media = seasonMedia();
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValueOnce(kitsuDetails("ended", 3));

    await syncMedia(1);

    const episodes = appData.episodes.filter((episode) => episode.mediaId === 1);
    expect(episodes.map((episode) => [episode.number, episode.aired])).toEqual([
      [1, true],
      [2, true],
      [3, true],
    ]);
    expect(media).toMatchObject({ status: "FINISHED", totalEpisodes: 3 });
    expect(enabledSourceForTemplate).not.toHaveBeenCalledWith("tvmaze", expect.anything());
  });

  test("takes an airing season's schedule from the matching TVmaze season", async () => {
    vi.setSystemTime(new Date("2026-07-15T00:00:00Z"));
    const media = seasonMedia();
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValueOnce(kitsuDetails("releasing", 3));
    enabledSourceForTemplate.mockImplementation((id: string) =>
      id === "tvmaze" ? tvmaze : undefined,
    );
    searchSource.mockResolvedValue([
      {
        providerId: "52279",
        kind: "series",
        title: "Mushoku Tensei: Jobless Reincarnation",
        mediaType: "Animation",
        originalLanguage: "Japanese",
        startDate: "2021-01-10",
        canonicalUrl: "https://www.tvmaze.com/shows/52279",
      },
    ]);
    const firstAir = Date.parse("2026-07-03T15:00:00Z");
    fetchEpisodeRecords.mockResolvedValue([
      { providerId: 1, seasonNumber: 2, episodeNumber: 1, airingAt: "2023-07-02T15:00:00Z" },
      ...[0, 1, 2].map((index) => ({
        providerId: 100 + index,
        seasonNumber: 3,
        episodeNumber: index + 1,
        title: `Episode ${index + 1}`,
        airingAt: new Date(firstAir + index * 7 * DAY).toISOString(),
      })),
    ]);

    await syncMedia(1);

    expect(searchSource).toHaveBeenCalledWith(
      tvmaze,
      "Mushoku Tensei: Jobless Reincarnation",
      undefined,
    );
    const episodes = appData.episodes.filter((episode) => episode.mediaId === 1);
    expect(episodes.map((episode) => [episode.number, episode.title, episode.aired])).toEqual([
      [1, "Episode 1", true],
      [2, "Episode 2", true],
      [3, "Episode 3", false],
    ]);
    expect(media).toMatchObject({
      status: "RELEASING",
      nextAiringEpisode: 3,
      nextAiringAt: firstAir + 14 * DAY,
      scheduleLink: {
        connectionId: "tvmaze-connection",
        providerId: "52279",
        seasonNumber: 3,
        episodeOffset: 0,
      },
    });
  });

  test("estimates weekly air dates when no schedule matches, and retries later", async () => {
    vi.setSystemTime(new Date("2026-07-12T00:00:00Z"));
    const media = seasonMedia();
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValue(kitsuDetails("releasing", 3));
    enabledSourceForTemplate.mockImplementation((id: string) =>
      id === "tvmaze" ? tvmaze : undefined,
    );
    searchSource.mockResolvedValue([]);

    await syncMedia(1);

    const episodes = appData.episodes.filter((episode) => episode.mediaId === 1);
    expect(episodes.map((episode) => episode.airingAt)).toEqual([
      Date.UTC(2026, 6, 4),
      Date.UTC(2026, 6, 11),
      Date.UTC(2026, 6, 18),
    ]);
    expect(media.scheduleLink).toEqual({ checkedAt: Date.now() });

    await syncMedia(1);
    expect(searchSource).toHaveBeenCalledTimes(2); // one per title, first sync only
  });
});

describe("streaming platforms", () => {
  const tvmaze = { template: { id: "tvmaze" }, connection: { id: "tvmaze-connection" } };
  const anilist = {
    template: { id: "anilist", operations: {} },
    connection: { id: "anilist-connection" },
  };

  function bookworm(): Media {
    return {
      ...sourceMedia(1, "tvmaze-connection"),
      titleEnglish: "Ascendance of a Bookworm: I'll Do Anything to Become a Librarian!",
      status: "FINISHED",
    };
  }

  function tvmazeDetails(streamingLinks: unknown) {
    return {
      source: tvmaze,
      details: {
        providerId: "43540",
        kind: "series",
        title: "Ascendance of a Bookworm: I'll Do Anything to Become a Librarian!",
        startDate: "2019-10-03",
        streamingLinks,
      },
      episodes: [],
    };
  }

  test("keeps platforms from the title's own source without looking elsewhere", async () => {
    const media = bookworm();
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValueOnce(tvmazeDetails("https://www.netflix.com/title/1"));

    const result = await syncMedia(1);

    expect(result.platformsAdded).toBe(1);
    expect(media.externalLinks).toEqual([
      expect.objectContaining({ site: "Netflix", url: "https://www.netflix.com/title/1" }),
    ]);
    expect(searchSource).not.toHaveBeenCalled();
  });

  test("borrows platforms from AniList when the source lists none", async () => {
    const media = bookworm();
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValueOnce(tvmazeDetails("http://booklove-anime.jp"));
    enabledSourceForTemplate.mockImplementation((id: string) =>
      id === "anilist" ? anilist : undefined,
    );
    searchSource.mockResolvedValue([
      {
        providerId: "999",
        kind: "series",
        title: "Ascendance of a Bookworm Spin-off",
        startDateParts: { year: 2019, month: 10, day: 3 },
        streamingLinks: [{ url: "https://www.hulu.com/wrong", site: "Hulu", type: "STREAMING" }],
      },
      {
        providerId: "108268",
        kind: "series",
        title: "Honzuki no Gekokujou",
        titleEnglish: "Ascendance of a Bookworm",
        startDateParts: { year: 2019, month: 10, day: 3 },
        streamingLinks: [
          {
            url: "https://www.crunchyroll.com/series/1",
            site: "Crunchyroll",
            type: "STREAMING",
            color: "#F88B24",
          },
          { url: "https://x.com/bookworm", site: "Twitter", type: "SOCIAL" },
        ],
      },
    ]);

    const result = await syncMedia(1);

    expect(searchSource).toHaveBeenCalledWith(anilist, media.titleEnglish, undefined);
    expect(result.platformsAdded).toBe(1);
    expect(media.externalLinks).toEqual([
      expect.objectContaining({ site: "Crunchyroll", color: "#F88B24" }),
    ]);
  });

  test("a failed platform lookup does not fail the sync", async () => {
    const media = bookworm();
    appData.media.push(media);
    fetchSourceMediaUpdate.mockResolvedValueOnce(tvmazeDetails(null));
    enabledSourceForTemplate.mockImplementation((id: string) =>
      id === "anilist" ? anilist : undefined,
    );
    searchSource.mockRejectedValue(new Error("Rate limited"));

    await expect(syncMedia(1)).resolves.toMatchObject({ status: "success" });
    expect(media.externalLinks).toEqual([]);
  });
});
