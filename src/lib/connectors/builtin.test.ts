import { describe, expect, test, vi } from "vite-plus/test";
import { KITSU_TEMPLATE } from "./builtin.js";
import { ConnectorEngine } from "./engine.js";
import type { SourceConnection } from "./contracts.js";

const connection: SourceConnection = {
  id: "kitsu-connection",
  templateId: "kitsu",
  name: "Kitsu",
  baseUrl: KITSU_TEMPLATE.baseUrl,
  enabled: true,
  settings: {},
  secretReferences: {},
  capabilities: {},
  tracking: { mode: "import_only", audit: [] },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("built-in Kitsu source", () => {
  test("searches the API endpoint and maps season details", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "45993",
              attributes: {
                subtype: "TV",
                canonicalTitle: "Orient Part 2",
                titles: { en: "Orient Part 2", ja_jp: "オリエント" },
                startDate: "2022-07-11",
                status: "finished",
                episodeCount: 12,
                posterImage: { large: "https://media.kitsu.app/poster.jpg" },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const engine = new ConnectorEngine({ fetch: fetcher });

    const results = await engine.execute(KITSU_TEMPLATE, connection, "search", {
      input: { query: "orient" },
    });

    expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/api/edge/anime");
    expect(results).toEqual([
      expect.objectContaining({
        providerId: "45993",
        kind: "series",
        title: "Orient Part 2",
        format: "TV",
        startDate: "2022-07-11",
        lifecycle: "ended",
        episodeCount: 12,
      }),
    ]);
  });

  test("fetches details from the API endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "45993", attributes: { subtype: "TV", canonicalTitle: "Orient Part 2" } },
          included: [
            { type: "streamingLinks", attributes: { url: "https://www.crunchyroll.com/orient" } },
          ],
        }),
        { status: 200 },
      ),
    );
    const engine = new ConnectorEngine({ fetch: fetcher });

    const [details] = await engine.execute(KITSU_TEMPLATE, connection, "details", {
      input: { providerId: "45993" },
    });

    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/edge/anime/45993");
    expect(url.searchParams.get("include")).toBe("streamingLinks");
    expect(details).toMatchObject({
      providerId: "45993",
      title: "Orient Part 2",
      streamingLinks: ["https://www.crunchyroll.com/orient"],
    });
  });
});
