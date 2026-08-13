<script lang="ts">
  import { base } from '$app/paths';
  import type { NormalizedMedia, SourceConnection } from '$lib/connectors/contracts.js';
  import type { Media } from '$lib/types.js';
  import { appData, createMediaFromSource } from '$lib/store.svelte.js';
  import { syncMedia } from '$lib/api/sync.js';
  import { debounce } from '$lib/utils.js';
  import {
    groupSearchResults,
    interleaveSearchResults,
    searchResultsMatch,
    type GroupableSearchResult,
  } from '$lib/search-grouping.js';
  import { searchState, sourceQueryCache } from './state.svelte.js';
  import { searchSources, sourcesState, type UnifiedSearchGroup } from '$lib/sources.svelte.js';

  const inLibrary = $derived(new Set(appData.library.map(l => l.mediaId)));

  interface SourceResult extends GroupableSearchResult {
    result: NormalizedMedia;
    connection: SourceConnection;
  }

  let loading = $state(false);
  let error = $state('');
  let addingSource = $state<string | null>(null);
  let addedSources = $state<string[]>([]);
  let searchInput = $state<HTMLInputElement | null>(null);

  // Holds the AbortController for the current in-flight search.
  // Component-scoped is fine — race conditions are within a single page visit.
  let currentAbort: AbortController | null = null;

  async function doSearch(q: string) {
    if (q.length < 2) {
      searchState.sourceGroups = [];
      return;
    }

    // Cancel previous in-flight request to prevent stale results overwriting fresh ones.
    currentAbort?.abort();

    const sourceSignature = sourcesState.sources
      .filter(source => source.connection.enabled && source.template.operations.search)
      .map(source => `${source.connection.id}:${source.connection.updatedAt}`)
      .sort()
      .join('|');
    const cacheKey = `${q}\u0000${sourceSignature}`;
    const cachedSources = sourceQueryCache.get(cacheKey);

    const ctrl = new AbortController();
    currentAbort = ctrl;
    loading = true;
    error = '';

    try {
      const configured = await (cachedSources
        ? Promise.resolve(cachedSources)
        : searchSources(q, ctrl.signal));
      if (!ctrl.signal.aborted) {
        sourceQueryCache.set(cacheKey, configured);
        searchState.sourceGroups = configured;
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        error = e instanceof Error ? e.message : 'Search failed';
      }
    } finally {
      if (!ctrl.signal.aborted) loading = false;
    }
  }

  const debouncedSearch = debounce((q: string) => doSearch(q), 400);

  function onInput() { debouncedSearch(searchState.query); }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      // Skip the debounce delay on Enter; any in-flight debounced call will
      // be a cache hit when it fires 400ms later, so no double request.
      doSearch(searchState.query);
    }
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

  async function handleAddSource(result: UnifiedSearchGroup['results'][number], connection: UnifiedSearchGroup['connection']) {
    const key = `${connection.id}:${result.providerId}`;
    addingSource = key;
    try {
      const media = createMediaFromSource(result, connection);
      const configured = sourcesState.sources.find(source => source.connection.id === connection.id);
      if (configured?.template.operations.details || configured?.template.operations.episodes) {
        await syncMedia(media.id);
      }
      addedSources = [...addedSources, key];
    } finally {
      addingSource = null;
    }
  }

  function sourceYear(result: NormalizedMedia): number | null {
    const year = Number.parseInt((result.releaseDate ?? result.startDate ?? '').slice(0, 4), 10);
    return Number.isInteger(year) ? year : null;
  }

  const groupedResults = $derived.by(() => {
    const resultsBySource = searchState.sourceGroups.map(group => group.results.map((result): SourceResult => ({
        key: `${group.connection.id}:${result.providerId}`,
        sourceKey: group.connection.id,
        sourceName: group.connection.name,
        providerId: String(result.providerId),
        kind: result.kind,
        title: result.title,
        alternateTitles: result.originalTitle ? [result.originalTitle] : [],
        year: sourceYear(result),
        result,
        connection: group.connection,
      })));
    return groupSearchResults(interleaveSearchResults(resultsBySource));
  });

  function localResult(media: Media): GroupableSearchResult {
    return {
      key: `local:${media.id}`,
      sourceKey: `local:${media.id}`,
      sourceName: 'Library',
      providerId: String(media.id),
      kind: media.kind ?? (media.format === 'MOVIE' ? 'movie' : 'series'),
      title: media.titleRomaji,
      alternateTitles: [media.titleEnglish, media.titleNative].filter((title): title is string => !!title),
      year: media.seasonYear,
    };
  }

  function exactLibraryMediaId(result: SourceResult): number | null {
    const media = appData.media.find(item =>
      item.providerLinks?.some(link =>
        link.connectionId === result.connection.id && link.providerId === result.providerId,
      )
      || (item.syncSource?.kind === 'connection'
        && item.syncSource.connectionId === result.connection.id
        && item.syncSource.providerId === result.providerId),
    );
    return media && inLibrary.has(media.id) ? media.id : null;
  }

  function libraryMatches(results: SourceResult[]): Media[] {
    const exactIds = new Set(results.map(exactLibraryMediaId).filter((id): id is number => id !== null));
    const matches = appData.media.filter(media =>
      inLibrary.has(media.id)
      && (exactIds.has(media.id) || results.some(result => searchResultsMatch(result, localResult(media)))),
    );
    return matches;
  }

  const resultRows = $derived(groupedResults.map(group => ({
    ...group,
    libraryMedia: libraryMatches(group.results),
  })));

  function mediaHref(mediaId: number): string {
    return `${base}/${mediaId < 0 ? 'media' : 'anime'}/${mediaId}`;
  }

  const sourceErrors = $derived(searchState.sourceGroups.filter(group => group.error));
</script>

<div class="space-y-5">
  <div class="flex items-center justify-center px-4 py-3 md:px-6">
    <label class="relative w-full min-w-56 lg:max-w-2xl">
      <span class="sr-only">Search media sources</span>
      <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35m1.35-5.4a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
      </svg>
      <input
        class="w-full rounded-md border border-border bg-surface-2/70 py-2 pl-10 pr-20 text-sm text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
        type="search"
        placeholder="Search your sources…"
        bind:this={searchInput}
        bind:value={searchState.query}
        oninput={onInput}
        onkeydown={onKeydown}
      />
      {#if loading}
        <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400 animate-pulse">Searching…</span>
      {:else}
        <kbd class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">Ctrl K</kbd>
      {/if}
    </label>
  </div>

  <div class="space-y-5 px-4 pb-6 md:px-6">
    {#if error}
      <p class="text-sm text-red-400">{error}</p>
    {/if}
    {#each sourceErrors as group (group.connection.id)}
      <p class="text-xs text-amber-400">{group.connection.name} search unavailable: {group.error}</p>
    {/each}

    {#if resultRows.length === 0 && !loading && searchState.query.length >= 2}
      <p class="py-10 text-center text-sm text-zinc-500">No results found for "{searchState.query}"</p>
    {:else if searchState.query.length < 2 && !loading}
      <p class="py-10 text-center text-sm text-zinc-500">Type to search your enabled sources</p>
    {:else}
      <div class="space-y-2">
        {#each resultRows as row (row.key)}
          {@const libraryItem = row.libraryMedia[0]}
          <section class="rounded-xl border bg-surface p-2 transition-colors {libraryItem ? 'border-accent/40' : 'border-border hover:border-zinc-600'}">
            {#if row.results.length > 1 || libraryItem}
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <div class="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                  <span>{row.results.length} source{row.results.length === 1 ? '' : 's'}</span>
                  {#each row.results as result (result.key)}
                    <span class="rounded border border-border bg-zinc-900 px-1.5 py-0.5 font-medium uppercase tracking-wide text-zinc-400">{result.sourceName}</span>
                  {/each}
                </div>
                {#if libraryItem}
                  <a href={mediaHref(libraryItem.id)} class="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent transition-colors hover:bg-accent/20">✓ In library · View →</a>
                {/if}
              </div>
            {/if}

            <div class="space-y-2">
              {#each row.results as result (result.key)}
                {@const exactMediaId = exactLibraryMediaId(result)}
                <article class="flex min-w-0 gap-3 rounded-lg bg-surface-2 p-2.5">
                  <div class="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                    {#if result.result.artwork?.[0]}
                      <img class="h-full w-full object-cover" src={result.result.artwork[0].url} alt="" loading="lazy" />
                    {:else}
                      <span class="flex h-full items-center justify-center text-zinc-600">◈</span>
                    {/if}
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate text-sm font-medium text-zinc-100">
                        {result.result.title}
                      </p>
                      <span class="rounded border border-border bg-zinc-900 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-400">{result.sourceName}</span>
                    </div>
                    <p class="mt-0.5 text-[10px] text-zinc-600">{result.sourceName} ID: {result.providerId}</p>

                    <p class="text-xs text-zinc-500">{result.result.kind}{result.result.releaseDate ? ` · ${result.result.releaseDate}` : ''}</p>
                    {#if result.result.overview}<p class="mt-1 line-clamp-2 text-xs text-zinc-500">{result.result.overview}</p>{/if}
                  </div>

                  <div class="shrink-0 self-start">
                    {#if exactMediaId !== null}
                      <a href={mediaHref(exactMediaId)} class="block whitespace-nowrap rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/20">✓ View</a>
                    {:else if libraryItem}
                      <span class="block whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs text-zinc-500" title="This title is already in your library from another source">In library</span>
                    {:else}
                      <button class="whitespace-nowrap rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-accent hover:text-accent disabled:opacity-50" onclick={() => handleAddSource(result.result, result.connection)} disabled={addingSource === result.key || addedSources.includes(result.key)}>{addedSources.includes(result.key) ? 'Added' : addingSource === result.key ? '…' : '+ Add'}</button>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</div>
