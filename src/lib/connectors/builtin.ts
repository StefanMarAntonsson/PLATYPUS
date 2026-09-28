import type { SourceOperationTemplate, SourceTemplateV1 } from "./contracts.js";

/**
 * Sources that ship with PLATYPUS. Both are public APIs that need no key and
 * permit third-party apps:
 *
 * - Kitsu lists anime per season or part, including films, with episode
 *   counts and dates. It is the main place to search for and add titles.
 * - TVmaze has exact per-episode air times. It supplies the airing schedule
 *   for seasons added from sources that lack one (see api/schedule.ts), and
 *   its data is licensed CC BY-SA, so the UI credits and links back to it.
 *
 * Built-in templates are owned by the app: a stored template with the same
 * id is replaced by this version on load, while the user's connection
 * (enabled state, name) is kept.
 */

const retry = { maxAttempts: 2, backoffMs: 500, retryStatuses: [429, 502, 503, 504] };

const kitsuMediaMapping: Record<string, string> = {
  providerId: "$.id",
  kind: "$.attributes.subtype",
  format: "$.attributes.subtype",
  title: "$.attributes.canonicalTitle",
  titleEnglish: "$.attributes.titles.en",
  titleRomaji: "$.attributes.titles.en_jp",
  titleNative: "$.attributes.titles.ja_jp",
  originalTitle: "$.attributes.titles.ja_jp",
  overview: "$.attributes.synopsis",
  startDate: "$.attributes.startDate",
  endDate: "$.attributes.endDate",
  lifecycle: "$.attributes.status",
  episodeCount: "$.attributes.episodeCount",
  runtimeMinutes: "$.attributes.episodeLength",
  "artwork.poster": "$.attributes.posterImage.large",
  "artwork.backdrop": "$.attributes.coverImage.large",
};

/** Details read the whole document, so included streaming links are reachable. */
const kitsuDetailsMapping: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(kitsuMediaMapping).map(([field, path]) => [
      field,
      path.replace(/^\$/, "$.data"),
    ]),
  ),
  streamingLinks: "$.included[*].attributes.url",
};

export const KITSU_TEMPLATE: SourceTemplateV1 = {
  schemaVersion: 1,
  id: "kitsu",
  name: "Kitsu",
  description: "Anime by season or part, including films, from Kitsu's public API.",
  baseUrl: "https://kitsu.io/api/edge",
  allowedHosts: ["kitsu.io"],
  assetHosts: ["media.kitsu.app", "media.kitsu.io"],
  attribution: { name: "Kitsu", url: "https://kitsu.app" },
  authentication: { type: "none" },
  cache: { defaultTtlSeconds: 3600 },
  operations: {
    search: {
      request: {
        protocol: "rest",
        method: "GET",
        path: "/api/edge/anime",
        query: { "filter[text]": "${input.query}", "page[limit]": "20" },
      },
      response: { resultsPath: "$.data", mapping: kitsuMediaMapping },
      timeoutMs: 10000,
      retry,
    },
    details: {
      request: {
        protocol: "rest",
        method: "GET",
        path: "/api/edge/anime/${input.providerId}",
        query: { include: "streamingLinks" },
      },
      response: { mapping: kitsuDetailsMapping },
      timeoutMs: 10000,
      retry,
    },
  },
};

const tvmazeEpisodes: SourceOperationTemplate = {
  request: { protocol: "rest", method: "GET", path: "/shows/${input.providerId}/episodes" },
  response: {
    resultsPath: "$",
    mapping: {
      providerId: "$.id",
      seasonNumber: "$.season",
      episodeNumber: "$.number",
      title: "$.name",
      airingAt: "$.airstamp",
      airDate: "$.airdate",
      thumbnail: "$.image.original",
    },
  },
  timeoutMs: 10000,
  retry,
};

export const TVMAZE_TEMPLATE: SourceTemplateV1 = {
  schemaVersion: 1,
  id: "tvmaze",
  name: "TVmaze",
  description: "TV series and exact episode air times from TVmaze's public API.",
  baseUrl: "https://api.tvmaze.com",
  allowedHosts: ["api.tvmaze.com"],
  assetHosts: ["static.tvmaze.com"],
  attribution: { name: "TVmaze", url: "https://www.tvmaze.com", license: "CC BY-SA 4.0" },
  authentication: { type: "none" },
  cache: { defaultTtlSeconds: 3600 },
  operations: {
    search: {
      request: {
        protocol: "rest",
        method: "GET",
        path: "/search/shows",
        query: { q: "${input.query}" },
      },
      response: {
        resultsPath: "$",
        mapping: {
          providerId: "$.show.id",
          kind: "$.show.type",
          mediaType: "$.show.type",
          title: "$.show.name",
          originalLanguage: "$.show.language",
          startDate: "$.show.premiered",
          endDate: "$.show.ended",
          lifecycle: "$.show.status",
          network: "$.show.network.name",
          overview: "$.show.summary",
          genres: "$.show.genres",
          canonicalUrl: "$.show.url",
          "artwork.poster": "$.show.image.original",
        },
      },
      timeoutMs: 10000,
      retry,
    },
    details: {
      request: { protocol: "rest", method: "GET", path: "/shows/${input.providerId}" },
      response: {
        mapping: {
          providerId: "$.id",
          kind: "$.type",
          mediaType: "$.type",
          title: "$.name",
          overview: "$.summary",
          originalLanguage: "$.language",
          startDate: "$.premiered",
          endDate: "$.ended",
          runtimeMinutes: "$.runtime",
          lifecycle: "$.status",
          network: "$.network.name",
          genres: "$.genres",
          canonicalUrl: "$.url",
          // Often the show's page on its streaming service, e.g. Netflix.
          streamingLinks: "$.officialSite",
          "artwork.poster": "$.image.original",
        },
      },
      timeoutMs: 10000,
      retry,
    },
    episodes: tvmazeEpisodes,
  },
};

export const BUILTIN_TEMPLATES: SourceTemplateV1[] = [KITSU_TEMPLATE, TVMAZE_TEMPLATE];

export function isBuiltinTemplate(templateId: string): boolean {
  return BUILTIN_TEMPLATES.some((template) => template.id === templateId);
}
