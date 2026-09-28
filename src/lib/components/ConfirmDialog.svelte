<script lang="ts">
  import { dialogFocus } from '$lib/actions.js';

  interface Props {
    open: boolean;
    title?: string;
    message?: string;
    confirmLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  }
  let {
    open, title = 'Confirm', message = 'Are you sure?',
    confirmLabel = 'Delete', onconfirm, oncancel,
  }: Props = $props();

  const titleId = `confirm-title-${Math.random().toString(36).slice(2)}`;
</script>

{#if open}
  <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
    <button class="absolute inset-0 cursor-default bg-black/70" tabindex="-1" aria-label="Cancel" onclick={oncancel}></button>
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      class="relative bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-sm shadow-2xl"
      use:dialogFocus={{ onescape: oncancel, initialFocus: '[data-autofocus]' }}
    >
      <h2 id={titleId} class="text-base font-semibold text-white mb-2">{title}</h2>
      <p class="text-sm text-zinc-400 mb-6">{message}</p>
      <div class="flex gap-3 justify-end">
        <button
          class="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          data-autofocus
          onclick={oncancel}
        >Cancel</button>
        <button
          class="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
          onclick={onconfirm}
        >{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
