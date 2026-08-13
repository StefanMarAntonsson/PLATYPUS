import { describe, expect, test } from "vite-plus/test";
import restTemplate from "./connectors/fixtures/rest-source.platypus-source.json";
import type { SourceConnection, SourceTemplateV1 } from "./connectors/contracts.js";
import { newConnection, parseConfiguredSources } from "./sources.svelte.js";

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
});
