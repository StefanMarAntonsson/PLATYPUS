<script lang="ts">
  interface Props {
    watched: number;
    aired: number;
    total: number | null;
    showLabel?: boolean;
  }
  let { watched, aired, total, showLabel = false }: Props = $props();

  const watchedPct = $derived(aired > 0 ? Math.round((watched / aired) * 100) : 0);
  const airedPct = $derived(total && total > 0 ? Math.round((aired / total) * 100) : 100);
</script>

<div class="space-y-1">
  {#if showLabel}
    <div class="flex justify-between text-xs text-white/50">
      <span>{watched} watched</span>
      <span>{aired}{total ? `/${total}` : ''} aired</span>
    </div>
  {/if}
  <div class="h-1.5 rounded-full bg-white/10 overflow-hidden relative">
    <!-- aired bar -->
    <div class="absolute inset-y-0 left-0 bg-white/20 rounded-full transition-all"
         style="width:{airedPct}%"></div>
    <!-- watched bar -->
    <div class="absolute inset-y-0 left-0 rounded-full transition-all"
         style="width:{watchedPct * airedPct / 100}%;background:var(--accent)"></div>
  </div>
</div>
