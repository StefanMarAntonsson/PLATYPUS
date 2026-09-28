<script module lang="ts">
  type SidebarTab = 'episodes' | 'sync';
  type SyncItemState = 'queued' | 'syncing' | 'synced' | 'unchanged' | 'failed' | 'skipped' | 'cancelled';
  interface SyncLogItem {
    mediaId: number;
    title: string;
    state: SyncItemState;
    message?: string;
  }
  interface SyncRun {
    startedAt: number;
    finishedAt: number | null;
    cancelled: boolean;
    entries: SyncLogItem[];
  }
  // Where the list was scrolled, which filter was active, and which sidebar
  // was open, so coming back from a details page returns to the same place.
  let savedViewState: {
    scrollTop: number;
    expandedId: number | null;
    filter: 'WATCHING' | 'AIRING' | 'PLANNED' | 'CATCH_UP' | null;
    tab: SidebarTab;
  } = { scrollTop: 0, expandedId: null, filter: null, tab: 'episodes' };
  let savedSyncRun: SyncRun | null = null;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { base } from '$app/paths';
  import type { Media, LibraryEntry, Episode, LibraryLayout, LibrarySort } from '$lib/types.js';
  import { appData, fs, mediaWatchEvents, removeFromLibrary, setMovieWatched, updateLibraryEntry, updateSettings } from '$lib/store.svelte.js';
  import { getTitle, progressPercent, streamingIconUrl, formatAirDate, formatCountdown, timeAgo, isTypingTarget } from '$lib/utils.js';
  import { notify } from '$lib/notifications.svelte.js';
  import { canSyncMedia, syncMedia, syncAiringLibrary, type SyncItemEvent, type SyncResult } from '$lib/api/sync.js';
  import EpisodeTable from '$lib/components/EpisodeTable.svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { isWatchUrl, selectedWatchOption, watchButtonStyle, watchOptions } from '$lib/watch-destination.js';
  import { openExternalUrl } from '$lib/external-links.js';
  import { virtualGridWindow } from '$lib/virtual-grid.js';
  import { clock } from '$lib/clock.svelte.js';
  import { fadeInOnLoad } from '$lib/actions.js';
  import { airingState, catchUpDetails, isWatchingAndAiring, selectCatchUpItems, sortItems, weekdayFromToday, type CatchUpSort } from '$lib/library-view.js';

  function handleExternalLink(event: MouseEvent, url: string, stopPropagation = false) {
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    void openExternalUrl(url, appData.settings.externalBrowser);
  }

  type LibraryFilter = 'WATCHING' | 'AIRING' | 'PLANNED' | 'CATCH_UP';

  const FILTER_LABELS: Record<LibraryFilter, string> = {
    WATCHING: 'Watching', AIRING: 'Airing', PLANNED: 'Planned', CATCH_UP: 'Catch Up',
  };
  const LIBRARY_FILTERS: LibraryFilter[] = ['WATCHING', 'AIRING', 'PLANNED', 'CATCH_UP'];

  // No filter selected shows every title in the library.
  let activeFilter = $state<LibraryFilter | null>(untrack(() => savedViewState.filter));
  let catchUpSort = $state<CatchUpSort>('backlog');
  const layout = $derived<LibraryLayout>(appData.settings.libraryLayout ?? 'grid');
  const sortBy = $derived<LibrarySort>(appData.settings.librarySort ?? 'title');
  const sortDescending = $derived(appData.settings.librarySortDescending ?? false);

  // Each sort starts in the direction you most likely want: A–Z, soonest
  // episode first, and newest or most-watched first for everything else.
  const SORT_OPTIONS: { value: LibrarySort; label: string; descending: boolean }[] = [
    { value: 'title', label: 'Title', descending: false },
    { value: 'airing_day', label: 'Airing day', descending: false },
    { value: 'recently_aired', label: 'Recently aired', descending: true },
    { value: 'next_airing', label: 'Next episode', descending: false },
    { value: 'progress', label: 'Progress', descending: true },
    { value: 'updated', label: 'Recently updated', descending: true },
    { value: 'added', label: 'Date added', descending: true },
  ];
  const lang = $derived(appData.settings.titleLanguage);
  // Thumbnail, title, airing status, airing day, progress bar, percentage, episode count.
  const showWatchColumn = $derived(appData.settings.watchButton.enabled);
  const LIST_COLUMNS = $derived(showWatchColumn
    ? 'grid-cols-[1.75rem_minmax(0,1fr)_11rem_4.5rem_5rem_minmax(4rem,12rem)_2.75rem_5.5rem]'
    : 'grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_5rem_minmax(4rem,12rem)_2.75rem_5.5rem]');

  let searchText = $state('');
  const searching = $derived(searchText.trim().length > 0);
  const effectiveFilter = $derived(searching ? null : activeFilter);
  const isCatchUp = $derived(effectiveFilter === 'CATCH_UP');
  let searchInput = $state<HTMLInputElement | null>(null);
  let expandedId = $state<number | null>(untrack(() => savedViewState.expandedId));
  let customWatchName = $state('');
  let customWatchUrl = $state('');
  let editingCustomWatch = $state(false);
  let activeTab = $state<SidebarTab>(untrack(() => savedViewState.tab));
  let syncRun = $state<SyncRun | null>(untrack(() => savedSyncRun));
  let newestFirst = $state(true);
  let syncing = $state<number | null>(null);
  let removeTarget = $state<number | null>(null);

  let bulkSyncing = $state(false);
  let bulkDone = $state(0);
  let bulkTotal = $state(0);
  let bulkAbortCtrl = $state<AbortController | null>(null);

  const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;

  function setSyncRun(run: SyncRun) {
    syncRun = run;
    savedSyncRun = run;
  }

  function syncTitle(mediaId: number): string {
    const media = appData.media.find(item => item.id === mediaId);
    return media ? getTitle(media, lang) : `Title ${mediaId}`;
  }

  function updateSyncItem(mediaId: number, state: SyncItemState, message?: string) {
    if (!syncRun) return;
    const existing = syncRun.entries.find(entry => entry.mediaId === mediaId);
    const entry: SyncLogItem = { mediaId, title: existing?.title ?? syncTitle(mediaId), state, ...(message ? { message } : {}) };
    setSyncRun({ ...syncRun, entries: existing
      ? syncRun.entries.map(item => item.mediaId === mediaId ? entry : item)
      : [...syncRun.entries, entry] });
  }

  function syncItemMessage(result: SyncResult): string {
    if (result.status === 'error') return result.message ?? 'Sync failed';
    if (result.status === 'up-to-date') return result.message ?? 'No changes';
    const synced = result.added === undefined ? 'Metadata synced' : `${result.added} episode${result.added === 1 ? '' : 's'} synced`;
    return result.platformsAdded
      ? `${synced} · ${result.platformsAdded} new platform${result.platformsAdded === 1 ? '' : 's'}`
      : synced;
  }

  function recordSyncItem(event: SyncItemEvent) {
    if (event.state === 'queued' || event.state === 'syncing') {
      updateSyncItem(event.mediaId, event.state);
    } else if (event.state === 'skipped') {
      updateSyncItem(event.mediaId, 'skipped', event.message);
    } else if (event.result) {
      updateSyncItem(event.mediaId,
        event.result.status === 'error' ? 'failed' : event.result.status === 'up-to-date' ? 'unchanged' : 'synced',
        syncItemMessage(event.result));
    }
  }

  function finishSyncRun(cancelled: boolean) {
    if (!syncRun) return;
    setSyncRun({ ...syncRun, finishedAt: Date.now(), cancelled,
      entries: cancelled
        ? syncRun.entries.map(entry => entry.state === 'queued' || entry.state === 'syncing'
          ? { ...entry, state: 'cancelled' as const, message: 'Cancelled' } : entry)
        : syncRun.entries });
  }

  async function handleBulkSync(activateTab = true) {
    if (bulkSyncing || syncing !== null) return;
    const ctrl = new AbortController();
    setSyncRun({ startedAt: Date.now(), finishedAt: null, cancelled: false, entries: [] });
    if (activateTab) activeTab = 'sync';
    bulkAbortCtrl = ctrl;
    bulkSyncing = true;
    bulkDone = 0;
    bulkTotal = 0;
    try {
      await syncAiringLibrary(ctrl.signal, (done, total) => {
        bulkDone = done;
        bulkTotal = total;
      }, recordSyncItem);
      if (!ctrl.signal.aborted) updateSettings({ lastSyncedAt: Date.now() });
    } catch (error) {
      if (!ctrl.signal.aborted) notify('error', 'Sync failed', error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      finishSyncRun(ctrl.signal.aborted);
      bulkSyncing = false;
      bulkAbortCtrl = null;
    }
  }

  $effect(() => {
    if (!appData.settings.autoSync || fs.status !== 'ready') return;

    const maybeSync = () => {
      const last = untrack(() => appData.settings.lastSyncedAt);
      if (!last || Date.now() - last >= AUTO_SYNC_INTERVAL_MS) {
        void handleBulkSync(false);
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

  const mediaById = $derived(new Map(appData.media.map(m => [m.id, m])));

  const allItems = $derived.by<LibraryItem[]>(() =>
    appData.library
      .map(entry => ({ entry, media: mediaById.get(entry.mediaId) }))
      .filter((x): x is LibraryItem => !!x.media)
  );

  function isActive(entry: LibraryEntry): boolean {
    return entry.status === 'WATCHING' || entry.status === 'REWATCHING';
  }

  function matchesFilter(item: LibraryItem, f: LibraryFilter): boolean {
    if (f === 'WATCHING') return isActive(item.entry);
    if (f === 'AIRING') return isWatchingAndAiring(item.entry, item.media, mediaStats.get(item.media.id)?.lastAiredAt ?? null, clock.now);
    if (f === 'CATCH_UP') return isActive(item.entry) && (catchUpEpisodeDetails.get(item.media.id)?.count ?? 0) > 0;
    return item.entry.status === 'PLAN_TO_WATCH';
  }

  const searchedItems = $derived.by<LibraryItem[]>(() => {
    const q = searchText.toLowerCase().trim();
    return q
      ? allItems.filter(x => getTitle(x.media, appData.settings.titleLanguage).toLowerCase().includes(q))
      : allItems;
  });

  const catchUpEpisodeDetails = $derived(catchUpDetails(appData.episodes));

  const items = $derived.by<LibraryItem[]>(() => {
    if (effectiveFilter === 'CATCH_UP') {
      return selectCatchUpItems(searchedItems, catchUpEpisodeDetails, catchUpSort);
    }
    const filter = effectiveFilter;
    const list = filter ? searchedItems.filter(x => matchesFilter(x, filter)) : searchedItems;
    return sortItems(list, sortValue(sortBy), sortDescending, compareTitles);
  });

  const titleCollator = new Intl.Collator();
  function compareTitles(a: LibraryItem, b: LibraryItem): number {
    return titleCollator.compare(getTitle(a.media, lang), getTitle(b.media, lang));
  }

  /** The number each sort orders by; null sorts last in either direction. */
  function sortValue(sort: LibrarySort): ((item: LibraryItem) => number | null) | null {
    switch (sort) {
      case 'airing_day':     return item => airingWeekday(item.media) === null ? null : weekdayFromToday(item.media.nextAiringAt as number, todayIndex);
      case 'recently_aired': return item => mediaStats.get(item.media.id)?.lastAiredAt ?? null;
      case 'next_airing':    return item => item.media.status === 'RELEASING' ? item.media.nextAiringAt : null;
      case 'progress':       return item => itemProgress(item.media, item.entry).percent;
      case 'updated':        return item => item.entry.updatedAt;
      case 'added':          return item => item.entry.addedAt;
      default:               return null;
    }
  }

  /** Weekday (0 = Sunday) a releasing show's next episode airs on, if known. */
  function airingWeekday(media: Media): number | null {
    return media.status === 'RELEASING' && media.nextAiringAt != null ? new Date(media.nextAiringAt).getDay() : null;
  }

  function setSort(sort: LibrarySort) {
    const option = SORT_OPTIONS.find(o => o.value === sort);
    updateSettings({ librarySort: sort, librarySortDescending: option?.descending ?? false });
  }

  const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let todayIndex = $state(new Date().getDay());
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

  const filterCounts = $derived.by(() => {
    const counts = {} as Record<LibraryFilter, number>;
    for (const f of LIBRARY_FILTERS) {
      counts[f] = allItems.filter(x => matchesFilter(x, f)).length;
    }
    return counts;
  });

  // Per-media episode tallies computed in a single pass, so each card is O(1)
  // instead of filtering the whole episode list (which lagged with a big library).
  const mediaStats = $derived.by(() => {
    const stats = new Map<number, { done: number; count: number; aired: number; lastAiredAt: number | null; next: Episode | undefined }>();
    for (const ep of appData.episodes) {
      const s = stats.get(ep.mediaId) ?? { done: 0, count: 0, aired: 0, lastAiredAt: null, next: undefined };
      s.count++;
      if (ep.aired) {
        s.aired++;
        if (ep.airingAt !== null && ep.airingAt > (s.lastAiredAt ?? -Infinity)) s.lastAiredAt = ep.airingAt;
      }
      if (ep.watched || ep.skipped) s.done++;
      else if (ep.aired && (!s.next || ep.number < s.next.number)) s.next = ep;
      stats.set(ep.mediaId, s);
    }
    return stats;
  });

  const watchedMovieIds = $derived(new Set(
    appData.watchEvents.filter(event => event.episodeId === null).map(event => event.mediaId),
  ));

  function isMovie(media: Media): boolean {
    return (media.kind ?? (media.format === 'MOVIE' ? 'movie' : 'series')) === 'movie';
  }

  /** Watched/total for a card. Movies count as one episode, and a completed
   * title without episode records (e.g. an import) counts as fully watched. */
  function itemProgress(media: Media, entry: LibraryEntry) {
    const stats = mediaStats.get(media.id);
    if (isMovie(media)) {
      const watched = entry.status === 'COMPLETED' || watchedMovieIds.has(media.id) ? 1 : 0;
      return { watched, total: 1, percent: watched * 100 };
    }
    const total = media.totalEpisodes ?? stats?.count ?? 0;
    const watched = entry.status === 'COMPLETED' && !stats?.count ? total : stats?.done ?? 0;
    return { watched, total, percent: progressPercent(watched, total) };
  }

  const expandedItem = $derived(expandedId !== null ? allItems.find(x => x.media.id === expandedId) : null);
  const expandedWatchOptions = $derived(expandedItem ? watchOptions(expandedItem.media.externalLinks) : []);
  const expandedWatchOption = $derived(expandedItem ? selectedWatchOption(expandedItem.media.externalLinks, expandedItem.entry) : null);
  const expandedWatchSelection = $derived.by(() => {
    if (editingCustomWatch || expandedItem?.entry.watchDestination?.kind === 'custom') return 'custom';
    const url = expandedItem?.entry.watchDestination?.url;
    return expandedWatchOptions.some(option => option.url === url) ? url ?? '' : '';
  });

  $effect(() => {
    if (expandedId !== null) editingCustomWatch = false;
  });

  function saveWatchProvider(url: string) {
    if (!expandedItem) return;
    updateLibraryEntry(expandedItem.entry.id, { watchDestination: url ? { kind: 'provider', url } : undefined });
    editingCustomWatch = false;
  }

  function saveCustomWatch() {
    const name = customWatchName.trim();
    const url = customWatchUrl.trim();
    if (!expandedItem || (!name && !url) || (url && !isWatchUrl(url))) return;
    updateLibraryEntry(expandedItem.entry.id, {
      watchDestination: { kind: 'custom', name: name || new URL(url).hostname, url },
    });
    editingCustomWatch = false;
  }

  const expandedEps = $derived(expandedId !== null ? appData.episodes.filter(e => e.mediaId === expandedId) : []);
  const expandedWatched = $derived(expandedEps.filter(e => e.watched || e.skipped).length);
  const expandedAired = $derived(expandedEps.filter(e => e.aired).length);
  const expandedTotal = $derived(expandedItem ? (expandedItem.media.totalEpisodes ?? null) : null);
  const expandedIsMovie = $derived(expandedItem ? isMovie(expandedItem.media) : false);
  const expandedMovieWatched = $derived(
    expandedItem
      ? mediaWatchEvents(expandedItem.media.id).some(event => event.episodeId === null)
      : false,
  );

  // Do not leave a panel open for a title that has been removed from the library.
  $effect(() => {
    if (expandedId === null) return;
    if (!appData.library.some(item => item.mediaId === expandedId)) expandedId = null;
  });

  /** Run `action` for Enter/Space on the element itself, not on a nested control. */
  function activateOnKey(event: KeyboardEvent, action: () => void) {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    action();
  }

  // Clicking the active filter clears it and shows everything.
  function toggleFilter(f: LibraryFilter) {
    activeFilter = activeFilter === f ? null : f;
  }

  let detailsPanel = $state<HTMLElement | null>(null);

  // Start each newly selected title's details from the top.
  $effect(() => {
    void expandedId;
    untrack(() => detailsPanel?.scrollTo({ top: 0 }));
  });

  // Escape clears the selection, unless a dialog or text field has focus.
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || expandedId === null || event.defaultPrevented) return;
      if (removeTarget !== null || isTypingTarget(event.target)) return;
      expandedId = null;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function toggleExpand(id: number) {
    expandedId = activeTab === 'sync' ? id : expandedId === id ? null : id;
    activeTab = 'episodes';
    newestFirst = true;
  }

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
    if (syncing !== null || bulkSyncing) return;
    setSyncRun({ startedAt: Date.now(), finishedAt: null, cancelled: false,
      entries: [{ mediaId, title: syncTitle(mediaId), state: 'syncing' }] });
    activeTab = 'sync';
    syncing = mediaId;
    try {
      const result = await syncMedia(mediaId, { quiet: true });
      updateSyncItem(mediaId,
        result.status === 'error' ? 'failed' : result.status === 'up-to-date' ? 'unchanged' : 'synced',
        syncItemMessage(result));
    } catch (error) {
      updateSyncItem(mediaId, 'failed', error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      finishSyncRun(false);
      syncing = null;
    }
  }

  // Both layouts are virtualized: the grid measures its column count and card
  // height, and the list is a single column of fixed-height rows.
  const GRID_GAP = 12;
  const OVERSCAN_ROWS = 2;
  let scroller = $state<HTMLElement | null>(null);
  let itemsContainer = $state<HTMLElement | null>(null);
  let columnCount = $state(1);
  let rowHeight = $state(300);
  let scrollTop = $state(0);
  let viewportHeight = $state(800);
  const rowGap = $derived(layout === 'grid' ? GRID_GAP : 0);

  $effect(() => {
    if (!scroller || !itemsContainer) return;
    const isGrid = layout === 'grid';

    const update = () => {
      viewportHeight = scroller!.clientHeight;
      columnCount = isGrid
        ? Math.max(1, getComputedStyle(itemsContainer!).gridTemplateColumns.split(' ').filter(Boolean).length)
        : 1;
      const firstItem = itemsContainer!.firstElementChild as HTMLElement | null;
      const measuredHeight = firstItem?.getBoundingClientRect().height ?? 0;
      if (measuredHeight > 0) rowHeight = measuredHeight;
    };

    const frame = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    ro.observe(itemsContainer);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  });

  function windowAt(top: number) {
    return virtualGridWindow({
      itemCount: items.length,
      columnCount,
      rowHeight,
      rowGap,
      scrollTop: top,
      viewportHeight,
      overscanRows: OVERSCAN_ROWS,
    });
  }

  const itemsWindow = $derived(windowAt(scrollTop));
  const visibleItems = $derived(items.slice(itemsWindow.startIndex, itemsWindow.endIndex));

  // A new filter, search, sort, or layout produces a different list, so return
  // to its beginning. Watching an episode keeps the position.
  const listKey = () => `${activeFilter}|${catchUpSort}|${searchText}|${layout}|${sortBy}|${sortDescending}`;
  let lastListKey = untrack(listKey);
  $effect(() => {
    const key = listKey();
    if (key === lastListKey) return;
    lastListKey = key;
    untrack(() => {
      if (scroller) scroller.scrollTop = 0;
      scrollTop = 0;
      savedViewState.scrollTop = 0;
    });
  });

  $effect(() => {
    savedViewState.expandedId = expandedId;
    savedViewState.filter = activeFilter;
    savedViewState.tab = activeTab;
  });

  // Restore once the list has rendered and measured its rows.
  let scrollRestored = false;
  $effect(() => {
    if (scrollRestored || !scroller || items.length === 0) return;
    scrollRestored = true;
    const target = untrack(() => savedViewState.scrollTop);
    if (target <= 0) return;
    const el = scroller;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.scrollTop = target;
      scrollTop = el.scrollTop;
    }));
  });

  function handleScroll(event: Event) {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const nextScrollTop = event.currentTarget.scrollTop;
    savedViewState.scrollTop = nextScrollTop;
    // Avoid reconciling the keyed item list for every pixel of a scroll gesture.
    if (windowAt(nextScrollTop).startIndex !== itemsWindow.startIndex) {
      scrollTop = nextScrollTop;
    }
  }

  function setLayout(next: LibraryLayout) {
    if (next !== layout) updateSettings({ libraryLayout: next });
  }
</script>

<svelte:head>
  <title>Library · PLATYPUS</title>
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
  {#if bulkSyncing}
    <div
      class="h-1 shrink-0 bg-zinc-800"
      role="progressbar"
      aria-label="Syncing airing titles"
      aria-valuemin={0}
      aria-valuemax={bulkTotal}
      aria-valuenow={bulkDone}
    >
      <div
        class="h-full bg-accent transition-[width] duration-300 {bulkTotal === 0 ? 'w-1/4 animate-pulse' : ''}"
        style={bulkTotal > 0 ? `width:${Math.max(4, (bulkDone / bulkTotal) * 100)}%` : undefined}
      ></div>
    </div>
  {/if}
  <div class="flex min-h-0 flex-1">
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 md:px-6">
        <div class="inline-flex shrink-0 items-center rounded-lg bg-zinc-900/90 p-1 shadow-inner shadow-black/40 {searching ? 'opacity-60' : ''}" role="group" aria-label={searching ? 'Library filter, paused while searching' : 'Library filter'}>
          {#each LIBRARY_FILTERS as f}
            <button
              class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-all
                {activeFilter === f
                  ? 'bg-accent text-white shadow-sm shadow-black/40'
                  : 'text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-300'}"
              aria-pressed={activeFilter === f}
              disabled={searching}
              title={activeFilter === f ? 'Show all titles' : f === 'AIRING' ? 'Watching titles labeled Airing or Finished' : undefined}
              onclick={() => toggleFilter(f)}
            >
              {FILTER_LABELS[f]}
              <span class="rounded px-1.5 py-0.5 text-[10px] {activeFilter === f ? 'bg-black/25 text-white/80' : 'bg-black/30 text-zinc-400'}">{filterCounts[f]}</span>
            </button>
          {/each}
        </div>

        <label class="relative min-w-56 flex-1 lg:mx-auto lg:max-w-2xl">
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

        <div class="ml-auto flex items-center gap-2">
          {#if isCatchUp}
            <label class="relative">
              <span class="sr-only">Sort catch-up shows</span>
              <select
                class="appearance-none rounded-md border border-border bg-surface-2/50 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none [color-scheme:dark] transition-colors hover:border-zinc-500 focus:border-zinc-500"
                bind:value={catchUpSort}
              >
                <option value="backlog">Largest backlog</option>
                <option value="oldest">Oldest unwatched</option>
                <option value="newest">Most recently aired</option>
              </select>
              <svg class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </label>
          {:else}
            <div class="flex items-center">
              <label class="relative">
                <span class="sr-only">Sort by</span>
                <select
                  class="appearance-none rounded-l-md border border-border bg-surface-2/50 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none [color-scheme:dark] transition-colors hover:border-zinc-500 focus:border-zinc-500"
                  value={sortBy}
                  onchange={event => setSort(event.currentTarget.value as LibrarySort)}
                >
                  {#each SORT_OPTIONS as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
                <svg class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
                </svg>
              </label>
              <button
                type="button"
                class="-ml-px flex h-[38px] w-9 items-center justify-center rounded-r-md border border-border bg-surface-2/50 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
                aria-label={sortDescending ? 'Descending order' : 'Ascending order'}
                title={sortDescending ? 'Descending — click for ascending' : 'Ascending — click for descending'}
                onclick={() => updateSettings({ librarySortDescending: !sortDescending })}
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d={sortDescending ? 'M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 16.5m0 0L21 12.75m-3.75 3.75V4.5' : 'M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0-3.75-3.75M17.25 21 21 17.25'} />
                </svg>
              </button>
            </div>
          {/if}
          <div class="inline-flex items-center rounded-md border border-border bg-surface-2/50 p-0.5" role="group" aria-label="Layout">
            {#each [
              { value: 'grid', label: 'Grid view', path: 'M3.75 5.25h6v6h-6v-6Zm10.5 0h6v6h-6v-6ZM3.75 12.75h6v6h-6v-6Zm10.5 0h6v6h-6v-6Z' },
              { value: 'list', label: 'List view', path: 'M8.25 6.75h12M8.25 12h12M8.25 17.25h12M3.75 6.75h.01M3.75 12h.01M3.75 17.25h.01' },
            ] as const as option (option.value)}
              <button
                type="button"
                class="flex h-8 w-8 items-center justify-center rounded transition-colors
                  {layout === option.value ? 'bg-accent/15 text-accent' : 'text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200'}"
                aria-pressed={layout === option.value}
                aria-label={option.label}
                title={option.label}
                onclick={() => setLayout(option.value)}
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d={option.path} />
                </svg>
              </button>
            {/each}
          </div>
          {#if fs.status === 'ready'}
            <button
              class="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors
                {bulkSyncing
                  ? 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
                  : 'border-border bg-surface-2/50 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}"
              onclick={() => bulkSyncing ? bulkAbortCtrl?.abort() : handleBulkSync()}
              title={bulkSyncing ? 'Cancel sync' : 'Sync airing titles'}
            >
              <span class="inline-block text-base {bulkSyncing ? 'animate-spin' : ''}">↻</span>
              {#if bulkSyncing && bulkTotal > 0}
                Syncing {bulkDone}/{bulkTotal} · Cancel
              {:else if bulkSyncing}
                Syncing… · Cancel
              {:else if appData.settings.lastSyncedAt}
                Synced {timeAgo(appData.settings.lastSyncedAt, clock.now)}
              {:else}
                Sync airing
              {/if}
            </button>
          {/if}
        </div>
      </div>

      {#snippet card(media: Media, entry: LibraryEntry)}
        {@const { watched, total, percent } = itemProgress(media, entry)}
        {@const airing = airingState(media.status, mediaStats.get(media.id)?.lastAiredAt ?? null, clock.now, media.nextAiringAt)}
        {@const unwatched = catchUpEpisodeDetails.get(media.id)?.count ?? 0}
        {@const airsToday = media.status === 'RELEASING'
          && entry.status !== 'COMPLETED'
          && media.nextAiringAt != null
          && new Date(media.nextAiringAt).getDay() === todayIndex}
        {@const streamingUrl = appData.settings.watchButton.enabled ? selectedWatchOption(media.externalLinks, entry)?.url : null}
        {@const streamingIcon = streamingUrl ? streamingIconUrl(streamingUrl) : null}
        {@const streamingSite = selectedWatchOption(media.externalLinks, entry)?.name}
        {@const badge = entry.status === 'COMPLETED'
          ? 'DONE'
          : airing === 'airing'
            ? 'AIRING'
            : entry.status === 'PLAN_TO_WATCH'
              ? 'PLANNED'
              : entry.status}
        <div
          class="group relative flex cursor-pointer flex-col overflow-hidden rounded-md border bg-surface-2/55 transition-colors
            {airsToday
              ? 'border-green-500 ring-1 ring-green-500/70 shadow-[0_0_8px_rgba(34,197,94,0.25)] hover:border-green-400'
              : expandedId === media.id ? 'border-accent/60' : 'border-border hover:border-zinc-500'}"
          role="button"
          tabindex="0"
          data-media-id={media.id}
          onclick={() => toggleExpand(media.id)}
          onkeydown={event => activateOnKey(event, () => toggleExpand(media.id))}
        >
          <div class="relative aspect-[4/5] overflow-hidden bg-zinc-900">
            {#if media.coverImageLarge}
              <img
                src={media.coverImageLarge}
                alt={getTitle(media, lang)}
                class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                loading="lazy"
                decoding="async"
                use:fadeInOnLoad
              />
            {:else}
              <div class="flex h-full w-full items-center justify-center text-3xl text-zinc-700">◈</div>
            {/if}
            {#if badge !== 'WATCHING'}
              <span class="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide
                {badge === 'DONE' ? 'bg-green-700/90 text-green-50' :
                 badge === 'AIRING' ? 'bg-red-700/90 text-red-50' :
                 badge === 'PLANNED' ? 'bg-zinc-600/90 text-zinc-100' :
                 badge === 'PAUSED' ? 'bg-amber-700/90 text-amber-50' :
                 badge === 'DROPPED' ? 'bg-red-800/90 text-red-100' :
                 'bg-accent/90 text-white'}">{badge === 'AIRING' ? `• ${badge}` : badge === 'DONE' ? `✓ ${badge}` : badge}</span>
            {/if}
            {#if streamingUrl}
              <div class="pointer-events-none absolute inset-0 z-20 flex flex-col opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                <a
                  href={streamingUrl}
                  target="_blank"
                  rel="noopener"
                  class="flex min-h-0 flex-1 items-center justify-center bg-zinc-950/85 text-zinc-200 transition-colors hover:bg-accent/80 hover:text-white focus-visible:bg-accent/80 focus-visible:text-white focus-visible:outline-none"
                  aria-label="Watch {getTitle(media, lang)} and open its sidebar"
                  title="Watch now"
                  onclick={event => {
                    expandedId = media.id;
                    activeTab = 'episodes';
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
                  class="flex min-h-0 flex-1 items-center justify-center border-t border-border bg-surface-2/90 text-zinc-300 transition-colors hover:bg-zinc-800/80 hover:text-white focus-visible:bg-zinc-800/80 focus-visible:text-white focus-visible:outline-none"
                  aria-label="Open sidebar for {getTitle(media, lang)}"
                  title="Open sidebar"
                  onclick={event => {
                    event.stopPropagation();
                    expandedId = media.id;
                    activeTab = 'episodes';
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
          <!-- Fixed height so every card in the virtualized grid measures the same. -->
          <div class="flex shrink-0 flex-col p-2 {isCatchUp ? 'h-28' : 'h-24'}">
            <h3 class="line-clamp-2 text-[11px] font-semibold leading-4 text-zinc-100">{getTitle(media, lang)}</h3>
            <div class="mt-auto pt-3">
              {#if isCatchUp}
                <p class="mb-1.5 text-[10px] font-semibold text-green-400">{unwatched} {unwatched === 1 ? 'episode' : 'episodes'} to watch</p>
              {/if}
              <div class="mb-1.5 flex items-center justify-between text-[10px] text-zinc-400">
                <span>
                  {watched}/{total}{#if !isCatchUp && media.status === 'RELEASING' && unwatched > 0}{' '}<span class="text-green-400">(+{unwatched})</span>{/if}
                </span>
                <span>{percent}%</span>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-zinc-700/80">
                <div class="h-full rounded-full {entry.status === 'COMPLETED' ? 'bg-green-500' : 'bg-accent'}" style={`width:${percent}%`}></div>
              </div>
            </div>
          </div>
        </div>
      {/snippet}

      {#snippet row(media: Media, entry: LibraryEntry)}
        {@const { watched, total, percent } = itemProgress(media, entry)}
        {@const unwatched = catchUpEpisodeDetails.get(media.id)?.count ?? 0}
        {@const thumbnail = media.coverImageMedium ?? media.coverImageLarge}
        {@const weekday = airingWeekday(media)}
        {@const airing = airingState(media.status, mediaStats.get(media.id)?.lastAiredAt ?? null, clock.now, media.nextAiringAt)}
        <div
          class="grid h-12 cursor-pointer items-center gap-3 border-b border-border/60 px-2 text-xs transition-colors {LIST_COLUMNS}
            {expandedId === media.id ? 'bg-accent/10' : 'hover:bg-zinc-800/50'}"
          role="row"
          tabindex="0"
          data-media-id={media.id}
          onclick={() => toggleExpand(media.id)}
          onkeydown={event => activateOnKey(event, () => toggleExpand(media.id))}
        >
          <span role="cell">
            {#if thumbnail}
              <img src={thumbnail} alt="" class="h-10 w-7 rounded-sm object-cover" loading="lazy" decoding="async" use:fadeInOnLoad />
            {:else}
              <span class="flex h-10 w-7 items-center justify-center rounded-sm bg-zinc-800 text-[10px] text-zinc-600">◈</span>
            {/if}
          </span>
          <span role="cell" class="truncate font-medium text-zinc-100" title={getTitle(media, lang)}>{getTitle(media, lang)}</span>
          {#if showWatchColumn}
            {@const watchOption = selectedWatchOption(media.externalLinks, entry)}
            <span role="cell" class="min-w-0">
              {#if watchOption}
                <a
                  href={watchOption.url}
                  target="_blank"
                  rel="noopener"
                  class="block truncate rounded-md bg-accent px-2.5 py-1 text-center text-[11px] font-semibold text-white transition-colors hover:brightness-110"
                  style={watchButtonStyle(watchOption.color)}
                  title="Watch on {watchOption.name}"
                  onclick={event => handleExternalLink(event, watchOption.url, true)}
                  onkeydown={event => event.stopPropagation()}
                >▶ Watch on {watchOption.name}</a>
              {/if}
            </span>
          {/if}
          <span role="cell" class="text-[10px] font-semibold uppercase tracking-wide {airing === 'airing' ? 'text-red-400' : 'text-zinc-400'}">
            {airing === 'airing' ? '• Airing' : airing === 'finished' ? 'Finished' : ''}
          </span>
          <span role="cell" class="{weekday === todayIndex ? 'font-medium text-accent' : 'text-zinc-400'}">
            {weekday === null ? '' : WEEKDAY_LABELS[weekday]}
          </span>
          <span role="cell" class="h-1 overflow-hidden rounded-full bg-zinc-700/80">
            <span class="block h-full rounded-full {entry.status === 'COMPLETED' ? 'bg-green-500' : 'bg-accent'}" style={`width:${percent}%`}></span>
          </span>
          <span role="cell" class="text-right tabular-nums text-zinc-400">{percent}%</span>
          <span role="cell" class="text-right tabular-nums text-zinc-400">
            {watched}/{total}{#if media.status === 'RELEASING' && unwatched > 0}{' '}<span class="text-green-400">(+{unwatched})</span>{/if}
          </span>
        </div>
      {/snippet}

      <!-- Content -->
      {#if allItems.length === 0}
        <div class="text-center py-20 text-zinc-500">
          <p class="mb-2">Your library is empty.</p>
          <a href="{base}/search" class="text-accent underline text-sm">Search sources for media</a>.
        </div>
      {:else}
        <section class="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-5 md:px-6">
          {#if items.length === 0}
            <div class="rounded-md border border-dashed border-border py-16 text-center text-sm text-zinc-500">
              {isCatchUp
                ? searchText.trim() && filterCounts.CATCH_UP > 0
                  ? 'No catch-up shows match your search.'
                  : 'You’re all caught up.'
                : searchText.trim()
                  ? 'No titles match your search.'
                  : 'No titles match this filter.'}
            </div>
          {:else}
            <div
              class="min-h-0 flex-1 overflow-y-auto"
              role={layout === 'list' ? 'table' : undefined}
              aria-label={layout === 'list' ? 'Library' : undefined}
              bind:this={scroller}
              onscroll={handleScroll}
            >
              {#if layout === 'list'}
                <div
                  class="sticky top-0 z-10 grid h-8 items-center gap-3 border-b border-border bg-surface px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 {LIST_COLUMNS}"
                  role="row"
                >
                  <span role="columnheader"><span class="sr-only">Thumbnail</span></span>
                  <span role="columnheader">Title</span>
                  {#if showWatchColumn}<span role="columnheader"><span class="sr-only">Watch</span></span>{/if}
                  <span role="columnheader">Airing</span>
                  <span role="columnheader">Day</span>
                  <span role="columnheader">Progress</span>
                  <span role="columnheader" class="text-right">%</span>
                  <span role="columnheader" class="text-right">Episodes</span>
                </div>
              {/if}
              <div class="relative mb-6" style="height:{itemsWindow.totalHeight}px" role={layout === 'list' ? 'rowgroup' : undefined}>
                {#if layout === 'grid'}
                  <div
                    class="absolute inset-x-0 top-0 grid grid-cols-[repeat(auto-fill,minmax(135px,1fr))] gap-3"
                    style="transform:translateY({itemsWindow.offsetTop}px)"
                    bind:this={itemsContainer}
                  >
                    {#each visibleItems as { media, entry } (entry.id)}
                      {@render card(media, entry)}
                    {/each}
                  </div>
                {:else}
                  <div
                    class="absolute inset-x-0 top-0 flex flex-col"
                    style="transform:translateY({itemsWindow.offsetTop}px)"
                    bind:this={itemsContainer}
                  >
                    {#each visibleItems as { media, entry } (entry.id)}
                      {@render row(media, entry)}
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </section>
      {/if}

    </div>

    <!-- Details panel: always docked on the right, for both layouts -->
    <aside
      class="flex min-h-0 w-96 shrink-0 flex-col border-l border-border bg-surface xl:w-[32rem]"
      aria-label="Library sidebar"
    >
      <div class="flex shrink-0 border-b border-border px-5 pt-3" role="tablist" aria-label="Sidebar view">
        <button type="button" role="tab" id="episodes-tab" aria-controls="episodes-panel" aria-selected={activeTab === 'episodes'}
          class="border-b-2 px-3 py-2 text-sm transition-colors {activeTab === 'episodes' ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-200'}"
          onclick={() => activeTab = 'episodes'}>Episodes</button>
        <button type="button" role="tab" id="sync-tab" aria-controls="sync-panel" aria-selected={activeTab === 'sync'}
          class="border-b-2 px-3 py-2 text-sm transition-colors {activeTab === 'sync' ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-200'}"
          onclick={() => activeTab = 'sync'}>Sync{#if syncRun?.entries.some(entry => entry.state === 'failed')}<span class="ml-1.5 rounded-full bg-red-900/50 px-1.5 text-[10px] text-red-300">!</span>{/if}</button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-5" bind:this={detailsPanel}>
      {#if activeTab === 'sync'}
        <div role="tabpanel" id="sync-panel" aria-labelledby="sync-tab" class="space-y-4">
          {#if syncRun}
            <div>
              <h2 class="text-lg font-semibold text-white">Latest sync</h2>
              <p class="mt-1 text-xs text-zinc-500">Started {new Date(syncRun.startedAt).toLocaleTimeString()}</p>
              <p class="mt-2 text-sm text-zinc-300" aria-live="polite">
                {#if syncRun.finishedAt === null}
                  Syncing {syncRun.entries.filter(entry => !['queued', 'syncing'].includes(entry.state)).length}/{syncRun.entries.length}
                {:else if syncRun.cancelled}
                  Cancelled · {syncRun.entries.filter(entry => entry.state === 'synced' || entry.state === 'unchanged').length} completed
                {:else}
                  {syncRun.entries.filter(entry => entry.state === 'synced' || entry.state === 'unchanged').length} completed · {syncRun.entries.filter(entry => entry.state === 'failed').length} failed · {syncRun.entries.filter(entry => entry.state === 'skipped').length} skipped
                {/if}
              </p>
            </div>
            {#if syncRun.entries.length === 0}
              <p class="text-sm text-zinc-500">No titles were eligible for this sync.</p>
            {:else}
              <ol class="space-y-2" aria-label="Sync results">
                {#each syncRun.entries as entry (entry.mediaId)}
                  <li class="rounded-lg border border-border bg-surface-2 p-3">
                    <div class="flex items-start justify-between gap-3">
                      <span class="min-w-0 text-sm font-medium text-zinc-200">{entry.title}</span>
                      <span class="shrink-0 text-[10px] font-semibold uppercase tracking-wide
                        {entry.state === 'failed' ? 'text-red-400' : entry.state === 'synced' ? 'text-green-400' : entry.state === 'syncing' ? 'text-accent' : 'text-zinc-400'}">{entry.state}</span>
                    </div>
                    {#if entry.message}<p class="mt-1 break-words text-xs text-zinc-400">{entry.message}</p>{/if}
                  </li>
                {/each}
              </ol>
            {/if}
          {:else}
            <div class="flex h-full items-center justify-center text-center text-sm text-zinc-500">
              <p>Sync results will appear here after you sync.</p>
            </div>
          {/if}
        </div>
      {:else if expandedItem}
        {@const m = expandedItem.media}
        <div role="tabpanel" id="episodes-panel" aria-labelledby="episodes-tab" class="space-y-4">
          <!-- Header -->
          <div class="flex flex-col gap-4">
            <div>
              <h2 class="text-lg font-bold text-white">{getTitle(m, lang)}</h2>
              {#if m.titleNative && m.titleNative !== getTitle(m, lang)}
                <p class="text-sm text-zinc-400">{m.titleNative}</p>
              {/if}
            </div>
            {#if appData.settings.watchButton.enabled}
              <div class="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
                {#if expandedWatchOption}
                  <a
                    href={expandedWatchOption.url}
                    target="_blank"
                    rel="noopener"
                    class="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110"
                    style={watchButtonStyle(expandedWatchOption.color)}
                    onclick={event => handleExternalLink(event, expandedWatchOption.url)}
                  >▶ Watch on {expandedWatchOption.name}</a>
                {/if}
                <label class="block text-xs text-zinc-400" for="watch-provider">Watch platform</label>
                <select
                  id="watch-provider"
                  class="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-zinc-200 outline-none [color-scheme:dark] focus:border-accent"
                  value={expandedWatchSelection}
                  onchange={event => {
                    const value = event.currentTarget.value;
                    if (value === 'custom') {
                      customWatchName = expandedItem.entry.watchDestination?.kind === 'custom' ? expandedItem.entry.watchDestination.name : '';
                      customWatchUrl = expandedItem.entry.watchDestination?.kind === 'custom' ? expandedItem.entry.watchDestination.url : '';
                      editingCustomWatch = true;
                    } else saveWatchProvider(value);
                  }}
                >
                  <option value="">Automatic{expandedWatchOptions[0] ? ` · ${expandedWatchOptions[0].name}` : ''}</option>
                  {#each expandedWatchOptions as option (option.url)}
                    <option value={option.url}>{option.name}</option>
                  {/each}
                  <option value="custom">{expandedItem.entry.watchDestination?.kind === 'custom' ? expandedItem.entry.watchDestination.name : 'Add platform…'}</option>
                </select>
                {#if expandedItem.entry.watchDestination?.kind === 'custom' && !editingCustomWatch}
                  <button type="button" class="text-xs text-accent hover:underline" onclick={() => {
                    customWatchName = expandedItem.entry.watchDestination?.kind === 'custom' ? expandedItem.entry.watchDestination.name : '';
                    customWatchUrl = expandedItem.entry.watchDestination?.kind === 'custom' ? expandedItem.entry.watchDestination.url : '';
                    editingCustomWatch = true;
                  }}>Edit platform</button>
                {/if}
                {#if editingCustomWatch}
                  <form class="space-y-2" onsubmit={event => { event.preventDefault(); saveCustomWatch(); }}>
                    <input aria-label="Platform name" placeholder="Platform name, e.g. Crunchyroll" maxlength="60" bind:value={customWatchName} class="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-white" />
                    <input aria-label="Show URL (optional)" type="url" placeholder="Show URL (optional)" bind:value={customWatchUrl} class="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-white" />
                    <div class="flex items-center gap-2">
                      <button type="submit" disabled={(!customWatchName.trim() && !customWatchUrl.trim()) || (!!customWatchUrl.trim() && !isWatchUrl(customWatchUrl.trim()))} class="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Save platform</button>
                      <button type="button" onclick={() => editingCustomWatch = false} class="text-sm text-zinc-400 hover:text-white">Cancel</button>
                    </div>
                  </form>
                {:else if expandedItem.entry.watchDestination?.kind === 'custom' && !expandedItem.entry.watchDestination.url}
                  <p class="text-xs text-zinc-500">Add a show URL to enable the watch button.</p>
                {/if}
              </div>
            {/if}
            <div class="flex flex-wrap items-center gap-2">
              {#if canSyncMedia(m)}
                <button
                  class="text-xs px-3 py-1.5 rounded bg-surface-2 border border-border hover:border-zinc-500 text-zinc-300 transition-colors flex items-center gap-1.5"
                  onclick={() => handleSync(m.id)}
                  disabled={syncing !== null || bulkSyncing}
                ><span class="{syncing === m.id ? 'animate-spin' : ''}">↻</span> Sync</button>
              {/if}
              {#if expandedIsMovie}
                <button
                  class="text-xs px-3 py-1.5 rounded border transition-colors {expandedMovieWatched ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface-2 text-zinc-300 hover:border-zinc-500'}"
                  onclick={() => setMovieWatched(m.id, !expandedMovieWatched)}
                >{expandedMovieWatched ? '✓ Watched' : 'Mark watched'}</button>
              {/if}
              <a
                href="{base}/media/{m.id}"
                class="text-xs px-3 py-1.5 rounded bg-surface-2 border border-border hover:border-zinc-500 text-zinc-300 transition-colors"
              >Details</a>
              <button
                class="text-xs px-3 py-1.5 rounded bg-red-900/30 border border-red-800/40 hover:border-red-600 text-red-400 transition-colors"
                onclick={() => removeTarget = m.id}
              >Remove</button>
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
          {#if m.scheduleLink && 'providerId' in m.scheduleLink}
            {@const scheduleUrl = m.scheduleLink.canonicalUrl ?? `https://www.tvmaze.com/shows/${m.scheduleLink.providerId}`}
            <p class="text-xs text-zinc-500">
              Air times from <a href={scheduleUrl} target="_blank" rel="noopener" class="text-zinc-300 hover:text-accent" onclick={event => handleExternalLink(event, scheduleUrl)}>TVmaze</a> · CC BY-SA 4.0
            </p>
          {/if}
        </div>
      {:else}
        <div role="tabpanel" id="episodes-panel" aria-labelledby="episodes-tab" class="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-zinc-500">
          <svg class="h-10 w-10 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
          <p>Select a title to see its episodes.</p>
        </div>
      {/if}
      </div>
    </aside>
  </div>
</div>
