import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import fixture from "./fixtures/v2-library.json";
import { parseV2Data } from "./legacy-data.js";
import type { AppDataChanges } from "./repositories.js";

const applyChanges = vi.fn<(changes: AppDataChanges) => Promise<void>>();

vi.mock("./repositories.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repositories.js")>()),
  desktopAppDataRepository: { load: vi.fn(), applyChanges },
}));

const { appData, fs, flushPendingSave, removeFromLibrary, setEpisodeState, updateSettings } =
  await import("./store.svelte.js");

beforeEach(() => {
  applyChanges.mockReset();
  applyChanges.mockResolvedValue(undefined);
  fs.saveError = "";
  Object.assign(appData, parseV2Data(JSON.stringify(fixture)));
});

describe("record-level persistence", () => {
  test("an episode tick saves only the records it touched", async () => {
    const episode = appData.episodes[1];
    setEpisodeState(episode.id, "watched");
    await flushPendingSave();

    expect(applyChanges).toHaveBeenCalledTimes(1);
    const changes = applyChanges.mock.lastCall![0];
    expect(changes.replace).toBeUndefined();
    expect(changes.upsert?.episodes?.map((item) => item.id)).toEqual([episode.id]);
    expect(changes.upsert?.watchEvents).toHaveLength(1);
    expect(changes.upsert?.media).toBeUndefined();
  });

  test("records removed from memory are deleted by id", async () => {
    const entry = appData.library[0];
    removeFromLibrary(entry.mediaId);
    await flushPendingSave();

    expect(applyChanges.mock.lastCall![0]).toEqual({ delete: { library: [entry.id] } });
  });

  test("rapid edits are batched into one write", async () => {
    updateSettings({ autoSync: true });
    updateSettings({ showTba: false });
    await flushPendingSave();

    expect(applyChanges).toHaveBeenCalledTimes(1);
    expect(applyChanges.mock.lastCall![0].settings).toMatchObject({
      autoSync: true,
      showTba: false,
    });
  });

  test("a failed write is retried with the next save", async () => {
    applyChanges.mockRejectedValueOnce(new Error("disk full"));
    updateSettings({ autoSync: true });
    await expect(flushPendingSave()).rejects.toThrow("disk full");

    const episode = appData.episodes[1];
    setEpisodeState(episode.id, "skipped");
    await flushPendingSave();

    const retry = applyChanges.mock.lastCall![0];
    expect(retry.settings).toMatchObject({ autoSync: true });
    expect(retry.upsert?.episodes?.map((item) => item.id)).toEqual([episode.id]);
    expect(fs.saveError).toBe("");
  });
});
