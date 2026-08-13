<script lang="ts">
  import './layout.css';
  import favicon from '$lib/assets/favicon.svg';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import type { Window as TauriWindow } from '@tauri-apps/api/window';
  import { isTauri } from '@tauri-apps/api/core';
  import { fs, initFile } from '$lib/store.svelte.js';
  import NotificationOverlay from '$lib/components/NotificationOverlay.svelte';
  import { initSources } from '$lib/sources.svelte.js';

  let { children } = $props();

  $effect(() => {
    initFile();
    initSources();
  });

  // Keep the Collections implementation available while its page is being reworked.
  // Flip this back to true to restore it to the primary navigation.
  const collectionsPageVisible = false;

  const navItems = [
    { href: '/',            label: 'Watchlist'   },
    { href: '/library',     label: 'Library'     },
    { href: '/search',      label: 'Search'      },
    ...(collectionsPageVisible ? [{ href: '/collections', label: 'Collections' }] : []),
    { href: '/settings',    label: 'Settings'    },
  ];

  let desktopWindow = $state<TauriWindow | null>(null);

  onMount(() => {
    if (!isTauri()) return;
    // Let the window module finish initializing before its constructor is used.
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      desktopWindow = getCurrentWindow();
    });
  });

  const current = $derived(page.route.id);
  const navIconPaths: Record<string, string[]> = {
    srch: ['M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.197 5.197a7.5 7.5 0 0 0 10.606 10.606Z'],
    lib:  ['M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25'],
    play: ['M5.25 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.285l-11.54 6.347c-1.25.688-2.779-.217-2.779-1.643V5.653Z'],
    grid: ['M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z'],
    set:  ['M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  };

  function isActive(href: string): boolean {
    if (href === '/') return current === '/' || current === '/watchlist';
    return current === href || current?.startsWith(`${href}/`) === true;
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>PLATYPUS</title>
</svelte:head>

{#if fs.status !== 'ready'}
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[#09090b] p-6">
    <div class="w-full max-w-sm space-y-6 text-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl text-white shadow-xl"
             style="background: var(--accent)">P</div>
        <h1 class="text-2xl font-black tracking-widest text-white">PLATYPUS</h1>
      </div>

      {#if fs.status === 'initializing'}
        <p class="text-zinc-500 text-sm animate-pulse">Loading...</p>

      {:else if fs.status === 'error'}
        <div class="space-y-3">
          <p class="text-red-400 text-sm">{fs.saveError || 'Something went wrong.'}</p>
          <button
            class="w-full py-3 rounded-xl text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            onclick={initFile}
          >Retry</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<div class="flex h-screen flex-col overflow-hidden bg-[#09090b]">
  <header data-tauri-drag-region class="flex h-14 shrink-0 select-none items-stretch border-b border-border bg-surface">
    <a href="{base}/" class="flex shrink-0 items-center gap-2.5 border-r border-border px-3 sm:px-4" aria-label="PLATYPUS Watchlist">
      <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white shadow-lg">P</span>
      <span class="hidden text-sm font-black tracking-widest text-white xl:inline">PLATYPUS</span>
    </a>

    <nav data-tauri-drag-region class="flex min-w-0 flex-1 items-stretch overflow-x-auto" aria-label="Primary navigation">
      {#each navItems as item}
        <a
          href="{base}{item.href}"
          aria-current={isActive(item.href) ? 'page' : undefined}
          class="relative flex shrink-0 items-center border-b-2 px-3 text-sm transition-colors sm:px-4
            {isActive(item.href)
              ? 'border-accent bg-accent/10 font-medium text-accent'
              : 'border-transparent text-zinc-500 hover:border-zinc-600 hover:bg-zinc-800/40 hover:text-zinc-200'}"
        >{item.label}</a>
      {/each}
    </nav>

    {#if fs.isSaving || fs.saveError}
      <div class="hidden shrink-0 items-center border-l border-border px-3 text-[10px] sm:flex {fs.saveError ? 'text-red-400' : 'text-zinc-600'}">
        {fs.saveError ? 'Save error' : 'Saving…'}
      </div>
    {/if}

    {#if desktopWindow}
      <div class="flex shrink-0 items-stretch border-l border-border" aria-label="Window controls">
        <button
          class="flex w-11 items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-700/70 hover:text-white"
          title="Minimize"
          aria-label="Minimize window"
          onclick={() => void desktopWindow.minimize()}
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true">
            <path d="M3 11.5h10" />
          </svg>
        </button>
        <button
          class="flex w-11 items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-700/70 hover:text-white"
          title="Maximize or restore"
          aria-label="Maximize or restore window"
          onclick={() => void desktopWindow.toggleMaximize()}
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true">
            <rect x="3.25" y="3.25" width="9.5" height="9.5" />
          </svg>
        </button>
        <button
          class="flex w-11 items-center justify-center text-zinc-500 transition-colors hover:bg-red-600 hover:text-white"
          title="Close"
          aria-label="Close window"
          onclick={() => void desktopWindow.close()}
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true">
            <path d="m3.5 3.5 9 9m0-9-9 9" />
          </svg>
        </button>
      </div>
    {/if}
  </header>

  <main class="min-h-0 flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>

<NotificationOverlay />
