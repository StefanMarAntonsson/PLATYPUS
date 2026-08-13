<script lang="ts">
  import { base } from '$app/paths';
  import type { Collection, Media, SortOption } from '$lib/types.js';
  import { appData, createCollection } from '$lib/store.svelte.js';
  import { getTitle, progressPercent } from '$lib/utils.js';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  interface CollectionView {
    collection: Collection;
    coverMedia: Media | null;
    mediaList: Media[];
    watched: number;
    aired: number;
    isAiring: boolean;
    isUpcoming: boolean;
  }

  const collectionViews = $derived<CollectionView[]>(
    appData.collections.map(c => {
      const entries = appData.collectionEntries
        .filter(e => e.collectionId === c.id)
        .sort((a, b) => a.order - b.order);
      const mediaList = entries.map(e => appData.media.find(m => m.id === e.mediaId)).filter((m): m is Media => !!m);
      const coverMedia = c.coverMediaId
        ? (appData.media.find(m => m.id === c.coverMediaId) ?? mediaList[0] ?? null)
        : (mediaList[0] ?? null);

      const mediaIds = mediaList.map(m => m.id);
      const eps = appData.episodes.filter(e => mediaIds.includes(e.mediaId));
      const watched = eps.filter(e => e.watched || e.skipped).length;
      const aired = eps.filter(e => e.aired).length;

      const isAiring = mediaList.some(m => m.status === 'RELEASING');
      const isUpcoming = !isAiring && mediaList.some(m => m.status === 'NOT_YET_RELEASED');

      return { collection: c, coverMedia, mediaList, watched, aired, isAiring, isUpcoming };
    })
  );

  let searchText = $state('');
  let sortBy = $state<SortOption>(appData.settings.defaultSort);
  let newCollectionName = $state('');
  let showCreate = $state(false);

  const filtered = $derived.by<CollectionView[]>(() => {
    let list = collectionViews;
    const q = searchText.toLowerCase().trim();
    if (q) {
      list = list.filter(c =>
        c.collection.name.toLowerCase().includes(q) ||
        c.mediaList.some(m => getTitle(m, appData.settings.titleLanguage).toLowerCase().includes(q))
      );
    }
    switch (sortBy) {
      case 'name_asc':  list = [...list].sort((a, b) => a.collection.name.localeCompare(b.collection.name)); break;
      case 'name_desc': list = [...list].sort((a, b) => b.collection.name.localeCompare(a.collection.name)); break;
      case 'progress':  list = [...list].sort((a, b) =>
        progressPercent(b.watched, b.aired) - progressPercent(a.watched, a.aired)); break;
    }
    return list;
  });

  function handleCreate() {
    const name = newCollectionName.trim();
    if (!name) return;
    createCollection(name);
    newCollectionName = '';
    showCreate = false;
  }

  const cardSizeClass = $derived({
    small: 'w-[120px]',
    medium: 'w-[160px]',
    large: 'w-[200px]',
  }[appData.settings.cardSize]);

  const cardImgHeight = $derived({
    small: 'h-[170px]',
    medium: 'h-[226px]',
    large: 'h-[283px]',
  }[appData.settings.cardSize]);
</script>

<div class="p-4 md:p-6 space-y-4">
  <!-- Toolbar -->
  <div class="flex gap-3">
    <input
      class="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
      type="search"
      placeholder="Search collections…"
      bind:value={searchText}
    />
    <select
      class="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
      bind:value={sortBy}
    >
      <option value="default">Default</option>
      <option value="name_asc">Name A→Z</option>
      <option value="name_desc">Name Z→A</option>
      <option value="progress">By progress</option>
    </select>
    <button
      class="px-4 py-2 text-sm rounded-lg text-white transition-colors shrink-0"
      style="background:var(--accent)"
      onclick={() => showCreate = !showCreate}
    >+ New</button>
  </div>

  <!-- Create form -->
  {#if showCreate}
    <div class="flex gap-2">
      <input
        class="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-accent/50"
        placeholder="Collection name…"
        bind:value={newCollectionName}
        onkeydown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { showCreate = false; newCollectionName = ''; } }}
      />
      <button
        class="px-4 py-2 text-sm rounded-lg text-white transition-opacity disabled:opacity-40"
        style="background:var(--accent)"
        onclick={handleCreate}
        disabled={!newCollectionName.trim()}
      >Create</button>
      <button
        class="px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border text-zinc-400 hover:text-zinc-200 transition-colors"
        onclick={() => { showCreate = false; newCollectionName = ''; }}
      >Cancel</button>
    </div>
  {/if}

  <!-- Empty -->
  {#if collectionViews.length === 0}
    <div class="text-center py-20 text-zinc-500">
      <p class="text-lg mb-2">No collections yet</p>
      <p class="text-sm">Use the <strong class="text-zinc-400">+ New</strong> button to create your first collection.</p>
    </div>
  {:else if filtered.length === 0}
    <div class="text-center py-16 text-zinc-500 text-sm">No collections match your search.</div>
  {:else}
    <!-- Card grid -->
    <div class="flex flex-wrap gap-4">
      {#each filtered as col (col.collection.id)}
        {@const pct = progressPercent(col.watched, col.aired)}
        {@const isComplete = col.watched > 0 && col.watched >= col.aired && col.aired > 0}
        <a
          href="{base}/collections/{col.collection.id}"
          class="relative rounded-xl overflow-hidden border border-border hover:border-zinc-500 group transition-all duration-200 block
            {cardSizeClass}"
          style="border-radius:{appData.settings.cardBorderRadius}px"
        >
          <!-- Cover image -->
          <div class="relative {cardImgHeight} bg-zinc-800 overflow-hidden">
            {#if col.coverMedia?.coverImageLarge}
              <img
                src={col.coverMedia.coverImageLarge}
                alt={col.collection.name}
                class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            {:else}
              <div class="w-full h-full flex items-center justify-center text-zinc-600">
                <span class="text-4xl">◈</span>
              </div>
            {/if}

            {#if isComplete}
              <div class="absolute inset-0 bg-gradient-to-t from-green-900/60 to-transparent pointer-events-none"></div>
            {/if}

            <div class="absolute top-2 left-2 flex flex-col gap-1">
              {#if col.isAiring}
                <span class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-900/80 text-purple-300 backdrop-blur-sm">
                  <span class="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>Airing
                </span>
              {:else if col.isUpcoming}
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/80 text-orange-300 backdrop-blur-sm">Upcoming</span>
              {/if}
            </div>

            <div class="absolute bottom-2 right-2 drop-shadow-lg">
              <ProgressRing progress={pct} size={40} stroke={3} label="{pct}%" />
            </div>
          </div>

          <!-- Card footer -->
          <div style="padding:{appData.settings.cardPadding}px">
            <div class="text-xs font-medium text-zinc-200 line-clamp-2 leading-tight mb-1">
              {col.collection.name}
            </div>
            <div class="text-[10px] text-zinc-500">
              {col.watched}/{col.aired} ep · {col.mediaList.length} {col.mediaList.length === 1 ? 'anime' : 'anime'}
            </div>
          </div>
        </a>
      {/each}
    </div>

  {/if}
</div>
