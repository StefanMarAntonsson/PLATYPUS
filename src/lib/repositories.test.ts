import { describe, expect, test, vi } from "vite-plus/test";
import { EMPTY_APP_DATA } from "./legacy-data.js";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { DesktopAppDataRepository, RECORD_AREAS, replaceAllChanges } =
  await import("./repositories.js");

describe("desktop application-data repository", () => {
  test("returns null when the native repository has no saved library", async () => {
    invoke.mockResolvedValueOnce(null);

    await expect(new DesktopAppDataRepository().load()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("load_app_data");
  });

  test("validates native data through the versioned backup parser", async () => {
    invoke.mockResolvedValueOnce(JSON.stringify(EMPTY_APP_DATA));

    await expect(new DesktopAppDataRepository().load()).resolves.toMatchObject({ version: 2 });
  });

  test("sends record-level change sets through the narrow native command", async () => {
    invoke.mockResolvedValueOnce(undefined);

    await new DesktopAppDataRepository().applyChanges({ delete: { episodes: [4] } });

    expect(invoke).toHaveBeenCalledWith("apply_app_data_changes", {
      changes: JSON.stringify({ delete: { episodes: [4] } }),
    });
  });

  test("a full replacement covers every stored area and the settings", () => {
    const data = structuredClone(EMPTY_APP_DATA);
    const changes = replaceAllChanges(data);

    expect(Object.keys(changes.replace ?? {}).sort()).toEqual([...RECORD_AREAS].sort());
    expect(changes.settings).toEqual(data.settings);
  });
});
