import type { UnifiedSearchGroup } from "$lib/sources.svelte.js";

// Survives navigation within the session so the complete unified result rows
// are still visible when returning from a media details page.
export const searchState = $state({
  query: "",
  sourceGroups: [] as UnifiedSearchGroup[],
});

export const sourceQueryCache = new Map<string, UnifiedSearchGroup[]>();
