import { describe, expect, test } from "vite-plus/test";
import restTemplate from "./connectors/fixtures/rest-source.platypus-source.json";
import type { SourceConnection, SourceTemplateV1 } from "./connectors/contracts.js";
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

  test("upgrades legacy AniList mappings to request localized titles", () => {
    const aniListTemplate: SourceTemplateV1 = {
      ...template,
      id: "anilist",
      operations: {
        details: {
          request: {
            protocol: "graphql",
            method: "POST",
            path: "/",
            query: "query { Media { id title { romaji native } } }",
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
      titleRomaji: "$.title.romaji",
      titleEnglish: "$.title.english",
      titleNative: "$.title.native",
    });
  });
});
