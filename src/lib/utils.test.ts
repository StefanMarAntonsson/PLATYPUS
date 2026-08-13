import { expect, test, vi, beforeEach, afterEach } from "vite-plus/test";
import { formatCountdown, isOnBreak, streamingIconUrl, streamingSiteFromUrl } from "./utils.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Anchor "now" to a fixed local Thursday noon so the today/clock branch is deterministic.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

test("formatCountdown handles empty and past times", () => {
  expect(formatCountdown(null)).toBe("");
  expect(formatCountdown(Date.now() - 1000)).toBe("airing now");
});

test("formatCountdown shows minutes and hours", () => {
  expect(formatCountdown(Date.now() + 30 * 60_000)).toBe("in 30m");
  // 20h from noon lands on the next calendar day -> hours, not clock time.
  expect(formatCountdown(Date.now() + 20 * HOUR)).toBe("in 20h");
});

test("formatCountdown shows clock time for later today", () => {
  // Noon + 3h is still the same day -> "today HH:MM".
  expect(formatCountdown(Date.now() + 3 * HOUR)).toMatch(/^today /);
});

test("formatCountdown shows days for multi-day waits", () => {
  expect(formatCountdown(Date.now() + 2 * DAY)).toBe("in 2d");
  expect(formatCountdown(Date.now() + 12 * DAY)).toBe("in 12d");
});

test("isOnBreak is true only beyond a week out", () => {
  expect(isOnBreak(null)).toBe(false);
  expect(isOnBreak(Date.now() + 3 * DAY)).toBe(false);
  expect(isOnBreak(Date.now() + 8 * DAY)).toBe(true);
});

test("streaming platform icons use Dashboard Icons CDN filenames", () => {
  expect(streamingSiteFromUrl("https://www.crunchyroll.com/series/example")).toBe("crunchyroll");
  expect(streamingIconUrl("https://www.crunchyroll.com/series/example")).toBe(
    "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/crunchyroll.svg",
  );
  expect(streamingIconUrl("https://www.primevideo.com/detail/example")).toContain(
    "/amazon-prime.svg",
  );
  expect(streamingIconUrl("https://www.hidive.com/video/example")).toBeNull();
});
