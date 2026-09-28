import { expect, test } from "vite-plus/test";
import type { ExternalLink, LibraryEntry } from "./types.js";
import {
  isWatchUrl,
  mergeStreamingLinks,
  selectedWatchOption,
  streamingLinksFrom,
  watchButtonStyle,
  watchOptions,
} from "./watch-destination.js";

const links: ExternalLink[] = [
  {
    site: "Crunchyroll",
    url: "https://www.crunchyroll.com/series/1",
    type: "STREAMING",
    color: "#F88B24",
    icon: null,
  },
  {
    site: "Netflix",
    url: "https://www.netflix.com/title/2",
    type: "STREAMING",
    color: null,
    icon: null,
  },
  { site: "Info", url: "https://example.com/info", type: "INFO", color: null, icon: null },
];

test("watch destination defaults to the first API streaming provider", () => {
  expect(watchOptions(links)).toHaveLength(2);
  expect(selectedWatchOption(links)?.name).toBe("Crunchyroll");
});

test("saved provider and custom destinations take precedence", () => {
  const entry = { watchDestination: { kind: "provider", url: links[1].url } } as LibraryEntry;
  expect(selectedWatchOption(links, entry)?.name).toBe("Netflix");
  entry.watchDestination = { kind: "custom", name: "Plex", url: "http://localhost:32400/web" };
  expect(selectedWatchOption(links, entry)).toEqual({
    name: "Plex",
    url: "http://localhost:32400/web",
    color: null,
  });
  expect(isWatchUrl("javascript:alert(1)")).toBe(false);
});

test("a named platform without a show URL does not create a watch link", () => {
  const entry = {
    watchDestination: { kind: "custom", name: "Crunchyroll", url: "" },
  } as LibraryEntry;
  expect(selectedWatchOption([], entry)).toBeNull();
  expect(selectedWatchOption(links, entry)).toBeNull();
});

test("watch options carry the platform color, and custom entries borrow a matching one", () => {
  expect(selectedWatchOption(links)?.color).toBe("#F88B24");
  const unknownSite = { ...links[1], url: "https://example.com/show", color: "red; x: y" };
  expect(watchOptions([unknownSite])[0].color).toBeNull();
  const entry = {
    watchDestination: { kind: "custom", name: "crunchyroll", url: "https://example.com/show" },
  } as LibraryEntry;
  expect(selectedWatchOption(links, entry)?.color).toBe("#F88B24");
});

test("watch button text stays readable on light and dark platform colors", () => {
  expect(watchButtonStyle(null)).toBe("");
  expect(watchButtonStyle("#1CE783")).toContain("color: #18181b");
  expect(watchButtonStyle("#E50914")).toContain("color: #ffffff");
  expect(watchButtonStyle("#000000")).toContain("box-shadow");
});

test("streaming links from sources keep streaming URLs and fill in known platforms", () => {
  expect(
    streamingLinksFrom([
      { url: "https://www.iq.com/album/1", site: "iQ", type: "STREAMING", color: "#00CC36" },
      { url: "https://twitter.com/show", site: "Twitter", type: "SOCIAL" },
      "https://www.netflix.com/title/3",
      "https://www.netflix.com/title/3",
      "http://booklove-anime.jp",
      "javascript:alert(1)",
    ]),
  ).toEqual([
    {
      url: "https://www.iq.com/album/1",
      site: "iQ",
      type: "STREAMING",
      color: "#00CC36",
      icon: null,
    },
    {
      url: "https://www.netflix.com/title/3",
      site: "Netflix",
      type: "STREAMING",
      color: "#E50914",
      icon: null,
    },
  ]);
  expect(streamingLinksFrom(undefined)).toEqual([]);
  expect(streamingLinksFrom(null)).toEqual([]);
});

test("merging streaming links adds new platforms and keeps existing ones", () => {
  const found = streamingLinksFrom([
    "https://www.crunchyroll.com/series/1",
    "https://www.hulu.com/x",
  ]);
  const { links: merged, added } = mergeStreamingLinks(links, found);
  expect(added).toBe(1);
  expect(merged.map((link) => link.site)).toEqual(["Crunchyroll", "Netflix", "Info", "Hulu"]);
});

test("links without a color use the known platform's color", () => {
  expect(watchOptions(links)[1].color).toBe("#E50914");
});
