import { describe, expect, test } from "vite-plus/test";
import restTemplate from "./fixtures/rest-source.platypus-source.json";
import type { SourceConnection, SourceTemplateV1 } from "./contracts.js";
import { createSourceBundle, parseSourceBundle } from "./source-bundle.js";

const template = restTemplate as SourceTemplateV1;
const connection: SourceConnection = {
  id: "local-only-id",
  templateId: template.id,
  name: "Living room TV",
  baseUrl: template.baseUrl,
  enabled: true,
  settings: { region: "CA" },
  secretReferences: { token: "keyring-reference" },
  capabilities: {
    search: { operation: "search", declared: true, state: "verified" },
  },
  tracking: {
    mode: "import_only",
    audit: [
      { at: "2026-01-01T00:00:00.000Z", direction: "import", outcome: "success", processed: 2 },
    ],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("portable source bundles", () => {
  test("exports all connection definitions without local or secret state", () => {
    const bundle = createSourceBundle([{ template, connection }]);

    expect(bundle).toMatchObject({
      format: "platypus-sources",
      schemaVersion: 1,
      sources: [
        {
          template: { id: "example-rest-catalog" },
          connection: {
            name: "Living room TV",
            baseUrl: template.baseUrl,
            enabled: true,
            settings: { region: "CA" },
            trackingMode: "import_only",
          },
        },
      ],
    });
    expect(JSON.stringify(bundle)).not.toContain("local-only-id");
    expect(JSON.stringify(bundle)).not.toContain("keyring-reference");
    expect(JSON.stringify(bundle)).not.toContain("capabilities");
    expect(JSON.stringify(bundle)).not.toContain("audit");
  });

  test("exports reactive proxy-backed source state", () => {
    const reactiveTemplate = new Proxy(template, {});
    const reactiveSettings = new Proxy(connection.settings, {});
    const reactiveConnection = new Proxy({ ...connection, settings: reactiveSettings }, {});

    expect(() =>
      createSourceBundle([{ template: reactiveTemplate, connection: reactiveConnection }]),
    ).not.toThrow();
    expect(
      createSourceBundle([{ template: reactiveTemplate, connection: reactiveConnection }])
        .sources[0].template.id,
    ).toBe("example-rest-catalog");
  });

  test("validates imported templates and connection hosts", () => {
    const bundle = createSourceBundle([{ template, connection }]);
    expect(parseSourceBundle(bundle).sources).toHaveLength(1);

    bundle.sources[0].connection.baseUrl = "https://unapproved.example";
    expect(() => parseSourceBundle(bundle)).toThrow(/outside its allowed hosts/);
  });

  test("rejects an unrelated JSON file", () => {
    expect(() => parseSourceBundle({ schemaVersion: 1, sources: [] })).toThrow(
      /not a supported PLATYPUS sources file/,
    );
  });
});
