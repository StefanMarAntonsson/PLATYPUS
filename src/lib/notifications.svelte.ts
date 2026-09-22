// Session-only notifications surfaced in the app's overlay. These are transient
// by nature (sync results, errors, info) and deliberately NOT written to the
// persisted data file.

export type NotificationKind = "info" | "success" | "warning" | "error";

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface Notification {
  id: number;
  kind: NotificationKind;
  title: string;
  message?: string;
  action?: NotificationAction;
  createdAt: number;
}

export const notifications = $state<Notification[]>([]);

let _nextId = 1;

/** Success and info toasts close themselves; warnings and errors wait for the user. */
export const AUTO_DISMISS_MS = 4000;
const _timers = new Map<number, ReturnType<typeof setTimeout>>();

function autoDismisses(kind: NotificationKind): boolean {
  return kind === "success" || kind === "info";
}

export function notify(
  kind: NotificationKind,
  title: string,
  message?: string,
  action?: NotificationAction,
): number {
  const id = _nextId++;
  notifications.push({ id, kind, title, message, action, createdAt: Date.now() });
  if (autoDismisses(kind)) resumeAutoDismiss(id);
  return id;
}

/** Keep a toast open while the pointer or keyboard focus is on it. */
export function pauseAutoDismiss(id: number): void {
  clearTimeout(_timers.get(id));
  _timers.delete(id);
}

export function resumeAutoDismiss(id: number): void {
  const notification = notifications.find((n) => n.id === id);
  if (!notification || !autoDismisses(notification.kind)) return;
  pauseAutoDismiss(id);
  _timers.set(
    id,
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
  );
}

export function dismiss(id: number): void {
  pauseAutoDismiss(id);
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx >= 0) notifications.splice(idx, 1);
}

export function dismissAll(): void {
  for (const timer of _timers.values()) clearTimeout(timer);
  _timers.clear();
  notifications.splice(0, notifications.length);
}
