<script lang="ts">
  import type { TitleLanguage, ExternalBrowser } from '$lib/types.js';
  import { appData, fs, updateSettings, previewV2Import, importV2Data } from '$lib/store.svelte.js';
  import type { V2MigrationPreview } from '$lib/v2-migration.js';
  import { saveDesktopBackup } from '$lib/repositories.js';
  import { availableExternalBrowsers, openExternalUrl, type BrowserOption } from '$lib/external-links.js';
  import {
    RELEASES_URL,
    appUpdate,
    checkForAppUpdate,
    installAppUpdate,
  } from '$lib/app-update.svelte.js';
  import { onMount } from 'svelte';
  import SourcesPage from '../sources/+page.svelte';

  let importResult = $state('');
  let migrationPreview = $state<V2MigrationPreview | null>(null);
  let migrationError = $state('');
  let importing = $state(false);
  let importInput = $state<HTMLInputElement | null>(null);
  let browserOptions = $state<BrowserOption[]>([{ id: 'system', label: 'System default' }]);
  let activeSection = $state<'general' | 'sources' | 'data'>('general');

  const sections = [
    { id: 'general', label: 'General' },
    { id: 'sources', label: 'Sources' },
    { id: 'data', label: 'Sync & Data' },
  ] as const;
  onMount(async () => {
    browserOptions = await availableExternalBrowsers();
    if (!browserOptions.some(option => option.id === appData.settings.externalBrowser)) {
      updateSettings({ externalBrowser: 'system' });
    }
  });
  async function handleSaveCopy() {
    try {
      const path = await saveDesktopBackup(appData);
      importResult = `Backup saved to ${path}`;
      setTimeout(() => importResult = '', 8000);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') {
        importResult = 'Save failed';
      }
    }
  }

  async function previewImport(event: Event) {
    migrationPreview = null;
    migrationError = '';
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      migrationPreview = previewV2Import(await file.text());
    } catch (error) {
      migrationError = error instanceof Error ? error.message : 'Could not validate this backup.';
    }
  }

  async function confirmImport() {
    if (!migrationPreview) return;
    importing = true;
    migrationError = '';
    try {
      await importV2Data(migrationPreview);
      importResult = 'Version 2 backup imported safely.';
      migrationPreview = null;
      if (importInput) importInput.value = '';
    } catch (error) {
      migrationError = error instanceof Error ? error.message : 'Could not import this backup.';
    } finally {
      importing = false;
    }
  }

  const s = $derived(appData.settings);
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center px-4 py-3 md:px-6">
    <div class="inline-flex items-center rounded-lg bg-zinc-900/90 p-1 shadow-inner shadow-black/40" role="tablist" aria-label="Settings sections">
      {#each sections as section}
        <button
          role="tab"
          aria-selected={activeSection === section.id}
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-all
            {activeSection === section.id
              ? 'bg-accent text-white shadow-sm shadow-black/40'
              : 'text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-300'}"
          onclick={() => activeSection = section.id}
        >{section.label}</button>
      {/each}
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-6">
    <div class="w-full max-w-3xl space-y-4">

      {#if activeSection === 'general'}
        <section class="overflow-hidden rounded-md border border-border bg-surface-2/30">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-zinc-200">Application updates</h2>
            <p class="mt-0.5 text-xs text-zinc-500">
              AppImage updates are signed and can be installed in place. Debian packages remain managed through APT.
            </p>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p class="text-sm text-zinc-300">
                Version {appUpdate.currentVersion || 'unknown'}
                {#if appUpdate.availableVersion}
                  <span class="ml-2 text-amber-400">Version {appUpdate.availableVersion} available</span>
                {:else if appUpdate.status === 'idle'}
                  <span class="ml-2 text-emerald-500">Up to date</span>
                {/if}
              </p>
              <p class="mt-0.5 text-xs text-zinc-500">
                {appUpdate.installationKind === 'appimage'
                  ? 'AppImage installation · in-app updates enabled'
                  : appUpdate.installationKind === 'package'
                    ? 'System package installation · download updates from GitHub Releases'
                    : appUpdate.installationKind === 'development'
                      ? 'Development build · installation disabled'
                      : 'Update checks are available in the desktop app'}
              </p>
              {#if appUpdate.status === 'error' && appUpdate.error}
                <p class="mt-1 max-w-xl text-xs text-red-400">{appUpdate.error}</p>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2">
              {#if appUpdate.status === 'available' && appUpdate.canSelfUpdate}
                <button
                  class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  onclick={() => void installAppUpdate()}
                >Install and restart</button>
              {:else if appUpdate.status === 'available'}
                <button
                  class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  onclick={() => void openExternalUrl(RELEASES_URL, s.externalBrowser)}
                >Open GitHub release</button>
              {/if}
              <button
                class="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-wait disabled:opacity-50"
                disabled={appUpdate.status === 'checking' || appUpdate.status === 'downloading' || appUpdate.status === 'installing' || appUpdate.status === 'unavailable'}
                onclick={() => void checkForAppUpdate(true)}
              >{appUpdate.status === 'checking' ? 'Checking…' : 'Check for updates'}</button>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-md border border-border bg-surface-2/30">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-zinc-200">External links</h2>
            <p class="mt-0.5 text-xs text-zinc-500">Choose which installed browser opens media and streaming links.</p>
          </div>
          <label class="flex flex-wrap items-center justify-between gap-3 px-4 py-3" for="external-browser">
            <span class="text-sm text-zinc-400">Open links with</span>
            <span class="relative">
              <select
                id="external-browser"
                class="appearance-none rounded-md border border-border bg-zinc-900 py-2 pl-3 pr-9 text-sm text-zinc-200 outline-none [color-scheme:dark] focus:border-zinc-500"
                value={s.externalBrowser}
                onchange={e => updateSettings({ externalBrowser: (e.target as HTMLSelectElement).value as ExternalBrowser })}
              >
                {#each browserOptions as browser}
                  <option value={browser.id}>{browser.label}</option>
                {/each}
              </select>
              <svg class="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </span>
          </label>
        </section>
      {/if}

      {#if activeSection === 'sources'}
        <SourcesPage embedded />
      {/if}

      {#if activeSection === 'general'}
        <section class="overflow-hidden rounded-md border border-border bg-surface-2/30">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-zinc-200">Title language</h2>
            <p class="mt-0.5 text-xs text-zinc-500">Choose the preferred title shown throughout the app.</p>
          </div>
          <div class="px-4 py-3">
            <div class="inline-flex items-center rounded-lg bg-zinc-900/90 p-1 shadow-inner shadow-black/40" role="group" aria-label="Title language">
              {#each (['english', 'romaji', 'native'] as TitleLanguage[]) as lang}
                <button
                  class="rounded-md px-3 py-1.5 text-sm font-medium transition-all
                    {s.titleLanguage === lang
                      ? 'bg-accent text-white shadow-sm shadow-black/40'
                      : 'text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-300'}"
                  onclick={() => updateSettings({ titleLanguage: lang })}
                >{lang.charAt(0).toUpperCase() + lang.slice(1)}</button>
              {/each}
            </div>
          </div>
        </section>
      {/if}

      {#if activeSection === 'data'}
        <section class="overflow-hidden rounded-md border border-border bg-surface-2/30">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-zinc-200">Library sync</h2>
            <p class="mt-0.5 text-xs text-zinc-500">Choose which release states are refreshed from their sources.</p>
          </div>
          <div class="grid gap-px bg-border sm:grid-cols-3">
            {#each (['airing', 'upcoming', 'hiatus'] as const) as key}
              <label class="flex cursor-pointer items-center gap-2 bg-[#111113] px-4 py-3">
                <input type="checkbox" class="accent-[var(--accent)]" checked={s.syncFilters[key]}
                  onchange={e => updateSettings({ syncFilters: { ...s.syncFilters, [key]: (e.target as HTMLInputElement).checked } })}
                />
                <span class="text-sm capitalize text-zinc-300">{key}</span>
              </label>
            {/each}
          </div>
        </section>

        <section class="mt-4 overflow-hidden rounded-md border border-border bg-surface-2/30">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-zinc-200">Local data</h2>
            <p class="mt-0.5 text-xs text-zinc-500">Your library is stored locally in SQLite. Backups contain library and tracking data.</p>
          </div>
          <div class="flex items-center gap-3 border-b border-border px-4 py-3">
            <span class="text-xs text-zinc-500">Storage</span>
            <span class="min-w-0 flex-1 truncate text-right font-mono text-xs text-zinc-400">{fs.fileName || 'No file open'}</span>
          </div>
          <div class="flex flex-wrap gap-2 px-4 py-3">
            <button
              class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              onclick={handleSaveCopy}
            >Save backup</button>
            <button
              class="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
              onclick={() => importInput?.click()}
            >Import version 2 backup…</button>
            <input class="hidden" bind:this={importInput} type="file" accept="application/json,.json" onchange={previewImport} />
          </div>
    {#if migrationPreview}
      <div class="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 space-y-2 text-sm">
        <p class="font-medium text-amber-200">Review version 2 import</p>
        <p class="text-xs text-zinc-400">
          {migrationPreview.report.media} media · {migrationPreview.report.episodes} episodes · {migrationPreview.report.libraryEntries} library entries · {migrationPreview.report.collections} collections · {migrationPreview.report.series} series
        </p>
        <p class="text-xs text-zinc-400">
          {migrationPreview.report.existingWatchEvents + migrationPreview.report.watchEventsCreated} watch events ({migrationPreview.report.watchEventsCreated} created from watched episodes) · {migrationPreview.report.skippedEpisodes} skipped episodes · {migrationPreview.report.providerLinksPreserved} provider identities preserved
        </p>
        {#each migrationPreview.report.warnings as warning}<p class="text-xs text-amber-300">{warning}</p>{/each}
        {#if migrationPreview.report.conflicts.length}
          <p class="text-xs text-amber-300 font-medium">{migrationPreview.report.conflicts.length} conflict{migrationPreview.report.conflicts.length === 1 ? '' : 's'} preserved for review:</p>
          {#each migrationPreview.report.conflicts as conflict}<p class="text-xs text-amber-300">{conflict}</p>{/each}
        {/if}
        <p class="text-xs text-zinc-500">This replaces the current library only after the entire backup passes validation and is written successfully.</p>
        <div class="flex gap-2"><button class="px-3 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-xs font-semibold disabled:opacity-50" onclick={confirmImport} disabled={importing}>{importing ? 'Importing…' : 'Import backup'}</button><button class="px-3 py-1.5 rounded-lg border border-border text-xs text-zinc-300" onclick={() => { migrationPreview = null; if (importInput) importInput.value = ''; }}>Cancel</button></div>
      </div>
    {/if}
    {#if migrationError}<p class="text-sm text-red-400">{migrationError}</p>{/if}
    {#if importResult}
      <p class="text-sm {importResult.includes('!') ? 'text-green-400' : 'text-red-400'}">{importResult}</p>
    {/if}
        </section>
      {/if}
    </div>
  </div>
</div>
