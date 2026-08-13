import { invoke } from "@tauri-apps/api/core";
import { notify } from "./notifications.svelte.js";
import type { ExternalBrowser } from "./types.js";

export interface BrowserOption {
  id: ExternalBrowser;
  label: string;
}

const SYSTEM_BROWSER: BrowserOption = { id: "system", label: "System default" };

export async function availableExternalBrowsers(): Promise<BrowserOption[]> {
  try {
    return await invoke<BrowserOption[]>("available_browsers");
  } catch {
    return [SYSTEM_BROWSER];
  }
}

export async function openExternalUrl(url: string, browser: ExternalBrowser): Promise<void> {
  try {
    await invoke("open_external_url", { url, browser });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify("error", "Could not open link", message);
  }
}
