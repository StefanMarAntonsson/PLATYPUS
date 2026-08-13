<script lang="ts">
  interface Props {
    progress: number;
    size?: number;
    stroke?: number;
    label?: string;
  }
  let { progress, size = 52, stroke = 4, label }: Props = $props();

  const r = $derived((size - stroke) / 2);
  const circ = $derived(2 * Math.PI * r);
  const offset = $derived(circ * (1 - Math.min(Math.max(progress, 0), 100) / 100));
  const cx = $derived(size / 2);
</script>

<div class="relative inline-flex items-center justify-center" style="width:{size}px;height:{size}px">
  <svg width={size} height={size} class="-rotate-90 absolute inset-0">
    <circle cx={cx} cy={cx} r={r} stroke="rgba(255,255,255,0.1)" stroke-width={stroke} fill="none" />
    <circle
      cx={cx} cy={cx} r={r}
      stroke="var(--accent)"
      stroke-width={stroke}
      fill="none"
      stroke-dasharray={circ}
      stroke-dashoffset={offset}
      stroke-linecap="round"
      style="transition: stroke-dashoffset 0.3s ease"
    />
  </svg>
  {#if label}
    <span class="text-[9px] font-bold text-white/80 leading-none text-center px-0.5 z-10">{label}</span>
  {/if}
</div>
