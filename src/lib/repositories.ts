import { invoke } from "@tauri-apps/api/core";
import { parseV2Data } from "./legacy-data.js";
import type { AppData, Settings } from "./types.js";

/** Areas of `AppData` stored as one database row per record. */
export const RECORD_AREAS = [
  "media",
  "episodes",
  "watchEvents",
  "library",
  "collections",
  "collectionEntries",
  "series",
  "seriesEntries",
] as const;
export type RecordArea = (typeof RECORD_AREAS)[number];

type AreaRecords = { [A in RecordArea]?: AppData[A] };

/**
 * A set of record-level writes applied in one native transaction. `replace`
 * rewrites a whole area, `delete` removes records by ID, and `upsert` inserts
 * or updates individual records.
 */
export interface AppDataChanges {
  replace?: AreaRecords;
  delete?: { [A in RecordArea]?: number[] };
  upsert?: AreaRecords;
  settings?: Settings;
}

/**
 * Persistence boundary used by the desktop application service.
 *
 * UI code works with this interface instead of Tauri commands or SQLite details.
 * The native implementation owns validation, migrations, and transaction scope.
 */
export interface AppDataRepository {
  load(): Promise<AppData | null>;
  applyChanges(changes: AppDataChanges): Promise<void>;
}

/** A change set that replaces the entire stored library with `data`. */
export function replaceAllChanges(data: AppData): AppDataChanges {
  const replace: AreaRecords = {};
  for (const area of RECORD_AREAS) {
    (replace as Record<RecordArea, unknown[]>)[area] = data[area];
  }
  return { replace, settings: data.settings };
}

export class DesktopAppDataRepository implements AppDataRepository {
  async load(): Promise<AppData | null> {
    const serialized = await invoke<string | null>("load_app_data");
    return serialized === null ? null : parseV2Data(serialized);
  }

  async applyChanges(changes: AppDataChanges): Promise<void> {
    await invoke("apply_app_data_changes", { changes: JSON.stringify(changes) });
  }
}

export const desktopAppDataRepository: AppDataRepository = new DesktopAppDataRepository();

/** Write a portable, credential-free backup into the desktop backup directory. */
export async function saveDesktopBackup(data: AppData): Promise<string> {
  return invoke<string>("save_backup", {
    data: JSON.stringify({ ...data, exportedAt: new Date().toISOString() }),
  });
}
