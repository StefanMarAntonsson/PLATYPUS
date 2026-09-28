<script lang="ts">
  import type { Media, Episode } from '$lib/types.js';
  import {
    appData,
    toggleEpisodeWatched,
    toggleEpisodeSkipped,
    markAllWatched,
    skipAllEpisodes,
  } from '$lib/store.svelte.js';
  import { getTitle, formatAirDate } from '$lib/utils.js';

  interface Props {
    mediaList: Media[];
    newestFirst?: boolean;
    limitLongShows?: boolean;
    onContextMenu?: (e: MouseEvent, mediaId: number) => void;
  }
  let { mediaList, newestFirst = false, limitLongShows = false, onContextMenu }: Props = $props();

  // One pass over the library's episodes per render, grouped by title.
  const groups = $derived.by(() => {
    const ids = new Set(mediaList.map(media => media.id));
    const byMedia = new Map<number, Episode[]>();
    for (const episode of appData.episodes) {
      if (!ids.has(episode.mediaId)) continue;
      const list = byMedia.get(episode.mediaId);
      if (list) list.push(episode);
      else byMedia.set(episode.mediaId, [episode]);
    }
    return new Map([...ids].map(id => {
      const all = (byMedia.get(id) ?? []).sort((a, b) => a.number - b.number);
      let eps = limitLongShows && all.length > 100 ? all.slice(-50) : all;
      if (newestFirst) eps = [...eps].reverse();
      return [id, { eps, total: all.length, batch: batchStatus(all) }];
    }));
  });

  function batchStatus(episodes: Episode[]): 'all-watched' | 'all-skipped' | 'mixed' | 'none' {
    if (!episodes.length) return 'none';
    if (episodes.every(e => e.watched)) return 'all-watched';
    if (episodes.every(e => e.skipped)) return 'all-skipped';
    return 'mixed';
  }

  function epClass(ep: Episode): string {
    const schedule = ep.aired ? '' : 'opacity-60 border-dashed';
    if (ep.watched) return `bg-accent/20 border-accent/40 text-accent ${schedule}`;
    if (ep.skipped) return `bg-zinc-800/50 border-zinc-600 text-zinc-500 ${schedule}`;
    if (!ep.aired) return 'border-dashed border-zinc-800 bg-black/20 hover:border-zinc-600 hover:bg-zinc-900/40';
    return 'border-zinc-600/70 bg-zinc-900/60 hover:border-zinc-400 hover:bg-zinc-800/70';
  }

  const lang = $derived(appData.settings.titleLanguage);
</script>

<div class="space-y-6">
  {#each mediaList as media (media.id)}
    {@const group = groups.get(media.id)}
    {@const eps = group?.eps ?? []}
    {@const totalEpisodeCount = group?.total ?? 0}
    {@const batch = group?.batch ?? 'none'}
    <div>
      <!-- Group header -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="group"
        class="flex items-center justify-between py-2 px-1 border-b border-zinc-800 mb-2 group cursor-context-menu"
        oncontextmenu={e => { e.preventDefault(); onContextMenu?.(e, media.id); }}
      >
        <div class="flex items-center gap-2">
          {#if media.coverImageMedium}
            <img src={media.coverImageMedium} alt="" class="w-7 h-10 object-cover rounded" loading="lazy" />
          {/if}
          <div>
            <span class="font-medium text-sm text-white">{getTitle(media, lang)}</span>
            <div class="text-xs text-zinc-500">
              {media.format} · {limitLongShows && totalEpisodeCount > 100 ? `${eps.length} recent of ${totalEpisodeCount}` : totalEpisodeCount} eps
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          {#if batch === 'all-watched'}
            <span class="text-xs text-green-400">✓ All watched</span>
          {:else if batch === 'all-skipped'}
            <span class="text-xs text-zinc-500">— All skipped</span>
          {/if}
          <button
            class="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            onclick={() => markAllWatched(media.id)}
            title="Mark all watched"
          >✓ All</button>
          <button
            class="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
            onclick={() => skipAllEpisodes(media.id)}
            title="Skip all"
          >— Skip</button>
        </div>
      </div>

      <!-- Episode rows -->
      {#if eps.length}
        <div class="space-y-0.5">
          {#each eps as ep (ep.id)}
            <div
              class="flex items-center gap-3 px-2 py-1.5 rounded border {epClass(ep)} transition-all cursor-pointer text-sm"
              onclick={() => toggleEpisodeWatched(ep.id)}
              role="button"
              tabindex="0"
              aria-pressed={ep.watched}
              title={ep.watched ? 'Mark unwatched' : 'Mark watched'}
              onkeydown={e => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                toggleEpisodeWatched(ep.id);
              }}
            >
              <span class="w-12 text-right shrink-0 font-mono text-xs {ep.aired ? 'text-zinc-500' : 'text-zinc-700'}">
                {ep.seasonNumber !== null && ep.seasonNumber !== undefined && ep.sourceEpisodeNumber !== null && ep.sourceEpisodeNumber !== undefined
                  ? `S${ep.seasonNumber}E${ep.sourceEpisodeNumber}`
                  : ep.number}
              </span>
              <span class="flex-1 truncate {ep.aired ? 'text-zinc-300' : 'text-zinc-500'} {ep.watched ? 'text-white' : ''}">
                {ep.title ?? `Episode ${ep.number}`}
              </span>
              <div class="flex items-center gap-1 shrink-0">
                {#if ep.isFiller}
                  <span class="text-[10px] px-1 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">F</span>
                {/if}
                {#if ep.isRecap}
                  <span class="text-[10px] px-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 border-dashed">R</span>
                {/if}
                {#if !ep.aired}
                  <span class="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                    Upcoming
                  </span>
                {/if}
                <span class="text-[10px] text-zinc-400 w-32 text-right mr-3">
                  {formatAirDate(ep.airingAt)}
                </span>
                <button
                  class="w-5 h-5 rounded border flex items-center justify-center text-[10px] transition-colors shrink-0
                    {ep.watched ? 'bg-accent/30 border-accent text-accent' : 'border-zinc-600 text-zinc-600 hover:border-zinc-400'}"
                  onclick={e => { e.stopPropagation(); toggleEpisodeWatched(ep.id); }}
                  onkeydown={e => e.stopPropagation()}
                  title={ep.watched ? 'Mark unwatched' : 'Mark watched'}
                  aria-label="{ep.watched ? 'Mark unwatched' : 'Mark watched'}: episode {ep.number}"
                >✓</button>
                <button
                  class="w-5 h-5 rounded border flex items-center justify-center text-[10px] transition-colors shrink-0
                    {ep.skipped ? 'bg-zinc-700 border-zinc-500 text-zinc-400' : 'border-zinc-700 text-zinc-700 hover:border-zinc-500'}"
                  onclick={e => { e.stopPropagation(); toggleEpisodeSkipped(ep.id); }}
                  onkeydown={e => e.stopPropagation()}
                  title={ep.skipped ? 'Unskip' : 'Skip'}
                  aria-label="{ep.skipped ? 'Unskip' : 'Skip'}: episode {ep.number}"
                >—</button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-sm text-zinc-600 px-2 py-2">No episodes synced yet.</p>
      {/if}
    </div>
  {/each}
</div>
