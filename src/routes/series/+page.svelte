<script lang="ts">
  import { base } from '$app/paths';
  import { appData, createSeries } from '$lib/store.svelte.js';
  import { getTitle } from '$lib/utils.js';
  import type { Media } from '$lib/types.js';

  let newName = $state('');
  let creating = $state(false);

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createSeries(name);
    newName = '';
  }

  interface SeriesItem {
    id: number;
    name: string;
    originalName: string | null;
    notes: string | null;
    cover: Media | null;
    mediaCount: number;
  }

  const seriesList = $derived<SeriesItem[]>(
    appData.series.map(s => {
      const entries = appData.seriesEntries.filter(e => e.seriesId === s.id);
      const cover = s.coverMediaId
        ? appData.media.find(m => m.id === s.coverMediaId)
        : appData.media.find(m => entries.some(e => e.mediaId === m.id));
      return { id: s.id, name: s.name, originalName: s.originalName, notes: s.notes, cover: cover ?? null, mediaCount: entries.length };
    })
  );
</script>

<div class="p-4 md:p-6 space-y-6">
  <h1 class="text-xl font-bold text-white">Series</h1>

  <!-- Create form -->
  <form
    class="flex gap-3"
    onsubmit={e => { e.preventDefault(); handleCreate(); }}
  >
    <input
      class="flex-1 bg-surface-2 border border-border rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors"
      placeholder="New series name…"
      bind:value={newName}
    />
    <button
      class="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-50"
      style="background:var(--accent)"
      type="submit"
      disabled={!newName.trim()}
    >Create</button>
  </form>

  <!-- Series list -->
  {#if seriesList.length === 0}
    <div class="text-center py-16 text-zinc-500">
      <p class="text-lg mb-1">No series yet</p>
      <p class="text-sm">Create one to group related anime together.</p>
    </div>
  {:else}
    <div class="grid gap-3">
      {#each seriesList as s (s.id)}
        <a
          href="{base}/series/{s.id}"
          class="flex gap-3 p-3 rounded-xl bg-surface border border-border hover:border-zinc-600 transition-colors group"
        >
          <!-- Thumbnail -->
          <div class="w-14 h-20 rounded-lg overflow-hidden bg-zinc-800 shrink-0">
            {#if s.cover?.coverImageMedium}
              <img src={s.cover.coverImageMedium} alt={s.name} class="w-full h-full object-cover" loading="lazy" />
            {:else}
              <div class="w-full h-full flex items-center justify-center text-zinc-600 text-2xl">◈</div>
            {/if}
          </div>

          <!-- Info -->
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm text-white group-hover:text-accent transition-colors">{s.name}</p>
            {#if s.originalName}
              <p class="text-xs text-zinc-500 truncate">{s.originalName}</p>
            {/if}
            <p class="text-xs text-zinc-500 mt-1">{s.mediaCount} anime</p>
            {#if s.notes}
              <p class="text-xs text-zinc-500 mt-1 line-clamp-2">{s.notes}</p>
            {/if}
          </div>

          <span class="self-center text-zinc-600 group-hover:text-zinc-400 transition-colors">→</span>
        </a>
      {/each}
    </div>
  {/if}
</div>
