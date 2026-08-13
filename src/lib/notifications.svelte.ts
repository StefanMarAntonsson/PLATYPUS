// Session-only notifications surfaced in the app's overlay. These are transient
// by nature (sync results, errors, info) and deliberately NOT written to the
// persisted data file.

export type NotificationKind = "info" | "success" | "warning" | "error";

export interface Notification {
  id: number;
  kind: NotificationKind;
  title: string;
  message?: string;
  createdAt: number;
}

export const notifications = $state<Notification[]>([]);

let _nextId = 1;

export function notify(kind: NotificationKind, title: string, message?: string): number {
  const id = _nextId++;
  notifications.push({ id, kind, title, message, createdAt: Date.now() });
  return id;
}

export function dismiss(id: number): void {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx >= 0) notifications.splice(idx, 1);
}

export function dismissAll(): void {
  notifications.splice(0, notifications.length);
}
