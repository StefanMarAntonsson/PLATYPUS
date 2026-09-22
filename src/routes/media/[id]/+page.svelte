<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { LibraryStatus } from '$lib/types.js';
  import {
    appData, addToLibrary, createManualEpisode, getLibraryEntry, getMedia, mediaWatchEvents,
    removeFromLibrary, setMovieWatched, updateLibraryEntry, updateManualMedia,
  } from '$lib/store.svelte.js';
  import { canSyncMedia, syncMedia } from '$lib/api/sync.js';
  import {
    getTitle, formatLabel, statusLabel, seasonLabel, formatAirDate, isManualMedia, libraryStatusLabel,
  } from '$lib/utils.js';
  import EpisodeGrid from '$lib/components/EpisodeGrid.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { openExternalUrl } from '$lib/external-links.js';
  import { fadeInOnLoad } from '$lib/actions.js';

  const LIBRARY_STATUSES: LibraryStatus[] = ['PLAN_TO_WATCH', 'WATCHING', 'REWATCHING', 'PAUSED', 'DROPPED', 'COMPLETED'];

  const mediaId = $derived(Number(page.params.id));
  const media = $derived(getMedia(mediaId));
  const entry = $derived(getLibraryEntry(mediaId));
  const isMovie = $derived(media ? (media.kind ?? (media.format === 'MOVIE' ? 'movie' : 'series')) === 'movie' : false);
  const isManual = $derived(media ? isManualMedia(media) : false);
  const events = $derived(mediaWatchEvents(mediaId));
  const movieWatched = $derived(events.some(event => event.episodeId === null));
  const episodeCount = $derived(appData.episodes.filter(episode => episode.mediaId === mediaId).length);
  const sourceLabel = $derived(isManual ? 'Local library' : (media?.providerLinks?.[0]?.connectionName ?? 'Synced library'));
  const lang = $derived(appData.settings.titleLanguage);
  const streamingLinks = $derived((media?.externalLinks ?? []).filter(link => link.type === 'STREAMING').slice(0, 4));

  let confirmRemove = $state(false);
  let syncing = $state(false);
  let syncMessage = $state<{ text: string; ok: boolean } | null>(null);
  let editScore = $state(false);
  let scoreInput = $state(0);

  let editing = $state(false);
  let title = $state('');
  let year = $state('');
  let totalEpisodes = $state('');
  let description = $state('');
  let editError = $state('');

  function goBack() {
    if (history.length > 1) history.back();
    else void goto(`${base}/`);
  }

  async function handleSync() {
    syncing = true;
    syncMessage = null;
    const result = await syncMedia(mediaId);
    syncing = false;
    syncMessage = result.status === 'error'
      ? { text: result.message ?? 'Sync failed', ok: false }
      : { text: result.status === 'success' ? 'Synced' : 'Up to date', ok: true };
    setTimeout(() => syncMessage = null, 3000);
  }

  function beginScoreEdit() {
    scoreInput = entry?.score ?? 0;
    editScore = true;
  }

  function saveScore() {
    if (entry) updateLibraryEntry(entry.id, { score: scoreInput || null });
    editScore = false;
  }

  function beginEdit() {
    if (!media) return;
    title = getTitle(media, lang);
    year = media.seasonYear?.toString() ?? '';
    totalEpisodes = media.totalEpisodes?.toString() ?? '';
    description = media.description ?? '';
    editError = '';
    editing = true;
  }

  function saveEdit() {
    if (!media || !title.trim()) { editError = 'A title is required.'; return; }
    const parsedYear = year === '' ? null : Number(year);
    const parsedEpisodes = totalEpisodes === '' ? null : Number(totalEpisodes);
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1800 || parsedYear > 3000)) { editError = 'Enter a valid year.'; return; }
    if (!isMovie && parsedEpisodes !== null && (!Number.isInteger(parsedEpisodes) || parsedEpisodes < episodeCount)) { editError = `Episode count must be at least ${episodeCount}.`; return; }
    updateManualMedia(media.id, { title, year: parsedYear, totalEpisodes: parsedEpisodes, description });
    editing = false;
  }

  function handleExternalLink(event: MouseEvent, url: string) {
    event.preventDefault();
    void openExternalUrl(url, appData.settings.externalBrowser);
  }
</script>

<svelte:head>
  <title>{media ? getTitle(media, lang) : 'Not found'} · PLATYPUS</title>
</svelte:head>

<ConfirmDialog
  open={confirmRemove}
  title="Remove from library"
  message="Remove this item from your library? Its metadata and watch history will remain available if you add it again."
  confirmLabel="Remove"
  onconfirm={() => { removeFromLibrary(mediaId); confirmRemove = false; }}
  oncancel={() => confirmRemove = false}
/>

{#if !media}
  <div class="p-6">
    <p class="text-zinc-400">This title is not in your PLATYPUS library.</p>
    <button class="mt-3 text-sm text-accent hover:text-white" onclick={goBack}>← Back</button>
  </div>
{:else}
  {#if media.bannerImage}
    <div class="relative h-40 md:h-52 overflow-hidden">
      <img src={media.bannerImage} alt="" class="w-full h-full object-cover" loading="lazy" decoding="async" use:fadeInOnLoad />
      <div class="absolute inset-0 bg-gradient-to-t from-[#09090b] via-[#09090b]/40 to-transparent"></div>
      <button class="absolute left-4 top-4 rounded-md bg-black/70 px-2.5 py-1 text-sm text-zinc-200 hover:text-white md:left-6" onclick={goBack}>← Back</button>
    </div>
  {/if}

  <div class="p-4 md:p-6">
    {#if !media.bannerImage}
      <button class="mb-4 text-sm text-zinc-500 hover:text-white" onclick={goBack}>← Back</button>
    {/if}
    <div class="flex flex-col md:flex-row gap-6">
      <!-- Left column -->
      <aside class="md:w-52 shrink-0 space-y-4">
        <div class="relative rounded-xl overflow-hidden bg-zinc-800 aspect-[2/3] {media.bannerImage ? 'md:-mt-20' : ''}">
          {#if media.coverImageLarge}
            <img src={media.coverImageLarge} alt={getTitle(media, lang)} class="w-full h-full object-cover" decoding="async" use:fadeInOnLoad />
          {:else}
            <div class="w-full h-full flex items-center justify-center text-zinc-600 text-5xl">◈</div>
          {/if}
        </div>

        {#if !entry}
          <button
            class="w-full py-2.5 rounded-xl text-sm font-medium text-white bg-accent transition-colors"
            onclick={() => addToLibrary(mediaId, 'PLAN_TO_WATCH')}
          >+ Add to Library</button>
        {:else}
          <div class="space-y-2">
            <label class="block text-xs text-zinc-500">
              Library status
              <select
                class="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none [color-scheme:dark] focus:border-accent"
                value={entry.status}
                onchange={(event) => updateLibraryEntry(entry.id, { status: event.currentTarget.value as LibraryStatus })}
              >
                {#each LIBRARY_STATUSES as status}
                  <option value={status}>{libraryStatusLabel(status)}</option>
                {/each}
              </select>
            </label>
            <button
              class="w-full py-2 rounded-lg text-xs text-red-400 hover:text-red-300 bg-red-900/10 hover:bg-red-900/20 border border-red-900/20 transition-colors"
              onclick={() => confirmRemove = true}
            >Remove from library</button>
          </div>

          <div class="space-y-1">
            <p class="text-xs text-zinc-500">Score</p>
            {#if editScore}
              <form class="flex gap-1" onsubmit={(event) => { event.preventDefault(); saveScore(); }}>
                <input
                  type="number" min="0" max="10" step="0.5"
                  aria-label="Score out of 10"
                  class="flex-1 bg-surface-2 border border-border rounded px-2 py-1 text-sm text-zinc-200 outline-none"
                  bind:value={scoreInput}
                />
                <button type="submit" class="text-xs px-2 py-1 rounded text-white bg-accent" aria-label="Save score">✓</button>
                <button type="button" class="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400" aria-label="Cancel" onclick={() => editScore = false}>×</button>
              </form>
            {:else}
              <button
                class="text-sm font-medium {entry.score ? 'text-yellow-400' : 'text-zinc-600'} hover:text-yellow-300 transition-colors"
                onclick={beginScoreEdit}
              >{entry.score ? `★ ${entry.score.toFixed(1)}` : '— Rate'}</button>
            {/if}
          </div>
        {/if}

        <div class="space-y-1.5 text-xs text-zinc-400">
          <div><span class="text-zinc-600">Source</span> · {sourceLabel}</div>
          <div><span class="text-zinc-600">Format</span> · {isMovie ? 'Movie' : formatLabel(media.format)}</div>
          {#if !isManual}
            <div><span class="text-zinc-600">Status</span> · {statusLabel(media.status)}</div>
          {/if}
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

        {#if media.genres?.length}
          <div class="flex flex-wrap gap-1">
            {#each media.genres as genre}
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{genre}</span>
            {/each}
          </div>
        {/if}

        {#if streamingLinks.length}
          <div class="space-y-1">
            <p class="text-xs text-zinc-500">Watch on</p>
            {#each streamingLinks as link}
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

        {#if canSyncMedia(media)}
          <div class="space-y-1">
            <button
              class="w-full py-2 rounded-lg text-xs bg-surface-2 border border-border hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
              onclick={handleSync}
              disabled={syncing}
            >
              <span class={syncing ? 'animate-spin' : ''}>↻</span> Force Sync
            </button>
            {#if syncMessage}
              <p class="text-xs text-center {syncMessage.ok ? 'text-green-400' : 'text-red-400'}">{syncMessage.text}</p>
            {/if}
          </div>
        {/if}
      </aside>

      <!-- Main column -->
      <div class="flex-1 min-w-0 space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold text-white">{getTitle(media, lang)}</h1>
            {#if media.titleNative && media.titleNative !== getTitle(media, lang)}
              <p class="text-sm text-zinc-400 mt-0.5">{media.titleNative}</p>
            {/if}
          </div>
          {#if isMovie}
            <button
              class="shrink-0 rounded-lg px-4 py-2 text-sm font-medium {movieWatched ? 'border border-accent/40 bg-accent/10 text-accent' : 'bg-accent text-white'}"
              onclick={() => setMovieWatched(media.id, !movieWatched)}
            >{movieWatched ? '✓ Watched' : 'Mark watched'}</button>
          {/if}
        </div>

        {#if editing}
          <form class="space-y-3 rounded-xl border border-border bg-surface p-4" onsubmit={(event) => { event.preventDefault(); saveEdit(); }}>
            <input class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Title" bind:value={title} />
            <div class="grid grid-cols-2 gap-3">
              <input class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Release year" type="number" min="1800" max="3000" placeholder="Year" bind:value={year} />
              {#if !isMovie}<input class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Episodes" type="number" min={episodeCount} placeholder="Episodes" bind:value={totalEpisodes} />{/if}
            </div>
            <textarea class="min-h-20 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Notes" bind:value={description}></textarea>
            {#if editError}<p class="text-sm text-red-400">{editError}</p>{/if}
            <div class="flex justify-end gap-3">
              <button class="text-sm text-zinc-400" type="button" onclick={() => editing = false}>Cancel</button>
              <button class="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">Save changes</button>
            </div>
          </form>
        {:else}
          {#if media.description}
            <p class="whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{media.description}</p>
          {/if}
          {#if isManual}
            <button class="text-sm text-accent hover:text-white" onclick={beginEdit}>Edit details</button>
          {/if}
        {/if}

        {#if !isMovie}
          {#if entry}
            <div class="border-t border-border pt-4 space-y-3">
              <div class="flex items-center justify-between">
                <h2 class="font-semibold text-zinc-200">Episodes</h2>
                {#if isManual}
                  <button class="text-sm text-accent hover:text-white" onclick={() => createManualEpisode(media.id)}>+ Add episode</button>
                {/if}
              </div>
              <EpisodeGrid {mediaId} />
            </div>
          {:else}
            <div class="border border-border rounded-xl p-6 text-center text-zinc-500 text-sm">
              <p class="mb-2">Add this title to your library to track episodes.</p>
              <button
                class="text-sm px-4 py-2 rounded-xl text-white bg-accent transition-colors"
                onclick={() => addToLibrary(mediaId, 'PLAN_TO_WATCH')}
              >+ Add to Library</button>
            </div>
          {/if}
        {/if}

        {#if events.length}
          <p class="border-t border-border pt-4 text-sm text-zinc-500">
            {events.length} recorded watch {events.length === 1 ? 'event' : 'events'}.
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}
