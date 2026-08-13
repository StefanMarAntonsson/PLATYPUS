<script lang="ts">
  import type { NotificationKind } from '$lib/notifications.svelte.js';
  import { notifications, dismiss, dismissAll } from '$lib/notifications.svelte.js';

  // Per-kind accent: left border + icon color. Neutral zinc card body so these
  // read consistently against the app's dark surfaces.
  const styles: Record<NotificationKind, { border: string; icon: string; glyph: string }> = {
    info:    { border: 'border-l-sky-500',     icon: 'text-sky-400',     glyph: 'ⓘ' },
    success: { border: 'border-l-emerald-500', icon: 'text-emerald-400', glyph: '✓' },
    warning: { border: 'border-l-amber-500',   icon: 'text-amber-400',   glyph: '!' },
    error:   { border: 'border-l-red-500',     icon: 'text-red-400',     glyph: '×' },
  };
</script>

{#if notifications.length > 0}
  <div class="fixed top-3 right-3 z-[90] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2">
    {#if notifications.length > 1}
      <div class="flex justify-end">
        <button
          class="rounded-md bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-400 backdrop-blur transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          onclick={dismissAll}
        >Dismiss all ({notifications.length})</button>
      </div>
    {/if}

    <div class="flex max-h-[calc(100vh-5rem)] flex-col gap-2 overflow-y-auto">
      {#each notifications as n (n.id)}
        {@const s = styles[n.kind]}
        <div
          role="alert"
          class="flex items-start gap-2.5 rounded-lg border border-border border-l-4 {s.border} bg-surface/95 p-3 shadow-lg backdrop-blur"
        >
          <span class="mt-0.5 shrink-0 text-sm font-bold {s.icon}" aria-hidden="true">{s.glyph}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-zinc-100">{n.title}</p>
            {#if n.message}
              <p class="mt-0.5 break-words text-xs text-zinc-400">{n.message}</p>
            {/if}
          </div>
          <button
            class="-mr-1 -mt-1 shrink-0 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
            title="Dismiss"
            aria-label="Dismiss notification"
            onclick={() => dismiss(n.id)}
          >×</button>
        </div>
      {/each}
    </div>
  </div>
{/if}
