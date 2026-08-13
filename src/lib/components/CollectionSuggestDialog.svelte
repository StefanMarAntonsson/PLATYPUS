<script lang="ts">
  import { appData, createCollection, addMediaToCollection, updateCollection } from '$lib/store.svelte.js';
  import { getTitle } from '$lib/utils.js';

  interface Props {
    mediaId: number;
    onclose: () => void;
  }
  let { mediaId, onclose }: Props = $props();

  const media = $derived(appData.media.find(m => m.id === mediaId));
  const lang = $derived(appData.settings.titleLanguage);

  const existingCollections = $derived(appData.collections);

  const mediaCollectionIds = $derived(
    new Set(appData.collectionEntries.filter(e => e.mediaId === mediaId).map(e => e.collectionId))
  );

  let newName = $state('');
  let creating = $state(false);

  function addToExisting(collectionId: number) {
    addMediaToCollection(collectionId, mediaId);
    onclose();
  }

  function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    const collection = createCollection(name);
    if (media) updateCollection(collection.id, { coverMediaId: mediaId });
    addMediaToCollection(collection.id, mediaId);
    onclose();
  }
</script>

<div role="presentation" class="fixed inset-0 z-50 flex items-center justify-center p-4" onclick={onclose} onkeydown={e => e.key === 'Escape' && onclose()}>
  <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
  <div
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    class="relative bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-sm shadow-2xl space-y-4"
    onclick={e => e.stopPropagation()}
    onkeydown={e => e.stopPropagation()}
  >
    <div>
      <h2 class="text-base font-semibold text-white">Add to a Collection?</h2>
      {#if media}
        <p class="text-xs text-zinc-400 mt-0.5">{getTitle(media, lang)}</p>
      {/if}
    </div>

    {#if existingCollections.length > 0}
      <div class="space-y-1.5 max-h-48 overflow-y-auto">
        {#each existingCollections as s (s.id)}
          {@const alreadyIn = mediaCollectionIds.has(s.id)}
          <button
            class="w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors
              {alreadyIn
                ? 'border-accent/30 text-accent bg-accent/10 cursor-default'
                : 'border-border text-zinc-300 hover:border-zinc-500 bg-surface-2'}"
            onclick={() => !alreadyIn && addToExisting(s.id)}
            disabled={alreadyIn}
          >
            {s.name}
            {#if alreadyIn}<span class="text-xs opacity-60 ml-1">✓ added</span>{/if}
          </button>
        {/each}
      </div>
    {/if}

    <div class="space-y-2">
      <p class="text-xs text-zinc-500 font-medium uppercase tracking-wide">New collection</p>
      <div class="flex gap-2">
        <input
          class="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-accent/50 placeholder:text-zinc-600"
          placeholder="Collection name…"
          bind:value={newName}
          onkeydown={e => e.key === 'Enter' && createAndAdd()}
        />
        <button
          class="px-3 py-1.5 text-sm rounded-lg bg-accent text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
          onclick={createAndAdd}
          disabled={!newName.trim()}
        >Create</button>
      </div>
    </div>

    <button
      class="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1"
      onclick={onclose}
    >Skip</button>
  </div>
</div>
