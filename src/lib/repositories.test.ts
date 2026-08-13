import { describe, expect, test, vi } from "vite-plus/test";
import { EMPTY_APP_DATA } from "./legacy-data.js";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { DesktopAppDataRepository } = await import("./repositories.js");

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

  test("saves a complete versioned document through the narrow native command", async () => {
    invoke.mockResolvedValueOnce(undefined);
    const data = structuredClone(EMPTY_APP_DATA);

    await new DesktopAppDataRepository().save(data);

    expect(invoke).toHaveBeenCalledWith("save_app_data", {
      data: expect.stringContaining('"version":2'),
    });

    const lastCall = invoke.mock.lastCall;
    expect(lastCall).toBeDefined();
    const { data: serialized } = lastCall![1] as { data: string };
    expect(JSON.parse(serialized)).toMatchObject({
      version: 2,
      exportedAt: expect.any(String),
      settings: EMPTY_APP_DATA.settings,
    });
  });
});
