import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import fixture from "./fixtures/v2-library.json";
import { parseV2Data } from "./legacy-data.js";
import {
  appData,
  attachSourceToMedia,
  autoUpdateLibraryStatus,
  cycleEpisodeState,
  createManualMedia,
  createManualEpisode,
  createMediaFromSource,
  markAllWatched,
  skipAllEpisodes,
  clearAllWatched,
  setMovieWatched,
  setEpisodeState,
  toggleEpisodeWatched,
  upsertEpisodes,
} from "./store.svelte.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-08T15:00:00Z"));
  Object.assign(appData, parseV2Data(JSON.stringify(fixture)));
});

describe("episode state transitions", () => {
  test("cycles unwatched to watched to skipped to unwatched", () => {
    const episode = appData.episodes[1];
    const currentEpisode = () => appData.episodes.find((item) => item.id === episode.id);
    setEpisodeState(episode.id, "unwatched");
    cycleEpisodeState(episode.id);
    expect(currentEpisode()).toMatchObject({
      watched: true,
      skipped: false,
      watchedAt: Date.now(),
    });
    cycleEpisodeState(episode.id);
    expect(currentEpisode()).toMatchObject({ watched: false, skipped: true, watchedAt: null });
    cycleEpisodeState(episode.id);
    expect(currentEpisode()).toMatchObject({ watched: false, skipped: false, watchedAt: null });
  });

  test("allows an unaired episode to be flagged before a sync refresh", () => {
    const episode = appData.episodes[1];
    episode.aired = false;
    setEpisodeState(episode.id, "unwatched");

    cycleEpisodeState(episode.id);

    expect(appData.episodes.find((item) => item.id === episode.id)).toMatchObject({
      watched: true,
      skipped: false,
      watchedAt: Date.now(),
    });
    expect(appData.watchEvents).toContainEqual(
      expect.objectContaining({ mediaId: episode.mediaId, episodeId: episode.id }),
    );
  });

  test("toggles watched state from the current store record after an episode is replaced", () => {
    const staleEpisode = appData.episodes[0];

    setEpisodeState(staleEpisode.id, "unwatched");
    expect(staleEpisode.watched).toBe(true);

    toggleEpisodeWatched(staleEpisode.id);
    expect(appData.episodes.find((episode) => episode.id === staleEpisode.id)?.watched).toBe(true);
    expect(appData.library[0].status).toBe("COMPLETED");

    toggleEpisodeWatched(staleEpisode.id);
    expect(appData.episodes.find((episode) => episode.id === staleEpisode.id)?.watched).toBe(false);
    expect(appData.library[0].status).toBe("WATCHING");
  });

  test("bulk actions include unaired episodes", () => {
    appData.episodes[1].aired = false;
    markAllWatched(101);
    expect(appData.episodes.every((episode) => episode.watched)).toBe(true);

    skipAllEpisodes(101);
    expect(appData.episodes.every((episode) => episode.skipped)).toBe(true);
  });

  test("preserves local watch state when refreshed episode metadata is upserted", () => {
    const watched = appData.episodes[0];
    upsertEpisodes([{ ...watched, title: "Updated remotely", watched: false, watchedAt: null }]);
    expect(appData.episodes[0]).toMatchObject({
      title: "Updated remotely",
      watched: true,
      watchedAt: 1786100000000,
    });
  });

  test("adopts provider identity without duplicating a legacy episode", () => {
    const legacy = appData.episodes[0];
    const incoming: typeof legacy = {
      ...legacy,
      id: -1,
      title: null,
      watched: false,
      watchedAt: null,
      providerLinks: [{ connectionId: "anilist", providerId: "remote-episode-1" }],
    };

    upsertEpisodes([incoming]);

    const episodes = appData.episodes.filter(
      (episode) => episode.mediaId === legacy.mediaId && episode.number === legacy.number,
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      id: legacy.id,
      title: legacy.title,
      watched: true,
      watchedAt: legacy.watchedAt,
      providerLinks: [{ connectionId: "anilist", providerId: "remote-episode-1" }],
    });
  });

  test("repairs existing duplicate episodes and keeps watch events attached", () => {
    const legacy = appData.episodes[0];
    const duplicate = {
      ...legacy,
      id: -1,
      title: null,
      watched: false,
      watchedAt: null,
      providerLinks: [{ connectionId: "anilist", providerId: "remote-episode-1" }],
    };
    appData.episodes.push(duplicate);
    appData.watchEvents.push({
      id: 999,
      mediaId: legacy.mediaId,
      episodeId: duplicate.id,
      watchedAt: Date.now(),
      progress: 1,
      origin: "source",
    });

    upsertEpisodes([{ ...duplicate }]);

    expect(
      appData.episodes.filter(
        (episode) => episode.mediaId === legacy.mediaId && episode.number === legacy.number,
      ),
    ).toHaveLength(1);
    expect(appData.watchEvents.find((event) => event.id === 999)?.episodeId).toBe(legacy.id);
  });
});

describe("automatic library status", () => {
  test("completes a finished title only after all aired episodes are done", () => {
    const previousEpisode = appData.episodes[1];
    const previousEntry = appData.library[0];
    setEpisodeState(previousEpisode.id, "unwatched");
    expect(appData.library[0].status).toBe("WATCHING");
    expect(appData.episodes[1]).not.toBe(previousEpisode);
    expect(appData.library[0]).not.toBe(previousEntry);
    markAllWatched(101);
    expect(appData.library[0].status).toBe("COMPLETED");
    expect(appData.watchEvents.filter((event) => event.mediaId === 101)).toHaveLength(2);
  });

  test("keeps bulk episode actions and watch history consistent", () => {
    markAllWatched(101);
    expect(appData.watchEvents.filter((event) => event.mediaId === 101)).toHaveLength(2);
    skipAllEpisodes(101);
    expect(appData.watchEvents.some((event) => event.mediaId === 101)).toBe(false);
    markAllWatched(101);
    clearAllWatched(101);
    expect(appData.watchEvents.some((event) => event.mediaId === 101)).toBe(false);
  });

  test("keeps a releasing title watching when the user is merely caught up", () => {
    appData.media[0].status = "RELEASING";
    appData.media[0].totalEpisodes = 3;
    autoUpdateLibraryStatus(101);
    expect(appData.library[0].status).toBe("WATCHING");
  });
});

describe("manual media and watch history", () => {
  test("creates a provider-independent movie and records its watch event", () => {
    const coverImage = "data:image/png;base64,cGxhdHlwdXM=";
    const movie = createManualMedia({
      title: "Perfect Days",
      kind: "movie",
      year: 2023,
      coverImage,
    });
    expect(movie).toMatchObject({
      kind: "movie",
      format: "MOVIE",
      titleEnglish: "Perfect Days",
      coverImageLarge: coverImage,
      coverImageMedium: coverImage,
    });
    expect(appData.library.some((entry) => entry.mediaId === movie.id)).toBe(true);

    setMovieWatched(movie.id, true);
    expect(appData.watchEvents).toContainEqual(
      expect.objectContaining({ mediaId: movie.id, episodeId: null, progress: 1 }),
    );
    expect(appData.library.find((entry) => entry.mediaId === movie.id)?.status).toBe("COMPLETED");

    setMovieWatched(movie.id, false);
    expect(appData.watchEvents.some((event) => event.mediaId === movie.id)).toBe(false);
  });

  test("marks legacy movie records watched from their format", () => {
    const movie = appData.media[0];
    movie.kind = undefined;
    movie.format = "MOVIE";

    setMovieWatched(movie.id, true);

    expect(appData.watchEvents).toContainEqual(
      expect.objectContaining({ mediaId: movie.id, episodeId: null }),
    );
  });

  test("keeps local media and episode IDs outside the provider namespace", () => {
    const series = createManualMedia({ title: "Station Eleven", kind: "series", totalEpisodes: 1 });
    const episode = createManualEpisode(series.id, "Wheel of Fire");
    expect(series.id).toBeLessThan(0);
    expect(episode).toMatchObject({
      id: expect.any(Number),
      mediaId: series.id,
      number: 1,
      aired: true,
    });
    expect(episode?.id).toBeLessThan(0);

    setEpisodeState(episode!.id, "watched");
    expect(appData.watchEvents).toContainEqual(
      expect.objectContaining({ mediaId: series.id, episodeId: episode!.id }),
    );
  });

  test("preserves source identity independently from the local media ID", () => {
    const media = createMediaFromSource(
      { providerId: "remote-7", kind: "series", title: "Severance" },
      { id: "connection-1", name: "Work Catalog" },
    );

    expect(media.id).toBeLessThan(0);
    expect(media.providerLinks).toEqual([
      {
        connectionId: "connection-1",
        connectionName: "Work Catalog",
        providerId: "remote-7",
      },
    ]);
    expect(
      createMediaFromSource(
        { providerId: "remote-7", kind: "series", title: "Severance" },
        { id: "connection-1", name: "Work Catalog" },
      ).id,
    ).toBe(media.id);
  });

  test("stores localized source titles independently", () => {
    const media = createMediaFromSource(
      {
        providerId: "localized-1",
        kind: "series",
        title: "Romaji Title",
        titleRomaji: "Romaji Title",
        titleEnglish: "English Title",
        titleNative: "Native Title",
      },
      { id: "connection-1", name: "Catalog" },
    );

    expect(media).toMatchObject({
      titleRomaji: "Romaji Title",
      titleEnglish: "English Title",
      titleNative: "Native Title",
    });
  });

  test("attaches a source identity to an existing legacy item without replacing it", () => {
    const media = appData.media[0];

    const attached = attachSourceToMedia(
      media.id,
      {
        providerId: "remote-101",
        kind: "series",
        title: "Fixture Series",
        canonicalUrl: "https://catalog.example/shows/remote-101",
      },
      { id: "connection-1", name: "Catalog" },
    );

    expect(attached).toBe(media);
    expect(attached).toMatchObject({
      id: 101,
      syncSource: {
        kind: "connection",
        connectionId: "connection-1",
        providerId: "remote-101",
      },
    });
    expect(attached?.providerLinks).toContainEqual({
      connectionId: "connection-1",
      connectionName: "Catalog",
      providerId: "remote-101",
      canonicalUrl: "https://catalog.example/shows/remote-101",
    });
  });
});
