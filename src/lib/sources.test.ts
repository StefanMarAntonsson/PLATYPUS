import { describe, expect, test } from "vite-plus/test";
import restTemplate from "./connectors/fixtures/rest-source.platypus-source.json";
import type { SourceConnection, SourceTemplateV1 } from "./connectors/contracts.js";
import { ConnectorEngine } from "./connectors/engine.js";
import {
  newConnection,
  parseConfiguredSources,
  refreshConnectionForTemplate,
  sourcesState,
} from "./sources.svelte.js";

const template = restTemplate as SourceTemplateV1;

describe("configured sources", () => {
  test("creates a local connection without copying credentials into it", () => {
    const connection = newConnection(template, "My catalog");

    expect(connection).toMatchObject({
      templateId: template.id,
      name: "My catalog",
      baseUrl: template.baseUrl,
      enabled: true,
      settings: {},
      secretReferences: {},
    });
  });

  test("drops invalid or host-escaping persisted connections", () => {
    const safe = newConnection(template);
    const escaped: SourceConnection = {
      ...safe,
      id: "escaped",
      baseUrl: "https://unapproved.example",
    };
    const wrongTemplate: SourceConnection = {
      ...safe,
      id: "wrong-template",
      templateId: "another-template",
    };

    expect(
      parseConfiguredSources([
        { template, connection: safe },
        { template, connection: escaped },
        { template, connection: wrongTemplate },
        { template: { ...template, baseUrl: "http://api.catalog.example" }, connection: safe },
      ]),
    ).toEqual([{ template, connection: safe }]);
  });

  test("resolves a legacy provider kind only through an enabled refresh-capable connection", () => {
    const connection = newConnection(template);
    sourcesState.sources = [{ template, connection }];

    expect(refreshConnectionForTemplate(template.id)).toBe(connection);

    sourcesState.sources = [{ template, connection: { ...connection, enabled: false } }];
    expect(refreshConnectionForTemplate(template.id)).toBeUndefined();

    sourcesState.sources = [];
  });

  test("upgrades legacy AniList mappings for localized titles and missing formats", async () => {
    const aniListTemplate: SourceTemplateV1 = {
      ...template,
      id: "anilist",
      authentication: { type: "none" },
      operations: {
        details: {
          request: {
            protocol: "graphql",
            method: "POST",
            path: "/",
            query:
              "query { Media(id: ${input.providerId}, type: ANIME) { id title { romaji native } } }",
          },
          response: {
            resultsPath: "$.data.Media",
            mapping: {
              providerId: "$.id",
              kind: "$.format",
              title: "$.title.romaji",
              originalTitle: "$.title.native",
            },
          },
        },
        episodes: {
          request: {
            protocol: "graphql",
            method: "POST",
            path: "/",
            query:
              "query GetEpisodes { Media(id: ${input.providerId}) { airingSchedule(page: 1, perPage: 150) { nodes { id episode airingAt } } } }",
          },
          response: {
            resultsPath: "$.data.Media.airingSchedule.nodes",
            mapping: { providerId: "$.id", episodeNumber: "$.episode" },
          },
        },
      },
    };
    const connection = newConnection(aniListTemplate);

    const [configured] = parseConfiguredSources([{ template: aniListTemplate, connection }]);
    const details = configured.template.operations.details;

    expect(details?.request).toMatchObject({
      protocol: "graphql",
      query: expect.stringContaining("romaji native  english"),
    });
    expect(details?.response.mapping).toMatchObject({
      kind: "$.type",
      format: "$.format",
      titleRomaji: "$.title.romaji",
      titleEnglish: "$.title.english",
      titleNative: "$.title.native",
      streamingLinks: "$.externalLinks",
    });
    expect(details?.request.protocol === "graphql" && details.request.query).toContain(
      "externalLinks { url site type color }",
    );
    expect(details?.request.protocol === "graphql" && details.request.query).toContain(
      "Media(id: ${input.providerId}, type: ANIME) { type",
    );
    expect(configured.template.operations.episodes).toMatchObject({
      request: {
        query: expect.stringContaining(
          "airingSchedule(page: ${page.number}, perPage: 25) { pageInfo { hasNextPage }",
        ),
      },
      pagination: { type: "page", hasNextPath: "$.data.Media.airingSchedule.pageInfo.hasNextPage" },
    });

    let sentQuery = "";
    const engine = new ConnectorEngine({
      fetch: async (_url, init) => {
        sentQuery = JSON.parse(typeof init.body === "string" ? init.body : "{}").query;
        return new Response(
          JSON.stringify({
            data: {
              Media: {
                id: 212618,
                type: "ANIME",
                format: null,
                title: { romaji: "Dorohedoro Season 3", english: null },
              },
            },
          }),
          { status: 200 },
        );
      },
    });
    await expect(
      engine.execute(configured.template, connection, "details", {
        input: { providerId: "212618" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "212618",
        kind: "series",
        title: "Dorohedoro Season 3",
        format: null,
      }),
    ]);
    expect(sentQuery).toContain("Media(id: 212618, type: ANIME) { type");
  });
});
