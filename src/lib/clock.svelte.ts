// A shared, coarse clock for relative-time labels such as "in 5m" and
// "Synced 2m ago". Reading `clock.now` in a template re-renders that label
// every minute instead of only when unrelated state happens to change.

const TICK_MS = 60_000;

export const clock = $state({ now: Date.now() });

if (typeof window !== "undefined") {
  setInterval(() => {
    clock.now = Date.now();
  }, TICK_MS);
}
