<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import {
    appData, updateCollection, deleteCollection,
    removeMediaFromCollection, getCollectionMedia,
  } from '$lib/store.svelte.js';
  import { getTitle, progressPercent } from '$lib/utils.js';
  import { syncMedia } from '$lib/api/sync.js';
  import EpisodeTable from '$lib/components/EpisodeTable.svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  const collectionId = $derived(Number(page.params.id));
  const collection = $derived(appData.collections.find(c => c.id === collectionId));
  const mediaList = $derived(collection ? getCollectionMedia(collectionId) : []);

  let editing = $state(false);
  let nameInput = $state('');
  let originalInput = $state('');
  let confirmDelete = $state(false);
  let newestFirst = $state(false);
  let contextMenu = $state<{ x: number; y: number; mediaId: number } | null>(null);

  $effect(() => {
    if (collection) {
      nameInput = collection.name;
      originalInput = collection.originalName ?? '';
    }
  });

  function startEdit() { editing = true; }
  function cancelEdit() { editing = false; if (collection) { nameInput = collection.name; originalInput = collection.originalName ?? ''; } }

  function saveEdit() {
    if (!nameInput.trim()) return;
    updateCollection(collectionId, { name: nameInput.trim(), originalName: originalInput.trim() || null });
    editing = false;
  }

  async function handleDelete() {
    deleteCollection(collectionId);
    goto(base + '/collections');
  }

  const watched = $derived(appData.episodes.filter(e => mediaList.some(m => m.id === e.mediaId) && e.watched).length);
  const aired = $derived(appData.episodes.filter(e => mediaList.some(m => m.id === e.mediaId) && e.aired).length);
  const total = $derived(mediaList.reduce((s, m) => s + (m.totalEpisodes ?? 0), 0) || null);
</script>

{#if contextMenu}
  <div role="presentation" class="fixed inset-0 z-50" onclick={() => contextMenu = null}>
    <div
      class="absolute bg-zinc-800 border border-zinc-700 rounded-lg py-1 shadow-xl min-w-[160px]"
      style="left:{contextMenu.x}px;top:{contextMenu.y}px"
    >
      <button
        class="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        onclick={async () => { await syncMedia(contextMenu!.mediaId); contextMenu = null; }}
      >Force sync</button>
      <a
        href="{base}/anime/{contextMenu.mediaId}"
        class="block px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        onclick={() => contextMenu = null}
      >Go to anime page</a>
      <button
        class="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-700"
        onclick={() => { removeMediaFromCollection(collectionId, contextMenu!.mediaId); contextMenu = null; }}
      >Remove from collection</button>
    </div>
  </div>
{/if}

<ConfirmDialog
  open={confirmDelete}
  title="Delete collection"
  message="Delete &quot;{collection?.name}&quot;? Anime in your library will not be affected."
  onconfirm={handleDelete}
  oncancel={() => confirmDelete = false}
/>

<div class="p-4 md:p-6 space-y-6">
  <!-- Back -->
  <a href="{base}/collections" class="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1">
    ← Collections
  </a>

  {#if !collection}
    <p class="text-zinc-500">Collection not found.</p>
  {:else}
    <!-- Title -->
    <div class="flex items-start gap-4">
      <div class="flex-1 min-w-0">
        {#if editing}
          <div class="space-y-2">
            <input
              class="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-lg font-bold text-white outline-none focus:border-zinc-500"
              bind:value={nameInput}
              placeholder="Collection name"
            />
            <input
              class="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-zinc-300 outline-none focus:border-zinc-500"
              bind:value={originalInput}
              placeholder="Original name (optional)"
            />
            <div class="flex gap-2">
              <button class="text-sm px-4 py-1.5 rounded-lg text-white transition-colors" style="background:var(--accent)" onclick={saveEdit}>Save</button>
              <button class="text-sm px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors" onclick={cancelEdit}>Cancel</button>
            </div>
          </div>
        {:else}
          <div class="flex items-start gap-3">
            <div class="flex-1">
              <h1 class="text-2xl font-bold text-white">{collection.name}</h1>
              {#if collection.originalName}
                <p class="text-sm text-zinc-400 mt-0.5">{collection.originalName}</p>
              {/if}
            </div>
            <button class="text-sm text-zinc-500 hover:text-zinc-300 mt-1" onclick={startEdit}>Edit</button>
          </div>
        {/if}
      </div>

      <button
        class="text-sm px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-800/40 hover:border-red-600 text-red-400 transition-colors shrink-0 mt-1"
        onclick={() => confirmDelete = true}
      >Delete</button>
    </div>

    <!-- Progress -->
    {#if mediaList.length > 0}
      <ProgressBar {watched} {aired} {total} showLabel />
    {/if}

    <!-- Current media -->
    <div class="border border-border rounded-xl p-4 space-y-3">
      <h3 class="text-sm font-semibold text-zinc-300">Titles in this collection</h3>

      <!-- Current title list -->
      {#if mediaList.length > 0}
        <div class="space-y-2 pt-1">
          {#each mediaList as m (m.id)}
            <div class="flex items-center gap-2 p-2 rounded-lg bg-zinc-800/50">
              {#if m.coverImageMedium}
                <img src={m.coverImageMedium} alt="" class="w-8 h-11 object-cover rounded" loading="lazy" />
              {/if}
              <span class="flex-1 text-sm text-zinc-200 truncate">{getTitle(m, appData.settings.titleLanguage)}</span>
              <a href="{base}/anime/{m.id}" class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">↗</a>
              <button
                class="text-xs text-red-500 hover:text-red-400 transition-colors"
                onclick={() => removeMediaFromCollection(collectionId, m.id)}
              >×</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Sort toggle -->
    {#if mediaList.length > 0}
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

      <EpisodeTable
        {mediaList}
        {newestFirst}
        onContextMenu={(e, mediaId) => contextMenu = { x: e.clientX, y: e.clientY, mediaId }}
      />
    {:else}
      <div class="text-center py-10 text-zinc-500 text-sm">
        Add anime to this collection to track episodes.
      </div>
    {/if}
  {/if}
</div>
