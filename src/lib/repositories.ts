import { invoke } from "@tauri-apps/api/core";
import { parseV2Data } from "./legacy-data.js";
import type { AppData } from "./types.js";

/**
 * Persistence boundary used by the desktop application service.
 *
 * UI code works with this interface instead of Tauri commands or SQLite details.
 * The native implementation owns validation, migrations, and transaction scope.
 */
export interface AppDataRepository {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
}

export class DesktopAppDataRepository implements AppDataRepository {
  async load(): Promise<AppData | null> {
    const serialized = await invoke<string | null>("load_app_data");
    return serialized === null ? null : parseV2Data(serialized);
  }

  async save(data: AppData): Promise<void> {
    await invoke("save_app_data", {
      data: JSON.stringify({ ...data, exportedAt: new Date().toISOString() }),
    });
  }
}

export const desktopAppDataRepository: AppDataRepository = new DesktopAppDataRepository();

/** Write a portable, credential-free backup into the desktop backup directory. */
export async function saveDesktopBackup(data: AppData): Promise<string> {
  return invoke<string>("save_backup", {
    data: JSON.stringify({ ...data, exportedAt: new Date().toISOString() }),
  });
}
