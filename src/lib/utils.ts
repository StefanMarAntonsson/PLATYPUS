import type {
  Media,
  MediaFormat,
  MediaStatus,
  MediaSeason,
  LibraryStatus,
  TitleLanguage,
  WatchSite,
  ExternalLink,
} from "./types.js";

export function getTitle(media: Media, lang: TitleLanguage): string {
  if (lang === "english") return media.titleEnglish ?? media.titleRomaji;
  if (lang === "native") return media.titleNative ?? media.titleRomaji;
  return media.titleRomaji;
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

export function airWeekday(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { weekday: "long" });
}

export function formatRelativeTime(ts: number | null): string {
  if (!ts) return "";
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h`;
  return `${Math.round(abs / 86_400_000)}d`;
}

const WEEK_MS = 7 * 86_400_000;

// Countdown to a future airing time, e.g. "in 3h", "today 20:00", "in 12d".
// Past/imminent times read "airing now".
export function formatCountdown(ts: number | null): string {
  if (!ts) return "";
  const diff = ts - Date.now();
  if (diff <= 0) return "airing now";
  if (diff < 3_600_000) return `in ${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) {
    const isToday = new Date(ts).toDateString() === new Date().toDateString();
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
export function isOnBreak(ts: number | null): boolean {
  return ts != null && ts - Date.now() > WEEK_MS;
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

export function progressPercent(watched: number, total: number): number {
  if (total === 0) return 0;
  return Math.floor((watched / total) * 100);
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
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
