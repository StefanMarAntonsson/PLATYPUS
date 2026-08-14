<script lang="ts">
  import {
    RELEASES_URL,
    appUpdate,
    dismissAvailableUpdate,
    installAppUpdate,
    updateProgressPercent,
  } from '$lib/app-update.svelte.js';
  import { openExternalUrl } from '$lib/external-links.js';
  import { appData } from '$lib/store.svelte.js';

  const progress = $derived(updateProgressPercent());
  const visible = $derived(
    (appUpdate.status === 'available' && appUpdate.dismissedVersion !== appUpdate.availableVersion)
      || appUpdate.status === 'downloading'
      || appUpdate.status === 'installing',
  );

  function openRelease(): void {
    void openExternalUrl(RELEASES_URL, appData.settings.externalBrowser);
  }
</script>

{#if visible}
  <aside
    class="fixed bottom-4 right-4 z-[85] w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-lg border border-amber-700/50 bg-surface/95 shadow-2xl backdrop-blur"
    aria-live="polite"
    aria-label="Application update"
  >
    <div class="border-b border-border px-4 py-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-zinc-100">
            {appUpdate.status === 'downloading'
              ? 'Downloading update…'
              : appUpdate.status === 'installing'
                ? 'Installing update…'
                : `PLATYPUS ${appUpdate.availableVersion} is available`}
          </p>
          {#if appUpdate.status === 'available'}
            <p class="mt-1 text-xs text-zinc-400">
              You are running version {appUpdate.currentVersion}.
              {appUpdate.canSelfUpdate
                ? 'The signed update can be installed in place.'
                : 'Download the new Debian package and install it through APT.'}
            </p>
          {/if}
        </div>
        {#if appUpdate.status === 'available'}
          <button
            class="-mr-1 -mt-1 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
            title="Remind me later"
            aria-label="Dismiss update"
            onclick={dismissAvailableUpdate}
          >×</button>
        {/if}
      </div>
    </div>

    {#if appUpdate.status === 'downloading' || appUpdate.status === 'installing'}
      <div class="px-4 py-3">
        <div class="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            class="h-full rounded-full bg-accent transition-[width]"
            class:animate-pulse={progress === null || appUpdate.status === 'installing'}
            style:width={appUpdate.status === 'installing' ? '100%' : progress === null ? '35%' : `${progress}%`}
          ></div>
        </div>
        <p class="mt-2 text-xs text-zinc-500">
          {appUpdate.status === 'installing'
            ? 'Saving your library before PLATYPUS restarts.'
            : progress === null
              ? 'Downloading signed AppImage…'
              : `${progress}% downloaded`}
        </p>
      </div>
    {:else}
      <div class="flex flex-wrap gap-2 px-4 py-3">
        {#if appUpdate.canSelfUpdate}
          <button
            class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            onclick={() => void installAppUpdate()}
          >Install and restart</button>
        {:else}
          <button
            class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            onclick={openRelease}
          >Open GitHub release</button>
        {/if}
        <button
          class="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          onclick={dismissAvailableUpdate}
        >Later</button>
      </div>
    {/if}
  </aside>
{/if}
