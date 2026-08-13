<script lang="ts">
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
</script>

{#if open}
  <div role="presentation" class="fixed inset-0 z-50 flex items-center justify-center p-4" onclick={oncancel} onkeydown={e => e.key === 'Escape' && oncancel()}>
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
    <div
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      class="relative bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-sm shadow-2xl"
      onclick={e => e.stopPropagation()}
      onkeydown={e => e.stopPropagation()}
    >
      <h2 class="text-base font-semibold text-white mb-2">{title}</h2>
      <p class="text-sm text-zinc-400 mb-6">{message}</p>
      <div class="flex gap-3 justify-end">
        <button
          class="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
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
