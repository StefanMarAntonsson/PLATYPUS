import type { Action } from "svelte/action";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Dialogs can stack (e.g. a confirmation over the episode sidebar). Only the
// most recently opened one handles Tab and Escape.
const openDialogs: HTMLElement[] = [];

export interface DialogFocusOptions {
  /** Called for Escape anywhere in the window while this dialog is on top. */
  onescape?: () => void;
  /** Selector for the element to focus first; defaults to the first focusable. */
  initialFocus?: string;
}

/**
 * Modal focus handling: move focus into the dialog when it opens, keep Tab
 * inside it, close it on Escape wherever focus is, and return focus to the
 * element that opened it.
 */
export const dialogFocus: Action<HTMLElement, DialogFocusOptions | undefined> = (
  node,
  options = {},
) => {
  let current = options;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  openDialogs.push(node);

  const focusable = () =>
    [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.getClientRects().length > 0,
    );

  if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
  const initial =
    (current.initialFocus ? node.querySelector<HTMLElement>(current.initialFocus) : null) ??
    focusable()[0] ??
    node;
  initial.focus({ preventScroll: true });

  const onKeydown = (event: KeyboardEvent) => {
    if (openDialogs.at(-1) !== node) return;
    if (event.key === "Escape" && current.onescape) {
      event.preventDefault();
      event.stopPropagation();
      current.onescape();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    const active = document.activeElement;
    if (items.length === 0) {
      event.preventDefault();
      node.focus();
    } else if (!node.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    } else if (event.shiftKey && active === items[0]) {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (!event.shiftKey && active === items[items.length - 1]) {
      event.preventDefault();
      items[0].focus();
    }
  };
  // Capture phase, so the top dialog's Escape wins over page-level shortcuts.
  document.addEventListener("keydown", onKeydown, true);

  return {
    update(next = {}) {
      current = next;
    },
    destroy() {
      document.removeEventListener("keydown", onKeydown, true);
      const index = openDialogs.indexOf(node);
      if (index >= 0) openDialogs.splice(index, 1);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    },
  };
};

/**
 * Fade an image in once it has loaded instead of letting it pop in. Images
 * that are already cached show immediately.
 */
export const fadeInOnLoad: Action<HTMLImageElement> = (image) => {
  if (image.complete) return;
  image.classList.add("fade-in-image");
  image.dataset.loading = "";
  const done = () => delete image.dataset.loading;
  image.addEventListener("load", done, { once: true });
  image.addEventListener("error", done, { once: true });
  return {
    destroy() {
      image.removeEventListener("load", done);
      image.removeEventListener("error", done);
    },
  };
};
