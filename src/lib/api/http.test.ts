import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { fetchWithRetry } from "./http.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithRetry", () => {
  test("retries transient responses and returns the later success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithRetry("https://example.test", { maxRetries: 2 });
    await vi.runAllTimersAsync();
    const response = await request;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("returns the final failure after exhausting retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503, headers: { "Retry-After": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithRetry("https://example.test", { maxRetries: 2 });
    await vi.runAllTimersAsync();
    const response = await request;

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
