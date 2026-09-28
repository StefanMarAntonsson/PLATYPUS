import type { ExternalLink, LibraryEntry } from "./types.js";

export interface WatchOption {
  name: string;
  url: string;
  /** Brand color from the source, e.g. "#F88B24"; null uses the app accent. */
  color: string | null;
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(color: unknown): string | null {
  return typeof color === "string" && HEX_COLOR.test(color.trim()) ? color.trim() : null;
}

interface KnownPlatform {
  name: string;
  color: string;
  domains: string[];
}

/** Streaming platforms recognized by URL, with AniList's brand colors. Sources
 * without names or colors for their links (Kitsu, TVmaze) are filled in from here. */
const KNOWN_PLATFORMS: KnownPlatform[] = [
  { name: "Crunchyroll", color: "#F88B24", domains: ["crunchyroll.com"] },
  { name: "Netflix", color: "#E50914", domains: ["netflix.com"] },
  { name: "Hulu", color: "#1CE783", domains: ["hulu.com"] },
  { name: "YouTube", color: "#FF0000", domains: ["youtube.com", "youtu.be"] },
  { name: "Bilibili TV", color: "#00A1D6", domains: ["bilibili.tv"] },
  { name: "Bilibili", color: "#00A1D6", domains: ["bilibili.com"] },
  { name: "iQ", color: "#00CC36", domains: ["iq.com"] },
  {
    name: "Amazon Prime Video",
    color: "#FF9900",
    domains: ["primevideo.com", "amazon.com", "amazon.co.jp"],
  },
  { name: "Max", color: "#002BE7", domains: ["max.com", "hbomax.com"] },
  { name: "Tubi TV", color: "#7408FF", domains: ["tubitv.com"] },
  { name: "HIDIVE", color: "#03AEEF", domains: ["hidive.com"] },
  { name: "Adult Swim", color: "#000000", domains: ["adultswim.com"] },
  { name: "Disney Plus", color: "#21037C", domains: ["disneyplus.com"] },
  { name: "Funimation", color: "#5B0BB5", domains: ["funimation.com"] },
  { name: "WeTV", color: "#2FA3F9", domains: ["wetv.vip"] },
  { name: "Tencent Video", color: "#2FA3F9", domains: ["v.qq.com"] },
  { name: "Hoopla", color: "#0D69C0", domains: ["hoopladigital.com"] },
  { name: "RetroCrush", color: "#272829", domains: ["retrocrush.tv"] },
  { name: "Niconico Video", color: "#252525", domains: ["nicovideo.jp"] },
];

function knownPlatform(url: string): KnownPlatform | null {
  const host = new URL(url).hostname.toLowerCase();
  return (
    KNOWN_PLATFORMS.find((platform) =>
      platform.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    ) ?? null
  );
}

/**
 * Streaming links from a source's `streamingLinks` mapping. The value is
 * provider data: a URL, an object with `url` and optional `site`, `type`, and
 * `color`, or an array of either. Links typed as something other than
 * STREAMING are dropped, and untyped links must be on a known platform, so a
 * show's official website is not mistaken for a place to watch it.
 */
export function streamingLinksFrom(value: unknown): ExternalLink[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [value]).flatMap((item) => {
    const record: Record<string, unknown> =
      typeof item === "string" ? { url: item } : item && typeof item === "object" ? item : {};
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!isWatchUrl(url) || seen.has(url)) return [];
    const type = typeof record.type === "string" ? record.type.trim().toUpperCase() : "";
    const known = knownPlatform(url);
    if (type ? type !== "STREAMING" : !known) return [];
    seen.add(url);
    const site = typeof record.site === "string" ? record.site.trim() : "";
    return [
      {
        url,
        site: site || known?.name || new URL(url).hostname,
        type: "STREAMING",
        color: normalizeColor(record.color) ?? known?.color ?? null,
        icon: null,
      },
    ];
  });
}

/** Add newly found streaming links; existing links are kept, since a source
 * that stops listing a platform is more often incomplete than correct. */
export function mergeStreamingLinks(
  existing: ExternalLink[],
  found: ExternalLink[],
): { links: ExternalLink[]; added: number } {
  const links = [...(existing ?? [])];
  let added = 0;
  for (const link of found) {
    const index = links.findIndex((current) => current.url === link.url);
    if (index === -1) {
      links.push(link);
      added++;
    } else if (!links[index].color && link.color) {
      links[index] = { ...links[index], color: link.color };
    }
  }
  return { links, added };
}

function relativeLuminance(hex: string): number {
  const digits =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((d) => d + d)
      : hex.slice(1).match(/../g)!;
  const [r, g, b] = digits.map((d) => {
    const c = parseInt(d, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Inline style for a watch button in the platform's color, with readable text.
 * Near-black brand colors get a light outline so they stand out on the dark UI. */
export function watchButtonStyle(color: string | null): string {
  if (!color) return "";
  const luminance = relativeLuminance(color);
  const text = luminance > 0.4 ? "#18181b" : "#ffffff";
  const outline = luminance < 0.03 ? "; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25)" : "";
  return `background-color: ${color}; color: ${text}${outline}`;
}

export function isWatchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

/** Provider order is the API's default order. Ignore malformed and duplicate URLs. */
export function watchOptions(links: ExternalLink[]): WatchOption[] {
  const seen = new Set<string>();
  return (links ?? [])
    .filter((link) => {
      if (link.type !== "STREAMING" || !isWatchUrl(link.url) || seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    })
    .map((link) => ({
      name: link.site?.trim() || new URL(link.url).hostname,
      url: link.url,
      color: normalizeColor(link.color) ?? knownPlatform(link.url)?.color ?? null,
    }));
}

export function selectedWatchOption(
  links: ExternalLink[],
  entry?: LibraryEntry,
): WatchOption | null {
  const options = watchOptions(links);
  const choice = entry?.watchDestination;
  if (choice?.kind === "custom") {
    if (!isWatchUrl(choice.url)) return null;
    const name = choice.name.trim() || new URL(choice.url).hostname;
    // A custom entry named after a known platform borrows that platform's color.
    const known = options.find((option) => option.name.toLowerCase() === name.toLowerCase());
    return {
      name,
      url: choice.url,
      color: known?.color ?? knownPlatform(choice.url)?.color ?? null,
    };
  }
  if (choice?.kind === "provider") {
    return options.find((option) => option.url === choice.url) ?? options[0] ?? null;
  }
  return options[0] ?? null;
}
