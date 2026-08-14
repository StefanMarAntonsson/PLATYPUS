<script lang="ts">
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { base } from '$app/paths';
  import type { CollectionFilter, SortOption, Media, LibraryEntry } from '$lib/types.js';
  import { appData, fs, mediaWatchEvents, removeFromLibrary, setMovieWatched, updateSettings } from '$lib/store.svelte.js';
  import { getTitle, formatLabel, seasonLabel, progressPercent, findStreamingLink, streamingIconUrl, streamingSiteFromUrl, formatAirDate, formatCountdown, isOnBreak, timeAgo } from '$lib/utils.js';
  import { syncMedia, syncAiringLibrary } from '$lib/api/sync.js';
  import EpisodeTable from '$lib/components/EpisodeTable.svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import CollectionSuggestDialog from '$lib/components/CollectionSuggestDialog.svelte';
  import { openExternalUrl } from '$lib/external-links.js';
  import { virtualGridWindow } from '$lib/virtual-grid.js';
  import { filterLibraryItemsForView } from '$lib/library-view.js';

  interface Props {
    view?: 'library' | 'watchlist';
  }

  let { view = 'watchlist' }: Props = $props();

  function handleExternalLink(event: MouseEvent, url: string, stopPropagation = false) {
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    void openExternalUrl(url, appData.settings.externalBrowser);
  }

  const isWatchlist = $derived(view === 'watchlist');
  const pageTitle = $derived(isWatchlist ? 'Watchlist' : 'Library');

  const FILTER_LABELS: Record<CollectionFilter, string> = {
    WATCHING: 'Watching', AIRING: 'Airing', PLANNED: 'Planned', COMPLETED: 'Completed',
  };
  const WATCHLIST_FILTERS: CollectionFilter[] = ['WATCHING', 'PLANNED'];

  const STATUS_ORDER: Record<string, number> = { WATCHING: 0, PLAN_TO_WATCH: 1, COMPLETED: 2 };

  let activeFilters = $state<CollectionFilter[]>([]);
  let sortBy = $state<SortOption>('default');

  // Use untrack so this only fires when fs.status changes, not on every settings mutation.
  // Without untrack, writing lastSyncedAt (or any setting) would reset the user's manual
  // filter selections back to the saved defaults.
  $effect(() => {
    if (fs.status === 'ready') {
      activeFilters = isWatchlist ? ['WATCHING'] : [];
      sortBy = isWatchlist ? 'name_asc' : untrack(() => appData.settings.defaultSort);
    }
  });
  let searchText = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let collectTarget = $state<number | null>(null);
  let expandedId = $state<number | null>(null);
  let newestFirst = $state(true);
  let syncing = $state<number | null>(null);
  let syncResult = $state<{ id: number; msg: string; ok: boolean } | null>(null);
  let removeTarget = $state<number | null>(null);

  let bulkSyncing = $state(false);
  let bulkDone = $state(0);
  let bulkTotal = $state(0);
  let bulkAbortCtrl = $state<AbortController | null>(null);

  const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

  async function handleBulkSync() {
    if (bulkSyncing) return;
    const ctrl = new AbortController();
    bulkAbortCtrl = ctrl;
    bulkSyncing = true;
    bulkDone = 0;
    bulkTotal = 0;
    await syncAiringLibrary(ctrl.signal, (done, total) => {
      bulkDone = done;
      bulkTotal = total;
    });
    if (!ctrl.signal.aborted) {
      updateSettings({ lastSyncedAt: Date.now() });
    }
    bulkSyncing = false;
    bulkAbortCtrl = null;
  }

  $effect(() => {
    if (!appData.settings.autoSync || fs.status !== 'ready') return;

    const maybeSync = () => {
      const last = untrack(() => appData.settings.lastSyncedAt);
      if (!last || Date.now() - last >= AUTO_SYNC_INTERVAL_MS) {
        handleBulkSync();
      }
    };

    maybeSync();
    const timer = setInterval(maybeSync, AUTO_SYNC_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      bulkAbortCtrl?.abort();
      bulkAbortCtrl = null;
      bulkSyncing = false;
    };
  });

  interface LibraryItem { media: Media; entry: typeof appData.library[0] }

  const allItems = $derived.by<LibraryItem[]>(() =>
    filterLibraryItemsForView(appData.library
      .map(entry => ({ entry, media: appData.media.find(m => m.id === entry.mediaId) }))
      .filter((x): x is LibraryItem => !!x.media), view)
  );

  function matchesFilter(item: LibraryItem, f: CollectionFilter): boolean {
    if (f === 'WATCHING')  return item.entry.status === 'WATCHING' || item.entry.status === 'REWATCHING';
    if (f === 'AIRING')    return item.media.status === 'RELEASING';
    if (f === 'PLANNED')   return item.entry.status === 'PLAN_TO_WATCH';
    if (f === 'COMPLETED') return item.entry.status === 'COMPLETED';
    return false;
  }

  const searchedItems = $derived.by<LibraryItem[]>(() => {
    const q = searchText.toLowerCase().trim();
    return q
      ? allItems.filter(x => getTitle(x.media, appData.settings.titleLanguage).toLowerCase().includes(q))
      : allItems;
  });

  const items = $derived.by<LibraryItem[]>(() => {
    let list = searchedItems;
    if (activeFilters.length) list = list.filter(x => activeFilters.some(f => matchesFilter(x, f)));
    switch (sortBy) {
      case 'name_asc':  list = [...list].sort((a, b) => getTitle(a.media, appData.settings.titleLanguage).localeCompare(getTitle(b.media, appData.settings.titleLanguage))); break;
      case 'name_desc': list = [...list].sort((a, b) => getTitle(b.media, appData.settings.titleLanguage).localeCompare(getTitle(a.media, appData.settings.titleLanguage))); break;
      case 'status':    list = [...list].sort((a, b) => (STATUS_ORDER[a.entry.status] ?? 9) - (STATUS_ORDER[b.entry.status] ?? 9)); break;
      case 'progress': {
        list = [...list].sort((a, b) => {
          const aEps = appData.episodes.filter(e => e.mediaId === a.media.id);
          const bEps = appData.episodes.filter(e => e.mediaId === b.media.id);
          const aPct = progressPercent(aEps.filter(e => e.watched || e.skipped).length, aEps.filter(e => e.aired).length);
          const bPct = progressPercent(bEps.filter(e => e.watched || e.skipped).length, bEps.filter(e => e.aired).length);
          return bPct - aPct;
        });
        break;
      }
      case 'airing_day': {
        list = [...list].sort((a, b) => {
          const aDay = a.media.nextAiringAt != null ? new Date(a.media.nextAiringAt).getDay() : 7;
          const bDay = b.media.nextAiringAt != null ? new Date(b.media.nextAiringAt).getDay() : 7;
          return aDay - bDay;
        });
        break;
      }
      default: list = [...list].sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
    }
    return list;
  });

  // Watchlist tabs filter the poster grid without hiding the independent Up Next strip.
  const airingItems = $derived((isWatchlist ? searchedItems : items).filter(x => x.media.status === 'RELEASING'));
  const gridItems = $derived(items);

  // Rotate the schedule around the local day so Up Next always starts with today.
  // Date.getDay() is 0=Sun..6=Sat.
  const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let todayIndex = $state(new Date().getDay());
  const WEEKDAYS = $derived(Array.from({ length: 7 }, (_, offset) => {
    const index = (todayIndex + offset) % 7;
    return { label: WEEKDAY_LABELS[index], index };
  }));

  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const refreshAtMidnight = () => {
      const now = new Date();
      todayIndex = now.getDay();
      const tomorrow = new Date(now);
      tomorrow.setHours(24, 0, 0, 0);
      timer = setTimeout(refreshAtMidnight, tomorrow.getTime() - now.getTime() + 1000);
    };

    refreshAtMidnight();
    return () => clearTimeout(timer);
  });

  function localAiringTime(timestamp: number): number {
    const date = new Date(timestamp);
    return date.getHours() * 60 * 60 * 1000
      + date.getMinutes() * 60 * 1000
      + date.getSeconds() * 1000
      + date.getMilliseconds();
  }

  const airingByDay = $derived.by(() => {
    const dated = airingItems.filter(x => x.media.nextAiringAt != null);
    return WEEKDAYS.map(d => ({
      ...d,
      isToday: d.index === todayIndex,
      shows: dated
        .filter(x => new Date(x.media.nextAiringAt as number).getDay() === d.index)
        .sort((a, b) => {
          const aTimestamp = a.media.nextAiringAt as number;
          const bTimestamp = b.media.nextAiringAt as number;
          return localAiringTime(aTimestamp) - localAiringTime(bTimestamp)
            || aTimestamp - bTimestamp;
        }),
    }));
  });

  // RELEASING shows without a known next-air date; shown/hidden via a persisted toggle.
  const tbaItems = $derived(airingItems.filter(x => x.media.nextAiringAt == null));
  const showTba = $derived(appData.settings.showTba ?? true);

  const filterCounts = $derived.by(() => {
    const counts = {} as Record<CollectionFilter, number>;
    for (const f of appData.settings.filterOrder) {
      counts[f] = allItems.filter(x => matchesFilter(x, f)).length;
    }
    return counts;
  });

  const unwatchedAired = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const ep of appData.episodes) {
      if (ep.aired && !ep.watched && !ep.skipped) {
        counts.set(ep.mediaId, (counts.get(ep.mediaId) ?? 0) + 1);
      }
    }
    return counts;
  });

  // Per-media episode tallies computed in a single pass, so each card is O(1)
  // instead of filtering the whole episode list (which lagged with a big library).
  const mediaStats = $derived.by(() => {
    const stats = new Map<number, { done: number; count: number }>();
    for (const ep of appData.episodes) {
      const s = stats.get(ep.mediaId) ?? { done: 0, count: 0 };
      s.count++;
      if (ep.watched || ep.skipped) s.done++;
      stats.set(ep.mediaId, s);
    }
    return stats;
  });

  const expandedItem = $derived(expandedId !== null ? allItems.find(x => x.media.id === expandedId) : null);

  const expandedEps = $derived(expandedId !== null ? appData.episodes.filter(e => e.mediaId === expandedId) : []);
  const expandedWatched = $derived(expandedEps.filter(e => e.watched || e.skipped).length);
  const expandedAired = $derived(expandedEps.filter(e => e.aired).length);
  const expandedTotal = $derived(expandedItem ? (expandedItem.media.totalEpisodes ?? null) : null);
  const expandedIsMovie = $derived(
    expandedItem
      ? (expandedItem.media.kind ?? (expandedItem.media.format === 'MOVIE' ? 'movie' : 'series')) === 'movie'
      : false,
  );
  const expandedMovieWatched = $derived(
    expandedItem
      ? mediaWatchEvents(expandedItem.media.id).some(event => event.episodeId === null)
      : false,
  );

  // Episode changes can move a title between these two views. Do not leave a
  // panel open for a title that has just left the current filtered collection.
  $effect(() => {
    if (expandedId === null) return;
    const entry = appData.library.find(item => item.mediaId === expandedId);
    const belongsToView = entry
      && (isWatchlist ? entry.status !== 'COMPLETED' : entry.status === 'COMPLETED');
    if (!belongsToView) expandedId = null;
  });

  function selectWatchlistFilter(f: CollectionFilter) {
    activeFilters = [f];
  }

  function toggleExpand(id: number) {
    expandedId = expandedId === id ? null : id;
    newestFirst = true;
  }

  $effect(() => {
    if (expandedId === null) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') expandedId = null;
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  });

  $effect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput?.focus();
      }
    };

    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  });

  async function handleSync(mediaId: number) {
    syncing = mediaId;
    const r = await syncMedia(mediaId);
    syncing = null;
    syncResult = { id: mediaId, msg: r.message ?? (r.status === 'success' ? 'Synced!' : 'Up to date'), ok: r.status !== 'error' };
    setTimeout(() => syncResult = null, 3000);
  }

  const lang = $derived(appData.settings.titleLanguage);
  const LIBRARY_GRID_GAP = 16;
  const LIBRARY_OVERSCAN_ROWS = 2;
  let libraryScroller = $state<HTMLElement | null>(null);
  let libraryGrid = $state<HTMLElement | null>(null);
  let libraryColumnCount = $state(1);
  let libraryRowHeight = $state(300);
  let libraryScrollTop = $state(0);
  let libraryViewportHeight = $state(800);

  $effect(() => {
    if (isWatchlist || !libraryScroller || !libraryGrid) return;

    const update = () => {
      libraryViewportHeight = libraryScroller!.clientHeight;
      libraryColumnCount = Math.max(
        1,
        getComputedStyle(libraryGrid!).gridTemplateColumns.split(' ').filter(Boolean).length,
      );
      const firstCard = libraryGrid!.firstElementChild as HTMLElement | null;
      const measuredHeight = firstCard?.getBoundingClientRect().height ?? 0;
      if (measuredHeight > 0) libraryRowHeight = measuredHeight;
    };

    const frame = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(libraryScroller);
    ro.observe(libraryGrid);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  });

  const libraryWindow = $derived(virtualGridWindow({
    itemCount: gridItems.length,
    columnCount: libraryColumnCount,
    rowHeight: libraryRowHeight,
    rowGap: LIBRARY_GRID_GAP,
    scrollTop: libraryScrollTop,
    viewportHeight: libraryViewportHeight,
    overscanRows: LIBRARY_OVERSCAN_ROWS,
  }));
  const visibleLibraryItems = $derived(
    gridItems.slice(libraryWindow.startIndex, libraryWindow.endIndex),
  );

  // Filtering and sorting produce a different row map, so return to its beginning.
  $effect(() => {
    void gridItems;
    if (isWatchlist || !libraryScroller) return;
    libraryScroller.scrollTop = 0;
    libraryScrollTop = 0;
  });

  function handleLibraryScroll(event: Event) {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const nextScrollTop = event.currentTarget.scrollTop;
    const nextWindow = virtualGridWindow({
      itemCount: gridItems.length,
      columnCount: libraryColumnCount,
      rowHeight: libraryRowHeight,
      rowGap: LIBRARY_GRID_GAP,
      scrollTop: nextScrollTop,
      viewportHeight: libraryViewportHeight,
      overscanRows: LIBRARY_OVERSCAN_ROWS,
    });

    // Avoid reconciling the keyed card list for every pixel of a scroll gesture.
    if (nextWindow.startIndex !== libraryWindow.startIndex) {
      libraryScrollTop = nextScrollTop;
    }
  }
</script>

<svelte:head>
  <title>{pageTitle} · PLATYPUS</title>
</svelte:head>

<ConfirmDialog
  open={removeTarget !== null}
  title="Remove from library"
  message="Remove this item from your library? Its metadata and watch history will remain available if you add it again."
  confirmLabel="Remove"
  onconfirm={() => { if (removeTarget) { removeFromLibrary(removeTarget); if (expandedId === removeTarget) expandedId = null; removeTarget = null; } }}
  oncancel={() => removeTarget = null}
/>

<div class="flex h-full min-h-0 flex-col">
  {#if isWatchlist}
    <div class="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 md:px-6">
      <div class="inline-flex shrink-0 items-center rounded-lg bg-zinc-900/90 p-1 shadow-inner shadow-black/40" role="group" aria-label="Watchlist view">
        {#each WATCHLIST_FILTERS as f}
          <button
            class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all
              {activeFilters.length === 1 && activeFilters[0] === f
                ? 'bg-accent text-white shadow-sm shadow-black/40'
                : 'text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-300'}"
            aria-pressed={activeFilters.length === 1 && activeFilters[0] === f}
            onclick={() => selectWatchlistFilter(f)}
          >
            {FILTER_LABELS[f]}
            <span class="rounded px-1.5 py-0.5 text-[10px] {activeFilters.length === 1 && activeFilters[0] === f ? 'bg-black/25 text-white/80' : 'bg-black/30 text-zinc-400'}">{filterCounts[f]}</span>
          </button>
        {/each}
      </div>

      <label class="relative min-w-56 flex-1 lg:mx-auto lg:max-w-2xl">
        <span class="sr-only">Search your watchlist</span>
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35m1.35-5.4a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
        </svg>
        <input
          class="w-full rounded-md border border-border bg-surface-2/70 py-2 pl-10 pr-16 text-sm text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          type="search"
          placeholder="Search your watchlist…"
          bind:this={searchInput}
          bind:value={searchText}
        />
        <kbd class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">Ctrl K</kbd>
      </label>

      <div class="ml-auto flex items-center gap-2">
        {#if fs.status === 'ready'}
          <button
            class="flex items-center gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
            onclick={handleBulkSync}
            disabled={bulkSyncing}
          >
            <span class="inline-block text-base {bulkSyncing ? 'animate-spin' : ''}">↻</span>
            {#if bulkSyncing && bulkTotal > 0}
              Syncing {bulkDone}/{bulkTotal}…
            {:else if bulkSyncing}
              Syncing…
            {:else if appData.settings.lastSyncedAt}
              Synced {timeAgo(appData.settings.lastSyncedAt)}
            {:else}
              Sync airing
            {/if}
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex shrink-0 items-center justify-center px-4 py-3 md:px-6">
      <label class="relative w-full min-w-56 lg:max-w-2xl">
        <span class="sr-only">Search your library</span>
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35m1.35-5.4a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
        </svg>
      <input
          class="w-full rounded-md border border-border bg-surface-2/70 py-2 pl-10 pr-16 text-sm text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          type="search"
          placeholder="Search your library…"
          bind:this={searchInput}
          bind:value={searchText}
        />
        <kbd class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">Ctrl K</kbd>
      </label>
    </div>
  {/if}

  <!-- Reusable library card -->
  {#snippet card(media: Media, entry: LibraryEntry)}
    {@const onBreak = media.status === 'RELEASING' && isOnBreak(media.nextAiringAt)}
    <div
      class="group relative rounded-xl overflow-hidden bg-surface-2 border transition-colors cursor-pointer flex flex-col
        {expandedId === media.id ? 'border-accent/50' : 'border-border hover:border-zinc-600'}"
      role="button"
      tabindex="0"
      onclick={() => toggleExpand(media.id)}
      onkeydown={e => (e.key === 'Enter' || e.key === ' ') && toggleExpand(media.id)}
    >
      <!-- Image section -->
      <div class="aspect-[2/3] relative overflow-hidden bg-zinc-800">
        {#if media.coverImageLarge}
          <img
            src={media.coverImageLarge}
            alt={getTitle(media, lang)}
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        {:else}
          <div class="w-full h-full flex items-center justify-center text-zinc-600 text-3xl">◈</div>
        {/if}

        <!-- Airing / Upcoming banner -->
        {#if media.status === 'RELEASING'}
          {@const behind = unwatchedAired.get(media.id) ?? 0}
          <div class="absolute top-0 left-0 right-0 flex flex-col">
            <div class="relative flex items-center justify-center gap-1.5 py-1 bg-cyan-900/70 backdrop-blur-sm text-cyan-300 text-[10px] uppercase tracking-widest font-semibold">
              <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>Airing
              {#if behind > 0}
                <span class="absolute right-2">+{behind}</span>
              {/if}
            </div>
            {#if media.nextAiringAt != null}
              <div class="flex items-center justify-center py-0.5 bg-cyan-950/80 backdrop-blur-sm text-cyan-300/80 text-[9px] uppercase tracking-wider font-medium">
                {formatCountdown(media.nextAiringAt)}
              </div>
            {/if}
          </div>
        {:else if media.status === 'NOT_YET_RELEASED'}
          <div class="absolute top-0 left-0 right-0 flex items-center justify-center py-1 bg-orange-900/70 backdrop-blur-sm text-orange-300 text-[10px] uppercase tracking-widest font-semibold">
            Upcoming
          </div>
        {/if}

        <!-- On-break marker: overlaid at the bottom of the fixed-height cover
             (just above the status banner) so it never changes card height. -->
        {#if onBreak}
          <div class="absolute bottom-0 left-0 right-0 py-0.5 bg-amber-900/80 backdrop-blur-sm text-amber-300 text-[9px] uppercase tracking-widest font-semibold text-center">
            On break
          </div>
        {/if}
      </div>

      <!-- Info section (solid background below image) -->
      <div class="flex flex-col flex-1">
        <!-- Status banner -->
        <div class="px-2.5 py-1
          {entry.status === 'COMPLETED' ? 'bg-green-900/40 text-green-400' :
           entry.status === 'WATCHING' || entry.status === 'REWATCHING' ? 'bg-cyan-900/40 text-cyan-400' :
           'bg-zinc-800/60 text-zinc-500'}">
          <p class="text-[9px] uppercase tracking-wider font-semibold">
            {entry.status === 'COMPLETED' ? '✓ Done' :
             entry.status === 'WATCHING' ? 'Watching' :
             entry.status === 'REWATCHING' ? 'Rewatching' :
             'Planned'}
          </p>
        </div>
        <!-- Title -->
        <div class="flex h-12 px-2.5 py-2">
          <p class="text-xs font-bold text-white line-clamp-2 leading-tight flex-1">{getTitle(media, lang)}</p>
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet watchlistCard(media: Media, entry: LibraryEntry)}
    {@const stats = mediaStats.get(media.id) ?? { done: 0, count: 0 }}
    {@const watched = stats.done}
    {@const total = media.totalEpisodes ?? stats.count}
    {@const percent = progressPercent(watched, total)}
    {@const unwatched = media.status === 'RELEASING' ? (unwatchedAired.get(media.id) ?? 0) : 0}
    {@const airsToday = media.status === 'RELEASING'
      && media.nextAiringAt != null
      && new Date(media.nextAiringAt).getDay() === todayIndex}
    {@const streamingUrl = appData.settings.watchButton.enabled ? findStreamingLink(media.externalLinks, appData.settings.watchButton.site) : null}
    {@const streamingIcon = streamingUrl ? streamingIconUrl(streamingUrl) : null}
    {@const streamingSite = streamingUrl ? streamingSiteFromUrl(streamingUrl) : null}
    {@const badge = media.status === 'RELEASING'
      ? 'AIRING'
      : entry.status === 'PLAN_TO_WATCH'
        ? 'PLANNED'
        : entry.status === 'REWATCHING'
          ? 'REWATCHING'
          : entry.status}
    <div
      class="group relative flex cursor-pointer flex-col overflow-hidden rounded-md border bg-surface-2/55 transition-colors
        {airsToday
          ? 'border-green-500 ring-1 ring-green-500/70 shadow-[0_0_8px_rgba(34,197,94,0.25)] hover:border-green-400'
          : 'border-border hover:border-zinc-500'}"
      role="button"
      tabindex="0"
      onclick={() => toggleExpand(media.id)}
      onkeydown={event => (event.key === 'Enter' || event.key === ' ') && toggleExpand(media.id)}
    >
      <div class="relative aspect-[4/5] overflow-hidden bg-zinc-900">
        {#if media.coverImageLarge}
          <img
            src={media.coverImageLarge}
            alt={getTitle(media, lang)}
            class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        {:else}
          <div class="flex h-full w-full items-center justify-center text-3xl text-zinc-700">◈</div>
        {/if}
        {#if badge !== 'WATCHING'}
          <span class="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide backdrop-blur-sm
            {badge === 'AIRING' ? 'bg-red-700/90 text-red-50' :
             badge === 'PLANNED' ? 'bg-zinc-600/90 text-zinc-100' :
             badge === 'PAUSED' ? 'bg-amber-700/90 text-amber-50' :
             badge === 'DROPPED' ? 'bg-red-800/90 text-red-100' :
             'bg-accent/90 text-white'}">{badge === 'AIRING' ? `• ${badge}` : badge}</span>
        {/if}
      </div>
      <div class="flex min-h-24 flex-1 flex-col p-2">
        <h3 class="line-clamp-2 text-[11px] font-semibold leading-4 text-zinc-100">{getTitle(media, lang)}</h3>
        <div class="mt-auto pt-3">
          <div class="mb-1.5 flex items-center justify-between text-[10px] text-zinc-400">
            <span>
              {watched}/{total}{#if unwatched > 0}{' '}<span class="text-green-400">(+{unwatched})</span>{/if}
            </span>
            <span>{percent}%</span>
          </div>
          <div class="h-1 overflow-hidden rounded-full bg-zinc-700/80">
            <div class="h-full rounded-full bg-accent" style={`width:${percent}%`}></div>
          </div>
        </div>
      </div>
      {#if streamingUrl}
        <div class="pointer-events-none absolute inset-0 z-20 flex flex-col opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <a
            href={streamingUrl}
            target="_blank"
            rel="noopener"
            class="flex min-h-0 flex-1 items-center justify-center bg-zinc-950/75 text-zinc-200 backdrop-blur-sm transition-colors hover:bg-accent/80 hover:text-white focus-visible:bg-accent/80 focus-visible:text-white focus-visible:outline-none"
            aria-label="Watch {getTitle(media, lang)} and open its sidebar"
            title="Watch now"
            onclick={event => {
              expandedId = media.id;
              newestFirst = true;
              handleExternalLink(event, streamingUrl, true);
            }}
          >
            {#if streamingIcon}
              <img src={streamingIcon} alt="" class="h-12 w-12 object-contain" aria-hidden="true" />
            {:else}
              <span class="text-xs font-bold uppercase tracking-wider">{streamingSite ?? 'Watch'}</span>
            {/if}
          </a>
          <button
            type="button"
            class="flex min-h-0 flex-1 items-center justify-center border-t border-border bg-surface-2/75 text-zinc-300 backdrop-blur-sm transition-colors hover:bg-zinc-800/80 hover:text-white focus-visible:bg-zinc-800/80 focus-visible:text-white focus-visible:outline-none"
            aria-label="Open sidebar for {getTitle(media, lang)}"
            title="Open sidebar"
            onclick={event => {
              event.stopPropagation();
              expandedId = media.id;
              newestFirst = true;
            }}
          >
            <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
            </svg>
          </button>
        </div>
      {/if}
    </div>
  {/snippet}

  <!-- Content -->
  {#if allItems.length === 0}
    <div class="text-center py-20 text-zinc-500">
      <p class="mb-2">{isWatchlist ? 'Your watchlist is empty.' : 'You have no completed titles yet.'}</p>
      <a href="{base}/search" class="text-accent underline text-sm">Search sources for media</a>.
    </div>
  {:else if items.length === 0 && !isWatchlist}
    <div class="text-center py-20 text-zinc-500">
      <p class="text-sm">No media match your filters.</p>
    </div>
  {:else}
    {#if isWatchlist}
      <div class="flex min-h-0 flex-1 flex-col gap-6">
        {#if activeFilters.length === 1 && activeFilters[0] === 'WATCHING'}
          <section class="shrink-0">
            {#if tbaItems.length > 0}
              <div class="mb-2 flex justify-end">
                <button
                  class="rounded border px-2 py-0.5 text-[10px] transition-colors
                    {showTba ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-zinc-500 hover:text-zinc-300'}"
                  onclick={() => updateSettings({ showTba: !showTba })}
                >{showTba ? 'Hide' : 'Show'} TBA ({tbaItems.length})</button>
              </div>
            {/if}
            <div class="overflow-x-auto pb-2">
              <div class="flex w-full items-stretch overflow-hidden border-y border-border bg-surface-2/35 {showTba && tbaItems.length > 0 ? 'min-w-[84rem]' : 'min-w-[74rem]'}">
                <div class="flex w-8 shrink-0 flex-col border-r border-border" aria-hidden="true">
                  <div class="h-7 shrink-0 border-b border-border bg-surface-2/70"></div>
                  <div class="min-h-0 flex-1"></div>
                </div>
                {#each airingByDay as day (day.index)}
                  <div class="min-w-0 flex-1 border-r border-border last:border-r-0 {day.isToday ? 'bg-accent/[0.03]' : ''}">
                    <div class="flex h-7 items-center justify-center border-b border-border bg-surface-2/70 px-2 text-center text-[10px] font-bold tracking-wider {day.isToday ? 'bg-accent/10 text-accent' : 'text-zinc-500'}">{day.label}</div>
                  {#each day.shows as { media, entry } (entry.id)}
                    <button
                      class="flex w-full gap-2 border-b border-border/60 p-2 text-left last:border-b-0 hover:bg-zinc-800/60"
                      onclick={() => toggleExpand(media.id)}
                    >
                      {#if media.coverImageMedium ?? media.coverImageLarge}
                        <img src={media.coverImageMedium ?? media.coverImageLarge ?? ''} alt="" class="h-16 w-12 shrink-0 rounded-sm object-cover" loading="lazy" />
                      {:else}
                        <span class="flex h-16 w-12 shrink-0 items-center justify-center rounded-sm bg-zinc-800 text-zinc-600">◈</span>
                      {/if}
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="line-clamp-2 text-[11px] font-medium leading-4 text-zinc-200">{getTitle(media, lang)}</span>
                        <span class="mt-auto flex items-end justify-between gap-2 text-[10px] text-zinc-500">
                          <span>{media.nextAiringEpisode !== null ? `Ep ${media.nextAiringEpisode}` : 'Episode TBA'}</span>
                          <span class="whitespace-nowrap {day.isToday ? 'text-accent' : ''}">{formatCountdown(media.nextAiringAt)}</span>
                        </span>
                      </span>
                    </button>
                  {/each}
                  </div>
                {/each}
                {#if showTba && tbaItems.length > 0}
                  <div class="min-w-0 flex-1 border-r border-border last:border-r-0">
                    <div class="flex h-7 items-center justify-center border-b border-border bg-surface-2/70 px-2 text-center text-[10px] font-bold tracking-wider text-zinc-500">TBA</div>
                    {#each tbaItems as { media, entry } (entry.id)}
                      <button class="flex w-full gap-2 border-b border-border/60 p-2 text-left last:border-b-0 hover:bg-zinc-800/60" onclick={() => toggleExpand(media.id)}>
                        {#if media.coverImageMedium ?? media.coverImageLarge}
                          <img src={media.coverImageMedium ?? media.coverImageLarge ?? ''} alt="" class="h-16 w-12 shrink-0 rounded-sm object-cover" loading="lazy" />
                        {:else}
                          <span class="flex h-16 w-12 shrink-0 items-center justify-center rounded-sm bg-zinc-800 text-zinc-600">◈</span>
                        {/if}
                        <span class="line-clamp-2 text-[11px] font-medium leading-4 text-zinc-200">{getTitle(media, lang)}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
                <div class="flex w-8 shrink-0 flex-col" aria-hidden="true">
                  <div class="h-7 shrink-0 border-b border-border bg-surface-2/70"></div>
                  <div class="min-h-0 flex-1"></div>
                </div>
              </div>
            </div>
          </section>
        {/if}

        <section class="flex min-h-0 flex-1 flex-col gap-3 px-4 md:px-6 {activeFilters.length === 1 && activeFilters[0] === 'PLANNED' ? 'pt-5' : ''}">
          {#if items.length === 0}
            <div class="rounded-md border border-dashed border-border py-16 text-center text-sm text-zinc-500">No titles match this filter.</div>
          {:else}
            <div class="min-h-0 flex-1 overflow-y-auto">
              <div class="grid grid-cols-[repeat(auto-fill,minmax(135px,1fr))] gap-3 pb-6">
                {#each gridItems as { media, entry } (entry.id)}
                  {@render watchlistCard(media, entry)}
                {/each}
              </div>
            </div>
          {/if}
        </section>
      </div>
    {:else}
      <!-- Completed library grid -->
      <div
        class="min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-6"
        bind:this={libraryScroller}
        onscroll={handleLibraryScroll}
      >
        {#if gridItems.length > 0}
          <div
            class="relative"
            style="height:{libraryWindow.totalHeight}px"
          >
            <div
              class="absolute inset-x-0 top-0 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4"
              style="transform:translateY({libraryWindow.offsetTop}px)"
              bind:this={libraryGrid}
            >
              {#each visibleLibraryItems as { media, entry } (entry.id)}
                {@render card(media, entry)}
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Expanded episode panel -->
  {#if expandedItem}
    {@const m = expandedItem.media}
    {@const expandedStreamingUrl = findStreamingLink(m.externalLinks, appData.settings.watchButton.site)}
    <button
      class="fixed inset-0 z-[55] cursor-default bg-black/50"
      aria-label="Close episode sidebar"
      onclick={() => expandedId = null}
      transition:fade={{ duration: 150 }}
    ></button>
    <div
      class="fixed inset-y-0 right-0 z-[60] w-full space-y-4 overflow-y-auto border-l border-accent/30 bg-surface p-5 shadow-2xl sm:w-[32rem]"
      role="dialog"
      aria-modal="true"
      aria-label={`Episodes for ${getTitle(m, lang)}`}
      transition:fly={{ x: 480, duration: 200 }}
    >
      <!-- Header -->
      <div class="flex flex-col gap-4">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-bold text-white">{getTitle(m, lang)}</h2>
            {#if appData.settings.watchButton.enabled && expandedStreamingUrl}
              <a
                href={expandedStreamingUrl}
                target="_blank"
                rel="noopener"
                class="text-xs px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 transition-colors whitespace-nowrap"
                onclick={event => handleExternalLink(event, expandedStreamingUrl)}
              >▶ Watch</a>
            {/if}
          </div>
          {#if m.titleNative && m.titleNative !== getTitle(m, lang)}
            <p class="text-sm text-zinc-400">{m.titleNative}</p>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#if syncResult?.id === m.id}
            <span class="text-xs {syncResult.ok ? 'text-green-400' : 'text-red-400'}">{syncResult.msg}</span>
          {/if}
          <button
            class="text-xs px-3 py-1.5 rounded bg-surface-2 border border-border hover:border-zinc-500 text-zinc-300 transition-colors"
            onclick={() => collectTarget = m.id}
          >+ Collection</button>
          <button
            class="text-xs px-3 py-1.5 rounded bg-surface-2 border border-border hover:border-zinc-500 text-zinc-300 transition-colors flex items-center gap-1.5"
            onclick={() => handleSync(m.id)}
            disabled={syncing !== null}
          ><span class="{syncing === m.id ? 'animate-spin' : ''}">↻</span> Sync</button>
          {#if expandedIsMovie}
            <button
              class="text-xs px-3 py-1.5 rounded border transition-colors {expandedMovieWatched ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500'}"
              onclick={() => setMovieWatched(m.id, !expandedMovieWatched)}
            >{expandedMovieWatched ? '✓ Watched' : 'Mark watched'}</button>
          {/if}
          <a
            href="{base}/{m.id < 0 ? 'media' : 'anime'}/{m.id}"
            class="text-xs px-3 py-1.5 rounded bg-surface-2 border border-border hover:border-zinc-500 text-zinc-300 transition-colors"
          >Details</a>
          <button
            class="text-xs px-3 py-1.5 rounded bg-red-900/30 border border-red-800/40 hover:border-red-600 text-red-400 transition-colors"
            onclick={() => removeTarget = m.id}
          >Remove</button>
          <button
            class="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
            onclick={() => expandedId = null}
          >×</button>
        </div>
      </div>

      {#if !expandedIsMovie}
        <!-- Progress bar -->
        <ProgressBar watched={expandedWatched} aired={expandedAired} total={expandedTotal} showLabel />

        <!-- Sort toggle -->
        <div class="flex items-center gap-2">
          <button
            class="text-xs px-3 py-1 rounded border transition-colors
              {!newestFirst ? 'border-accent/40 text-accent bg-accent/10' : 'border-border text-zinc-400 hover:border-zinc-500'}"
            onclick={() => newestFirst = false}
          >Oldest first</button>
          <button
            class="text-xs px-3 py-1 rounded border transition-colors
              {newestFirst ? 'border-accent/40 text-accent bg-accent/10' : 'border-border text-zinc-400 hover:border-zinc-500'}"
            onclick={() => newestFirst = true}
          >Newest first</button>
        </div>

        <!-- Episode table -->
        <EpisodeTable mediaList={[m]} {newestFirst} limitLongShows />
      {/if}

      <!-- Upcoming -->
      {#if m.nextAiringEpisode !== null}
        <div class="border-t border-border pt-4 text-sm text-zinc-400">
          <span class="text-accent">Ep {m.nextAiringEpisode}</span>
          <span class="ml-2">airs {formatAirDate(m.nextAiringAt)}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if collectTarget !== null}
  <CollectionSuggestDialog mediaId={collectTarget} onclose={() => collectTarget = null} />
{/if}
