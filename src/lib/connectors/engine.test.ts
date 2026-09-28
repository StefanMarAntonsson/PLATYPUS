import { describe, expect, test, vi } from "vite-plus/test";
import restTemplate from "./fixtures/rest-source.platypus-source.json";
import { ConnectorEngine, isConnectorUnavailableError, validateSourceTemplate } from "./engine.js";
import type { SourceConnection, SourceTemplateV1 } from "./contracts.js";

const template = restTemplate as SourceTemplateV1;

const connection: SourceConnection = {
  id: "connection-1",
  templateId: template.id,
  name: "Test",
  baseUrl: template.baseUrl,
  enabled: true,
  settings: {},
  secretReferences: { apiKey: "key-ref" },
  capabilities: {},
  tracking: { mode: "import_only", audit: [] },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("connector engine", () => {
  test("validates safe mapping paths beyond the JSON schema", () => {
    const invalid = structuredClone(template);
    invalid.operations.search!.response.mapping.title = "$.results[?(@.name)]";
    expect(validateSourceTemplate(invalid).valid).toBe(false);
  });

  test("requires the base URL host to be explicitly approved", () => {
    const invalid = structuredClone(template);
    invalid.allowedHosts = ["elsewhere.example"];
    expect(validateSourceTemplate(invalid).valid).toBe(false);
  });

  test("injects a resolved secret, maps pages, and caches the result", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "7",
              media_type: "movie",
              name: "Seven",
              images: { poster: "https://images.catalog.example/7.jpg" },
            },
          ],
          pages: 1,
        }),
        { status: 200 },
      ),
    );
    const engine = new ConnectorEngine({
      fetch: fetcher,
      resolveSecret: async (reference) => (reference === "key-ref" ? "secret" : undefined),
      now: () => 1_000,
    });
    const first = await engine.execute(template, connection, "search", {
      input: { query: "seven", mediaKind: "movie" },
    });
    const second = await engine.execute(template, connection, "search", {
      input: { query: "seven", mediaKind: "movie" },
    });
    expect(first).toEqual([
      {
        providerId: "7",
        kind: "movie",
        title: "Seven",
        artwork: [{ kind: "poster", url: "https://images.catalog.example/7.jpg" }],
      },
    ]);
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("q=seven");
    expect(fetcher.mock.calls[0][1].headers.get("X-API-Key")).toBe("secret");
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
  });

  test("coerces common provider ID and media-kind shapes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ results: [{ id: 7, media_type: "TV", name: "Severance" }], pages: 1 }),
          { status: 200 },
        ),
      );
    const engine = new ConnectorEngine({ fetch: fetcher, resolveSecret: async () => "secret" });

    await expect(engine.execute(template, connection, "search")).resolves.toEqual([
      expect.objectContaining({ providerId: "7", kind: "series", title: "Severance" }),
    ]);
  });

  test("interpolates provider IDs into declarative GraphQL queries", async () => {
    const graphqlTemplate = structuredClone(template);
    graphqlTemplate.id = "example-graphql-details";
    graphqlTemplate.baseUrl = "https://graphql.catalog.example";
    graphqlTemplate.allowedHosts = ["graphql.catalog.example"];
    graphqlTemplate.authentication = { type: "none" };
    graphqlTemplate.operations.details = {
      request: {
        protocol: "graphql",
        method: "POST",
        path: "/graphql",
        query: "query GetTitle { title(id: ${input.providerId}) { id type title } }",
      },
      response: {
        resultsPath: "$.data.title",
        mapping: { providerId: "$.id", kind: "$.type", title: "$.title" },
      },
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            title: {
              id: 123,
              type: "series",
              title: "Example",
            },
          },
        }),
        { status: 200 },
      ),
    );
    const engine = new ConnectorEngine({ fetch: fetcher });
    const graphqlConnection: SourceConnection = {
      ...connection,
      templateId: graphqlTemplate.id,
      baseUrl: graphqlTemplate.baseUrl,
      secretReferences: {},
    };

    await expect(
      engine.execute(graphqlTemplate, graphqlConnection, "details", {
        input: { providerId: "123" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ providerId: "123", kind: "series", title: "Example" }),
    ]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).query).toContain("title(id: 123");
  });

  test("rejects redirects so a source cannot escape its approved hosts", async () => {
    const engine = new ConnectorEngine({
      fetch: async () =>
        new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } }),
      resolveSecret: async () => "secret",
    });
    await expect(
      engine.execute(template, connection, "search", { input: { query: "seven" } }),
    ).rejects.toThrow("redirected");
  });

  test.each([
    [401, true],
    [429, true],
    [503, true],
    [404, false],
  ])("classifies HTTP %i connection availability", async (status, unavailable) => {
    const engine = new ConnectorEngine({
      fetch: async () => new Response(null, { status }),
      resolveSecret: async () => "secret",
    });

    const error = await engine
      .execute(template, connection, "details", { input: { providerId: "7" } })
      .catch((reason: unknown) => reason);

    expect(isConnectorUnavailableError(error)).toBe(unavailable);
  });

  test("classifies network failures as connection-wide", async () => {
    const engine = new ConnectorEngine({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      resolveSecret: async () => "secret",
    });

    const error = await engine
      .execute(template, connection, "details", { input: { providerId: "7" } })
      .catch((reason: unknown) => reason);

    expect(isConnectorUnavailableError(error)).toBe(true);
  });

  test("waits for Retry-After before retrying a rate-limited source", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              results: [{ id: "7", media_type: "TV", name: "Seven" }],
              pages: 1,
            }),
            { status: 200 },
          ),
        );
      const engine = new ConnectorEngine({ fetch: fetcher, resolveSecret: async () => "secret" });
      const pending = engine.execute(template, connection, "search", { input: { query: "seven" } });

      await vi.advanceTimersByTimeAsync(1999);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancels a Retry-After wait without making another request", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    const engine = new ConnectorEngine({ fetch: fetcher, resolveSecret: async () => "secret" });
    const pending = engine.execute(template, connection, "search", {
      input: { query: "seven" },
      signal: controller.signal,
    });

    while (fetcher.mock.calls.length === 0) await Promise.resolve();
    controller.abort(new Error("Cancelled"));

    await expect(pending).rejects.toThrow("Cancelled");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("returns one unmodified payload for source-builder previews", async () => {
    const payload = { results: [{ id: "7", media_type: "movie", name: "Seven" }] };
    const engine = new ConnectorEngine({
      fetch: async () => new Response(JSON.stringify(payload), { status: 200 }),
      resolveSecret: async () => "secret",
    });

    await expect(
      engine.preview(template, connection, "search", { input: { query: "seven" } }),
    ).resolves.toEqual(payload);
  });

  test("maps non-media history records without weakening request safeguards", async () => {
    const historyTemplate = structuredClone(template);
    historyTemplate.operations.history = {
      request: { protocol: "rest", method: "GET", path: "/history" },
      response: {
        resultsPath: "$.events",
        mapping: {
          remoteEventId: "$.id",
          providerId: "$.mediaId",
          watchedAt: "$.watchedAt",
        },
      },
    };
    const engine = new ConnectorEngine({
      fetch: async () =>
        new Response(
          JSON.stringify({
            events: [{ id: "event-1", mediaId: "7", watchedAt: "2026-01-01T00:00:00Z" }],
          }),
          { status: 200 },
        ),
      resolveSecret: async () => "secret",
    });

    await expect(engine.executeRecords(historyTemplate, connection, "history")).resolves.toEqual([
      { remoteEventId: "event-1", providerId: "7", watchedAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  test("collects every page of episode records", async () => {
    const paged = structuredClone(template);
    paged.operations.episodes = {
      request: {
        protocol: "rest",
        method: "GET",
        path: "/episodes",
        query: { page: "${page.number}" },
      },
      response: {
        resultsPath: "$.episodes",
        mapping: { providerId: "$.id", episodeNumber: "$.number" },
      },
      pagination: { type: "page", parameter: "page", hasNextPath: "$.hasNext" },
    };
    const pages: number[] = [];
    const engine = new ConnectorEngine({
      fetch: async (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        pages.push(page);
        return new Response(
          JSON.stringify({
            episodes: [{ id: `episode-${page}`, number: 1172 + page }],
            hasNext: page < 3,
          }),
          { status: 200 },
        );
      },
      resolveSecret: async () => "secret",
    });

    await expect(engine.executeRecords(paged, connection, "episodes")).resolves.toEqual([
      { providerId: "episode-1", episodeNumber: 1173 },
      { providerId: "episode-2", episodeNumber: 1174 },
      { providerId: "episode-3", episodeNumber: 1175 },
    ]);
    expect(pages).toEqual([1, 2, 3]);
  });
});
