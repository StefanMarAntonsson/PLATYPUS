import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  AUTO_DISMISS_MS,
  dismissAll,
  notifications,
  notify,
  pauseAutoDismiss,
  resumeAutoDismiss,
} from "./notifications.svelte.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dismissAll();
  vi.useRealTimers();
});

test("success and info notifications close themselves", () => {
  notify("success", "Saved");
  notify("info", "FYI");
  expect(notifications).toHaveLength(2);
  vi.advanceTimersByTime(AUTO_DISMISS_MS);
  expect(notifications).toHaveLength(0);
});

test("warnings and errors stay until dismissed", () => {
  notify("warning", "Careful");
  notify("error", "Broken");
  vi.advanceTimersByTime(AUTO_DISMISS_MS * 5);
  expect(notifications.map((n) => n.kind)).toEqual(["warning", "error"]);
});

test("hovering a toast pauses its timer", () => {
  const id = notify("success", "Saved");
  vi.advanceTimersByTime(AUTO_DISMISS_MS - 100);
  pauseAutoDismiss(id);
  vi.advanceTimersByTime(AUTO_DISMISS_MS * 2);
  expect(notifications).toHaveLength(1);
  resumeAutoDismiss(id);
  vi.advanceTimersByTime(AUTO_DISMISS_MS);
  expect(notifications).toHaveLength(0);
});
