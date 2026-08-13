<script lang="ts">
  import type { LibraryStatus, MediaStatus } from '$lib/types.js';

  interface Props {
    status: LibraryStatus | MediaStatus | string;
    size?: 'sm' | 'xs';
  }
  let { status, size = 'sm' }: Props = $props();

  const config: Record<string, { label: string; class: string }> = {
    WATCHING:       { label: 'Watching',      class: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    REWATCHING:     { label: 'Rewatching',    class: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    COMPLETED:      { label: 'Completed',     class: 'bg-green-500/20 text-green-300 border-green-500/30' },
    PLAN_TO_WATCH:  { label: 'Planned',       class: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' },
    PAUSED:         { label: 'Paused',        class: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    DROPPED:        { label: 'Dropped',       class: 'bg-red-500/20 text-red-300 border-red-500/30' },
    FINISHED:       { label: 'Finished',      class: 'bg-green-500/20 text-green-300 border-green-500/30' },
    RELEASING:      { label: 'Airing',        class: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
    NOT_YET_RELEASED: { label: 'Upcoming',   class: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
    HIATUS:         { label: 'Hiatus',        class: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    CANCELLED:      { label: 'Cancelled',     class: 'bg-red-500/20 text-red-300 border-red-500/30' },
  };

  const cfg = $derived(config[status] ?? { label: status, class: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' });
  const sizeClass = $derived(size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5');
</script>

<span class="inline-flex items-center rounded border font-medium {sizeClass} {cfg.class}">
  {cfg.label}
</span>
