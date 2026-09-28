import type { NormalizedMedia } from "./connectors/contracts.js";

const FORMAT_LABELS: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV Short",
  MOVIE: "Film",
  OVA: "OVA",
  ONA: "ONA",
  SPECIAL: "Special",
  MUSIC: "Music video",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  releasing: "Airing",
  ended: "Finished",
  cancelled: "Cancelled",
  in_production: "In production",
  announced: "Upcoming",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : null;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** "2022-01-05" (or an ISO timestamp) → "Jan 2022"; a bare year stays a year. */
function monthYear(value: unknown): string | null {
  const match = text(value)?.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!match) return null;
  const month = match[2] ? MONTHS[Number(match[2]) - 1] : undefined;
  return month ? `${month} ${match[1]}` : match[1];
}

function formatLabel(result: NormalizedMedia): string {
  const format = text(result.format);
  if (format) return FORMAT_LABELS[format.toUpperCase()] ?? format;
  return result.kind === "movie" ? "Film" : "Series";
}

function whenLabel(result: NormalizedMedia): string | null {
  const season = text(result.season);
  const seasonYear = positiveNumber(result.seasonYear);
  if (seasonYear) return season ? `${titleCase(season)} ${seasonYear}` : String(seasonYear);

  const start = monthYear(result.releaseDate ?? result.startDate);
  const end = monthYear(result.endDate);
  if (!start) return null;
  if (result.kind === "movie" || !end || end === start) return start;
  return `${start} – ${end}`;
}

/**
 * The facts shown on one line under a search result, e.g.
 * ["TV", "Fall 2025", "12 eps", "Finished", "Tokyo MX"]. Only values the
 * source actually provided are included.
 */
export function searchResultFacts(result: NormalizedMedia): string[] {
  const episodes = positiveNumber(result.episodeCount);
  const facts = [
    formatLabel(result),
    whenLabel(result),
    episodes && result.kind !== "movie" ? `${episodes} ${episodes === 1 ? "ep" : "eps"}` : null,
    result.lifecycle ? (LIFECYCLE_LABELS[result.lifecycle] ?? null) : null,
    text(result.network),
  ];
  return facts.filter((fact): fact is string => fact !== null);
}

/**
 * Whether a result looks like anime, for the "Anime only" filter. General TV
 * sources return live-action shows too; anime-only sources don't describe
 * themselves, so results with no telling fields are kept.
 */
export function isLikelyAnime(result: NormalizedMedia): boolean {
  const mediaType = text(result.mediaType);
  if (mediaType && !/anim/i.test(mediaType)) return false;
  const genres = Array.isArray(result.genres) ? result.genres : [];
  if (genres.some((genre) => typeof genre === "string" && /^anim(e|ation)$/i.test(genre))) {
    return true;
  }
  const language = text(result.originalLanguage);
  if (language) return /^(japanese|ja|jpn)$/i.test(language);
  return !mediaType;
}
