import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import { notify } from "./notifications.svelte.js";
import { flushPendingSave } from "./store.svelte.js";

export const RELEASES_URL = "https://github.com/StefanMarAntonsson/PLATYPUS/releases/latest";

type UpdateStatus =
  | "unavailable"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "error";

type InstallationKind = "appimage" | "package" | "development" | "browser";

interface UpdateInstallation {
  kind: Exclude<InstallationKind, "browser">;
  canSelfUpdate: boolean;
}

export const appUpdate = $state({
  status: "unavailable" as UpdateStatus,
  installationKind: "browser" as InstallationKind,
  canSelfUpdate: false,
  currentVersion: "",
  availableVersion: "",
  notes: "",
  error: "",
  downloadedBytes: 0,
  totalBytes: 0,
  dismissedVersion: "",
});

let initialized = false;
let pendingUpdate: Update | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closePendingUpdate(): Promise<void> {
  if (!pendingUpdate) return;
  const update = pendingUpdate;
  pendingUpdate = null;
  await update.close().catch(() => undefined);
}

export async function initializeAppUpdates(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!isTauri()) {
    appUpdate.status = "unavailable";
    return;
  }

  try {
    const [currentVersion, installation] = await Promise.all([
      getVersion(),
      invoke<UpdateInstallation>("update_installation"),
    ]);
    appUpdate.currentVersion = currentVersion;
    appUpdate.installationKind = installation.kind;
    appUpdate.canSelfUpdate = installation.canSelfUpdate;
    appUpdate.status = "idle";
    await checkForAppUpdate();
  } catch (error) {
    // Startup checks are best effort. Keep the diagnostic in Settings without
    // interrupting the user for a transient network or GitHub outage.
    appUpdate.error = errorMessage(error);
    appUpdate.status = "error";
  }
}

export async function checkForAppUpdate(announce = false): Promise<void> {
  if (
    !isTauri() ||
    appUpdate.status === "checking" ||
    appUpdate.status === "downloading" ||
    appUpdate.status === "installing"
  ) {
    return;
  }

  appUpdate.status = "checking";
  appUpdate.error = "";
  await closePendingUpdate();

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 30_000 });
    if (!update) {
      appUpdate.availableVersion = "";
      appUpdate.notes = "";
      appUpdate.status = "idle";
      if (announce)
        notify(
          "success",
          "PLATYPUS is up to date",
          `Version ${appUpdate.currentVersion} is the latest release.`,
        );
      return;
    }

    appUpdate.availableVersion = update.version;
    appUpdate.notes = update.body?.trim() ?? "";
    appUpdate.status = "available";
    if (appUpdate.canSelfUpdate) {
      pendingUpdate = update;
    } else {
      await update.close();
    }
  } catch (error) {
    appUpdate.error = errorMessage(error);
    appUpdate.status = "error";
    if (announce) notify("error", "Could not check for updates", appUpdate.error);
  }
}

export function dismissAvailableUpdate(): void {
  appUpdate.dismissedVersion = appUpdate.availableVersion;
}

export async function installAppUpdate(): Promise<void> {
  if (!pendingUpdate || !appUpdate.canSelfUpdate) return;

  const update = pendingUpdate;
  appUpdate.status = "downloading";
  appUpdate.error = "";
  appUpdate.downloadedBytes = 0;
  appUpdate.totalBytes = 0;

  try {
    await update.download(
      (event) => {
        if (event.event === "Started") {
          appUpdate.totalBytes = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          appUpdate.downloadedBytes += event.data.chunkLength;
        }
      },
      { timeout: 5 * 60_000 },
    );

    appUpdate.status = "installing";
    await flushPendingSave();
    await update.install();

    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    appUpdate.error = errorMessage(error);
    appUpdate.status = "available";
    notify("error", "Update could not be installed", appUpdate.error);
  }
}

export function updateProgressPercent(): number | null {
  if (appUpdate.totalBytes <= 0) return null;
  return Math.min(100, Math.round((appUpdate.downloadedBytes / appUpdate.totalBytes) * 100));
}
