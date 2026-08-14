<script lang="ts">
  import { createManualMedia } from '$lib/store.svelte.js';
  import type { MediaKind } from '$lib/types.js';

  interface Props {
    onclose: () => void;
    oncreated: (mediaId: number) => void;
  }

  let { onclose, oncreated }: Props = $props();

  let title = $state('');
  let kind = $state<MediaKind>('movie');
  let year = $state('');
  let totalEpisodes = $state('');
  let description = $state('');
  let coverImage = $state<string | null>(null);
  let error = $state('');
  let titleInput = $state<HTMLInputElement | null>(null);
  let coverInput = $state<HTMLInputElement | null>(null);

  const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_COVER_BYTES = 5 * 1024 * 1024;

  $effect(() => {
    titleInput?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onclose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  });

  function chooseCover(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;

    if (!COVER_TYPES.includes(file.type)) {
      error = 'Choose a JPEG, PNG, or WebP cover image.';
      if (coverInput) coverInput.value = '';
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      error = 'Cover images must be 5 MB or smaller.';
      if (coverInput) coverInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        error = 'Could not read that cover image.';
        return;
      }
      coverImage = reader.result;
      error = '';
    };
    reader.onerror = () => {
      error = 'Could not read that cover image.';
    };
    reader.readAsDataURL(file);
  }

  function removeCover() {
    coverImage = null;
    if (coverInput) coverInput.value = '';
  }

  function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      error = 'A title is required.';
      return;
    }

    const parsedYear = year === '' ? null : Number(year);
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1800 || parsedYear > 3000)) {
      error = 'Enter a valid release year.';
      return;
    }

    const parsedEpisodes = kind === 'series' && totalEpisodes !== '' ? Number(totalEpisodes) : null;
    if (parsedEpisodes !== null && (!Number.isInteger(parsedEpisodes) || parsedEpisodes < 1)) {
      error = 'Episode count must be a positive whole number.';
      return;
    }

    const media = createManualMedia({
      title: trimmedTitle,
      kind,
      year: parsedYear,
      totalEpisodes: parsedEpisodes,
      description,
      coverImage,
    });
    oncreated(media.id);
  }
</script>

<button
  class="fixed inset-0 z-[80] cursor-default bg-black/70 backdrop-blur-sm"
  aria-label="Close add media dialog"
  onclick={onclose}
></button>
<div class="fixed inset-0 z-[81] flex items-center justify-center p-4 pointer-events-none">
  <div
    class="pointer-events-auto max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-labelledby="add-media-title"
  >
    <div class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 id="add-media-title" class="font-semibold text-white">Add media manually</h2>
        <p class="mt-1 text-xs text-zinc-500">Track something even when it is not available from a configured source.</p>
      </div>
      <button class="text-xl leading-none text-zinc-500 transition-colors hover:text-white" aria-label="Close" onclick={onclose}>×</button>
    </div>

    <form class="space-y-4 px-5 py-4" onsubmit={(event) => { event.preventDefault(); submit(); }}>
      <label class="block text-xs font-medium text-zinc-400">
        Title
        <input
          bind:this={titleInput}
          bind:value={title}
          class="mt-1.5 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-accent"
          placeholder="Movie or series title"
          oninput={() => error = ''}
        />
      </label>

      <fieldset>
        <legend class="mb-1.5 text-xs font-medium text-zinc-400">Type</legend>
        <div class="inline-flex rounded-lg bg-zinc-900/90 p-1" role="group">
          {#each (['movie', 'series'] as MediaKind[]) as option}
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-all {kind === option ? 'bg-accent text-white' : 'text-zinc-500 hover:text-zinc-200'}"
              onclick={() => { kind = option; error = ''; }}
            >{option}</button>
          {/each}
        </div>
      </fieldset>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium text-zinc-400">
          Release year <span class="font-normal text-zinc-600">(optional)</span>
          <input
            bind:value={year}
            class="mt-1.5 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-accent"
            type="number"
            min="1800"
            max="3000"
            placeholder="2026"
            oninput={() => error = ''}
          />
        </label>
        {#if kind === 'series'}
          <label class="block text-xs font-medium text-zinc-400">
            Episodes <span class="font-normal text-zinc-600">(optional)</span>
            <input
              bind:value={totalEpisodes}
              class="mt-1.5 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-accent"
              type="number"
              min="1"
              placeholder="8"
              oninput={() => error = ''}
            />
          </label>
        {/if}
      </div>

      <fieldset>
        <legend class="mb-1.5 text-xs font-medium text-zinc-400">Cover image <span class="font-normal text-zinc-600">(optional)</span></legend>
        <div class="flex items-center gap-3">
          <div class="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2 text-xl text-zinc-600">
            {#if coverImage}
              <img class="h-full w-full object-cover" src={coverImage} alt="Selected cover preview" />
            {:else}
              ◈
            {/if}
          </div>
          <div>
            <input
              class="hidden"
              bind:this={coverInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onchange={chooseCover}
            />
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
                onclick={() => coverInput?.click()}
              >{coverImage ? 'Replace image' : 'Choose image…'}</button>
              {#if coverImage}
                <button type="button" class="px-2 py-2 text-sm text-zinc-500 hover:text-red-400" onclick={removeCover}>Remove</button>
              {/if}
            </div>
            <p class="mt-2 text-xs text-zinc-600">JPEG, PNG, or WebP · up to 5 MB</p>
          </div>
        </div>
      </fieldset>

      <label class="block text-xs font-medium text-zinc-400">
        Notes <span class="font-normal text-zinc-600">(optional)</span>
        <textarea
          bind:value={description}
          class="mt-1.5 min-h-24 w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-accent"
          placeholder="Anything you want to remember about this title"
        ></textarea>
      </label>

      {#if error}<p class="text-sm text-red-400" role="alert">{error}</p>{/if}

      <div class="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" class="rounded-md border border-border bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white" onclick={onclose}>Cancel</button>
        <button type="submit" class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">Add to library</button>
      </div>
    </form>
  </div>
</div>
