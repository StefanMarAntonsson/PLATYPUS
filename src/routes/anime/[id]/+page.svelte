<script lang="ts">
  import { page } from '$app/state';
  import {
    appData, addToLibrary, updateLibraryEntry, removeFromLibrary,
    getLibraryEntry, getMedia,
  } from '$lib/store.svelte.js';
  import { syncMedia } from '$lib/api/sync.js';
  import { getTitle, formatLabel, statusLabel, seasonLabel, formatAirDate, findStreamingLink } from '$lib/utils.js';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import EpisodeGrid from '$lib/components/EpisodeGrid.svelte';
  import { openExternalUrl } from '$lib/external-links.js';

  const mediaId = $derived(Number(page.params.id));
  const media = $derived(getMedia(mediaId));
  const libEntry = $derived(getLibraryEntry(mediaId));
  const inLibrary = $derived(!!libEntry);

  let syncing = $state(false);
  let syncMsg = $state('');
  let editScore = $state(false);
  let scoreInput = $state(0);

  $effect(() => {
    if (libEntry?.score !== undefined) scoreInput = libEntry.score ?? 0;
  });

  $effect(() => {
    if (!media) {
      syncing = true;
      syncMedia(mediaId).then(r => {
        syncing = false;
        if (r.status === 'error') syncMsg = r.message ?? 'Sync failed';
      });
    }
  });

  async function handleSync() {
    syncing = true; syncMsg = '';
    const r = await syncMedia(mediaId);
    syncMsg = r.status === 'success' ? 'Synced!' : r.message ?? 'Error';
    syncing = false;
    setTimeout(() => syncMsg = '', 3000);
  }

  function handleAddToLibrary() {
    addToLibrary(mediaId, 'PLAN_TO_WATCH');
  }

  function handleSaveScore() {
    if (!libEntry) return;
    updateLibraryEntry(libEntry.id, { score: scoreInput || null });
    editScore = false;
  }

  function handleRemove() {
    removeFromLibrary(mediaId);
  }

  function handleExternalLink(event: MouseEvent, url: string) {
    event.preventDefault();
    void openExternalUrl(url, appData.settings.externalBrowser);
  }

  const lang = $derived(appData.settings.titleLanguage);
  const streamingLink = $derived(media ? findStreamingLink(media.externalLinks, appData.settings.watchButton.site) : null);
</script>

<div>
  {#if syncing && !media}
    <div class="flex items-center justify-center h-64 text-zinc-500">
      <span class="animate-pulse">Loading anime data…</span>
    </div>
  {:else if !media}
    <div class="p-6 text-zinc-500">
      Anime not found. <button class="text-accent underline" onclick={handleSync}>Try syncing</button>
    </div>
  {:else}
    <!-- Banner -->
    {#if media.bannerImage}
      <div class="relative h-40 md:h-52 overflow-hidden">
        <img src={media.bannerImage} alt="" class="w-full h-full object-cover" loading="lazy" />
        <div class="absolute inset-0 bg-gradient-to-t from-[#09090b] via-[#09090b]/40 to-transparent"></div>
      </div>
    {/if}

    <div class="p-4 md:p-6">
      <div class="flex flex-col md:flex-row gap-6">
        <!-- Left sidebar -->
        <aside class="md:w-52 shrink-0 space-y-4">
          <!-- Cover -->
          <div class="relative rounded-xl overflow-hidden bg-zinc-800 aspect-[2/3] {media.bannerImage ? 'md:-mt-20' : ''}">
            {#if media.coverImageLarge}
              <img src={media.coverImageLarge} alt={getTitle(media, lang)} class="w-full h-full object-cover" loading="lazy" />
            {:else}
              <div class="w-full h-full flex items-center justify-center text-zinc-600 text-5xl">◈</div>
            {/if}
          </div>

          <!-- Library button -->
          {#if !inLibrary}
            <button
              class="w-full py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
              style="background:var(--accent)"
              onclick={handleAddToLibrary}
            >+ Add to Library</button>
          {:else}
            <div class="space-y-2">
              <div class="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-zinc-400 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full shrink-0
                  {libEntry?.status === 'WATCHING' ? 'bg-blue-400' :
                   libEntry?.status === 'COMPLETED' ? 'bg-green-400' : 'bg-zinc-500'}"></span>
                {libEntry?.status === 'WATCHING' ? 'Watching' :
                 libEntry?.status === 'COMPLETED' ? 'Completed' : 'Plan to watch'}
              </div>
              <button
                class="w-full py-2 rounded-lg text-xs text-red-400 hover:text-red-300 bg-red-900/10 hover:bg-red-900/20 border border-red-900/20 transition-colors"
                onclick={handleRemove}
              >Remove from library</button>
            </div>
          {/if}

          <!-- Score -->
          {#if inLibrary}
            <div class="space-y-1">
              <p class="text-xs text-zinc-500">Score</p>
              {#if editScore}
                <div class="flex gap-1">
                  <input
                    type="number" min="0" max="10" step="0.5"
                    class="flex-1 bg-surface-2 border border-border rounded px-2 py-1 text-sm text-zinc-200 outline-none"
                    bind:value={scoreInput}
                  />
                  <button class="text-xs px-2 py-1 rounded text-white" style="background:var(--accent)" onclick={handleSaveScore}>✓</button>
                  <button class="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400" onclick={() => editScore = false}>×</button>
                </div>
              {:else}
                <button
                  class="text-sm font-medium {libEntry?.score ? 'text-yellow-400' : 'text-zinc-600'} hover:text-yellow-300 transition-colors"
                  onclick={() => editScore = true}
                >
                  {libEntry?.score ? `★ ${libEntry.score.toFixed(1)}` : '— Rate'}
                </button>
              {/if}
            </div>
          {/if}

          <!-- Metadata -->
          <div class="space-y-1.5 text-xs text-zinc-400">
            <div><span class="text-zinc-600">Format</span> · {formatLabel(media.format)}</div>
            <div><span class="text-zinc-600">Status</span> · {statusLabel(media.status)}</div>
            {#if media.season || media.seasonYear}
              <div><span class="text-zinc-600">Season</span> · {seasonLabel(media.season, media.seasonYear)}</div>
            {/if}
            {#if media.totalEpisodes}
              <div><span class="text-zinc-600">Episodes</span> · {media.totalEpisodes}</div>
            {/if}
            {#if media.nextAiringAt}
              <div><span class="text-zinc-600">Next ep</span> · {formatAirDate(media.nextAiringAt)}</div>
            {/if}
          </div>

          <!-- Genres -->
          {#if media.genres?.length}
            <div class="flex flex-wrap gap-1">
              {#each media.genres as g}
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{g}</span>
              {/each}
            </div>
          {/if}

          <!-- Streaming links -->
          {#if media.externalLinks?.some(l => l.type === 'STREAMING')}
            <div class="space-y-1">
              <p class="text-xs text-zinc-500">Watch on</p>
              {#each (media.externalLinks ?? []).filter(l => l.type === 'STREAMING').slice(0, 4) as link}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener"
                  class="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  onclick={event => handleExternalLink(event, link.url)}
                >
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800">{link.site}</span>
                </a>
              {/each}
            </div>
          {/if}

          <!-- Sync -->
          <div class="space-y-1">
            <button
              class="w-full py-2 rounded-lg text-xs bg-surface-2 border border-border hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center gap-1.5"
              onclick={handleSync}
              disabled={syncing}
            >
              <span class="{syncing ? 'animate-spin' : ''}">↻</span> Force Sync
            </button>
            {#if syncMsg}
              <p class="text-xs text-center {syncMsg.includes('!') ? 'text-green-400' : 'text-red-400'}">{syncMsg}</p>
            {/if}
          </div>
        </aside>

        <!-- Right main content -->
        <div class="flex-1 min-w-0 space-y-4">
          <!-- Title -->
          <div>
            <h1 class="text-2xl font-bold text-white">{getTitle(media, lang)}</h1>
            {#if media.titleNative && media.titleNative !== getTitle(media, lang)}
              <p class="text-sm text-zinc-400 mt-0.5">{media.titleNative}</p>
            {/if}
            {#if inLibrary && libEntry}
              <div class="mt-2">
                <StatusBadge status={libEntry.status} />
              </div>
            {/if}
          </div>

          <!-- Description -->
          {#if media.description}
            <p class="whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{media.description}</p>
          {/if}

          <!-- Episodes -->
          {#if inLibrary}
            <div class="border-t border-border pt-4 space-y-3">
              <h2 class="font-semibold text-zinc-200">Episodes</h2>
              <EpisodeGrid {mediaId} />
            </div>
          {:else}
            <div class="border border-border rounded-xl p-6 text-center text-zinc-500 text-sm">
              <p class="mb-2">Add this anime to your library to track episodes.</p>
              <button
                class="text-sm px-4 py-2 rounded-xl text-white transition-colors"
                style="background:var(--accent)"
                onclick={handleAddToLibrary}
              >+ Add to Library</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
