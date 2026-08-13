import { expect, expectTypeOf, test } from "vite-plus/test";
import type { MediaItem, WatchEvent } from "./contracts.js";

test("canonical media identity is provider-independent", () => {
  const movie: MediaItem = {
    id: "01989c35-d2fc-7f10-9c0b-d8a1c624ce10",
    kind: "movie",
    title: "Example Movie",
    localizedTitles: [],
    lifecycle: "ended",
    genres: [],
    artwork: [],
    createdAt: "2026-08-08T12:00:00Z",
    updatedAt: "2026-08-08T12:00:00Z",
  };

  expect(movie).not.toHaveProperty("providerId");
  expectTypeOf(movie.id).toBeString();
});

test("watch events distinguish movies from episodes", () => {
  const event: WatchEvent = {
    id: "01989c35-d2fc-7f10-9c0b-d8a1c624ce11",
    target: { kind: "episode", episodeId: "01989c35-d2fc-7f10-9c0b-d8a1c624ce12" },
    watchedAt: "2026-08-08T13:00:00Z",
    completion: 1,
    createdAt: "2026-08-08T13:00:00Z",
    updatedAt: "2026-08-08T13:00:00Z",
  };

  expect(event.target.kind).toBe("episode");
});
