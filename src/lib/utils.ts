import type {
  Media,
  MediaFormat,
  MediaStatus,
  MediaSeason,
  LibraryStatus,
  TitleLanguage,
  WatchSite,
  ExternalLink,
  Episode,
} from "./types.js";

export function getTitle(media: Media, lang: TitleLanguage): string {
  if (lang === "english") return media.titleEnglish ?? media.titleRomaji;
  if (lang === "native") return media.titleNative ?? media.titleRomaji;
  return media.titleRomaji;
}

/** A media item is manual only when it has no identity owned by a sync source. */
export function isManualMedia(media: Media): boolean {
  return media.syncSource === undefined && !media.providerLinks?.length;
}

export function formatLabel(format: MediaFormat): string {
  const map: Record<MediaFormat, string> = {
    TV: "TV",
    TV_SHORT: "TV Short",
    MOVIE: "Movie",
    OVA: "OVA",
    ONA: "ONA",
    SPECIAL: "Special",
    MUSIC: "Music",
  };
  return map[format] ?? format;
}

export function statusLabel(status: MediaStatus): string {
  const map: Record<MediaStatus, string> = {
    FINISHED: "Finished",
    RELEASING: "Airing",
    NOT_YET_RELEASED: "Upcoming",
    HIATUS: "Hiatus",
    CANCELLED: "Cancelled",
  };
  return map[status] ?? status;
}

export function libraryStatusLabel(status: LibraryStatus): string {
  const map: Record<LibraryStatus, string> = {
    PLAN_TO_WATCH: "Plan to Watch",
    WATCHING: "Watching",
    COMPLETED: "Completed",
    PAUSED: "Paused",
    DROPPED: "Dropped",
    REWATCHING: "Rewatching",
  };
  return map[status] ?? status;
}

export function seasonLabel(season: MediaSeason | null, year: number | null): string {
  if (!season && !year) return "";
  const s = season ? season.charAt(0) + season.slice(1).toLowerCase() : "";
  return [s, year].filter(Boolean).join(" ");
}

export function formatAirDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Short return date for a show on a season break, e.g. "Returns Jan 3".
// The year is added only when the date is far enough out to be ambiguous.
export function formatReturnDate(ts: number, now = Date.now()): string {
  const farOut = ts - now > 300 * 86_400_000;
  const date = new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(farOut ? { year: "numeric" } : {}),
  });
  return `Returns ${date}`;
}

export function airWeekday(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { weekday: "long" });
}

export function formatRelativeTime(ts: number | null, now = Date.now()): string {
  if (!ts) return "";
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h`;
  return `${Math.round(abs / 86_400_000)}d`;
}

const WEEK_MS = 7 * 86_400_000;

// Countdown to a future airing time, e.g. "in 3h", "today 20:00", "in 12d".
// Past/imminent times read "airing now".
export function formatCountdown(ts: number | null, now = Date.now()): string {
  if (!ts) return "";
  const diff = ts - now;
  if (diff <= 0) return "airing now";
  if (diff < 3_600_000) return `in ${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) {
    const isToday = new Date(ts).toDateString() === new Date(now).toDateString();
    if (isToday) {
      const clock = new Date(ts).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `today ${clock}`;
    }
    return `in ${Math.round(diff / 3_600_000)}h`;
  }
  return `in ${Math.round(diff / 86_400_000)}d`;
}

// A show is "on a break" when its next episode is more than a week away.
export function isOnBreak(ts: number | null, now = Date.now()): boolean {
  return ts != null && ts - now > WEEK_MS;
}

type StreamingSite = Exclude<WatchSite, "any">;

const STREAMING_DOMAINS: Record<string, StreamingSite> = {
  "crunchyroll.com": "crunchyroll",
  "hidive.com": "hidive",
  "netflix.com": "netflix",
  "amazon.com": "amazon",
  "primevideo.com": "amazon",
  "hulu.com": "hulu",
  "disneyplus.com": "disney",
  "funimation.com": "funimation",
};

const DASHBOARD_ICON_FILENAMES: Partial<Record<StreamingSite, string>> = {
  crunchyroll: "crunchyroll",
  netflix: "netflix",
  amazon: "amazon-prime",
  hulu: "hulu",
  disney: "disney-plus",
};

export function streamingSiteFromUrl(url: string): StreamingSite | null {
  const match = Object.entries(STREAMING_DOMAINS).find(([domain]) => url.includes(domain));
  return match?.[1] ?? null;
}

export function streamingIconUrl(url: string): string | null {
  const site = streamingSiteFromUrl(url);
  const filename = site ? DASHBOARD_ICON_FILENAMES[site] : null;
  return filename
    ? `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${filename}.svg`
    : null;
}

export function findStreamingLink(links: ExternalLink[], preferred: WatchSite): string | null {
  if (!links?.length) return null;
  const streaming = links.filter(
    (l) => l.type === "STREAMING" || Object.keys(STREAMING_DOMAINS).some((d) => l.url.includes(d)),
  );
  if (!streaming.length) return null;
  if (preferred !== "any") {
    const match = streaming.find((l) => l.url.includes(preferred.replace("disney", "disneyplus")));
    if (match) return match.url;
  }
  return streaming[0].url;
}

/** "S2E5" when the source numbers episodes by season, otherwise "Episode 17". */
export function episodeLabel(
  episode: Pick<Episode, "number" | "seasonNumber" | "sourceEpisodeNumber">,
): string {
  return episode.seasonNumber != null && episode.sourceEpisodeNumber != null
    ? `S${episode.seasonNumber}E${episode.sourceEpisodeNumber}`
    : `Episode ${episode.number}`;
}

/** Whether a key event comes from a field where the user is typing text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

export function progressPercent(watched: number, total: number): number {
  if (total === 0) return 0;
  return Math.floor((watched / total) * 100);
}

export function timeAgo(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/** Strip HTML tags (e.g. a provider's synopsis) and collapse whitespace. */
export function plainText(value: string | undefined): string | null {
  if (!value) return null;
  return (
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}
