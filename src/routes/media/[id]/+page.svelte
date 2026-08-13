<script lang="ts">
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { appData, createManualEpisode, getLibraryEntry, mediaWatchEvents, setEpisodeState, setMovieWatched, updateLibraryEntry, updateManualMedia } from '$lib/store.svelte.js';

  const id = $derived(Number(page.params.id));
  const media = $derived(appData.media.find((item) => item.id === id));
  const entry = $derived(getLibraryEntry(id));
  const isMovie = $derived((media?.kind ?? 'series') === 'movie');
  const events = $derived(mediaWatchEvents(id));
  const watched = $derived(events.some((event) => event.episodeId === null));
  const episodes = $derived(appData.episodes.filter((episode) => episode.mediaId === id));
  const completedEpisodes = $derived(episodes.filter((episode) => episode.watched || episode.skipped).length);
  const isManual = $derived(media?.id < 0);
  let editing = $state(false);
  let title = $state('');
  let year = $state('');
  let totalEpisodes = $state('');
  let description = $state('');
  let editError = $state('');

  function beginEdit() {
    if (!media) return;
    title = media.titleEnglish ?? media.titleRomaji;
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
    if (!isMovie && parsedEpisodes !== null && (!Number.isInteger(parsedEpisodes) || parsedEpisodes < episodes.length)) { editError = `Episode count must be at least ${episodes.length}.`; return; }
    updateManualMedia(media.id, { title, year: parsedYear, totalEpisodes: parsedEpisodes, description });
    editing = false;
  }

  function addEpisode() { if (media) createManualEpisode(media.id); }
</script>

{#if !media}
  <div class="p-6"><p class="text-zinc-400">Media item not found.</p><a class="mt-3 inline-block text-sm text-accent" href="{base}/library">Back to library</a></div>
{:else}
  <div class="max-w-3xl p-4 md:p-6 space-y-6">
    <a class="text-sm text-zinc-500 hover:text-white" href="{base}/library">← Library</a>
    <div class="rounded-xl border border-border bg-surface p-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-wider text-accent">{isMovie ? 'Movie' : 'Series'} · Local library</p>
          <h1 class="mt-1 text-2xl font-bold text-white">{media.titleEnglish ?? media.titleRomaji}</h1>
          {#if media.seasonYear}<p class="mt-1 text-sm text-zinc-500">{media.seasonYear}</p>{/if}
        </div>
        {#if isMovie}
          <button class="rounded-lg px-4 py-2 text-sm font-medium {watched ? 'border border-accent/40 bg-accent/10 text-accent' : 'bg-accent text-white'}" onclick={() => setMovieWatched(media.id, !watched)}>
            {watched ? '✓ Watched' : 'Mark watched'}
          </button>
        {/if}
      </div>
      {#if isManual && !editing}
        <button class="mt-4 text-sm text-accent hover:text-white" onclick={beginEdit}>Edit details</button>
      {/if}
      {#if editing}
        <form class="mt-5 space-y-3 border-t border-border pt-4" onsubmit={(event) => { event.preventDefault(); saveEdit(); }}>
          <input class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Title" bind:value={title} />
          <div class="grid grid-cols-2 gap-3">
            <input class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Release year" type="number" min="1800" max="3000" placeholder="Year" bind:value={year} />
            {#if !isMovie}<input class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Episodes" type="number" min={episodes.length} placeholder="Episodes" bind:value={totalEpisodes} />{/if}
          </div>
          <textarea class="min-h-20 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" aria-label="Notes" bind:value={description}></textarea>
          {#if editError}<p class="text-sm text-red-400">{editError}</p>{/if}
          <div class="flex justify-end gap-3"><button class="text-sm text-zinc-400" type="button" onclick={() => editing = false}>Cancel</button><button class="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">Save changes</button></div>
        </form>
      {:else if media.description}<p class="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{media.description}</p>{/if}
    </div>

    {#if !isMovie}
      <div class="rounded-xl border border-border bg-surface p-5">
        <h2 class="font-semibold text-white">Progress</h2>
        <p class="mt-2 text-sm text-zinc-400">{completedEpisodes} watched{media.totalEpisodes !== null ? ` of ${media.totalEpisodes} episodes` : ' episodes'}</p>
        <div class="mt-4 space-y-2">
          {#each episodes as episode (episode.id)}
            <button class="flex w-full items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-left text-sm hover:bg-zinc-800" onclick={() => setEpisodeState(episode.id, episode.watched ? 'unwatched' : 'watched')}>
              <span class="text-zinc-300">Episode {episode.number}{episode.title ? ` · ${episode.title}` : ''}</span><span class={episode.watched ? 'text-accent' : 'text-zinc-600'}>{episode.watched ? '✓ Watched' : 'Mark watched'}</span>
            </button>
          {/each}
          {#if isManual}<button class="text-sm text-accent hover:text-white" onclick={addEpisode}>+ Add episode</button>{/if}
          {#if episodes.length === 0}<p class="text-xs text-zinc-600">Add episodes to track individual watches, or keep this as a title-level series entry.</p>{/if}
        </div>
      </div>
    {/if}

    {#if entry}
      <div class="rounded-xl border border-border bg-surface p-5">
        <h2 class="font-semibold text-white">Library status</h2>
        <select class="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none focus:border-accent" value={entry.status} onchange={(event) => updateLibraryEntry(entry.id, { status: event.currentTarget.value as typeof entry.status })}>
          <option value="PLAN_TO_WATCH">Planned</option><option value="WATCHING">Watching</option><option value="PAUSED">Paused</option><option value="DROPPED">Dropped</option><option value="COMPLETED">Completed</option>
        </select>
      </div>
    {/if}

    {#if events.length}
      <div><h2 class="mb-2 font-semibold text-white">Watch history</h2><p class="text-sm text-zinc-500">{events.length} recorded watch {events.length === 1 ? 'event' : 'events'}.</p></div>
    {/if}
  </div>
{/if}
