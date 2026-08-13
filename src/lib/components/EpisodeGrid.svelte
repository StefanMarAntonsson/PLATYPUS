<script lang="ts">
  import type { Episode } from '$lib/types.js';
  import { appData, cycleEpisodeState, markAllWatched, clearAllWatched } from '$lib/store.svelte.js';

  interface Props { mediaId: number }
  let { mediaId }: Props = $props();

  const episodes = $derived(
    appData.episodes.filter(e => e.mediaId === mediaId).sort((a, b) => a.number - b.number)
  );
  const watched = $derived(episodes.filter(e => e.watched).length);
  const aired = $derived(episodes.filter(e => e.aired).length);

  function btnClass(ep: Episode): string {
    const base = 'w-10 h-10 rounded text-xs font-medium border transition-all select-none ';
    const schedule = ep.aired ? '' : 'opacity-60 border-dashed ';
    if (ep.watched) return base + schedule + 'border-accent text-accent bg-accent/20 hover:bg-accent/30';
    if (ep.skipped) return base + schedule + 'border-zinc-600 text-zinc-500 bg-zinc-800/50 hover:border-zinc-400';
    let extra = '';
    if (ep.isFiller) extra = 'border-orange-500/60 ';
    else if (ep.isRecap) extra = 'border-dashed border-blue-500/60 ';
    else extra = 'border-zinc-700 ';
    return base + schedule + extra + 'text-zinc-300 bg-zinc-900/50 hover:border-zinc-400 hover:bg-zinc-800';
  }
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between text-sm">
    <span class="text-zinc-400">{watched} watched · {aired}/{episodes.length} aired</span>
    <div class="flex gap-2">
      <button
        class="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
        onclick={() => markAllWatched(mediaId)}
      >Mark all watched</button>
      <button
        class="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
        onclick={() => clearAllWatched(mediaId)}
      >Clear all</button>
    </div>
  </div>

  <div class="flex flex-wrap gap-1.5">
    {#each episodes as ep (ep.id)}
      <button
        class={btnClass(ep)}
        onclick={() => cycleEpisodeState(ep.id)}
        title="Ep {ep.number}{ep.title ? `: ${ep.title}` : ''}{ep.isFiller ? ' [Filler]' : ''}{ep.isRecap ? ' [Recap]' : ''}"
      >{ep.number}</button>
    {/each}
    {#if !episodes.length}
      <p class="text-sm text-zinc-600">No episodes synced.</p>
    {/if}
  </div>

  <!-- Legend -->
  {#if episodes.some(e => e.isFiller || e.isRecap)}
    <div class="flex gap-3 text-xs text-zinc-500 pt-1">
      <span class="flex items-center gap-1">
        <span class="w-3 h-3 rounded border border-orange-500/60 inline-block"></span> Filler
      </span>
      <span class="flex items-center gap-1">
        <span class="w-3 h-3 rounded border border-dashed border-blue-500/60 inline-block"></span> Recap
      </span>
    </div>
  {/if}
</div>
