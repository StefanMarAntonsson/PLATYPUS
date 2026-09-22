// Svelte's JS-driven transitions ignore the CSS `prefers-reduced-motion`
// override in layout.css, so components scale their durations through this.

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Return `ms`, or 0 when the user has asked the system to reduce motion. */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
