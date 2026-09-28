/**
 * Matching a per-season library item (e.g. Kitsu's "Mushoku Tensei 3rd
 * Season" or "ORIENT Part 2") to the right stretch of episodes in a TVmaze
 * show, which holds every season of a series in one entry.
 */

export interface ScheduleEpisode {
  providerId: string;
  season: number;
  number: number;
  title: string | null;
  airingAt: number | null;
}

export interface ScheduleMatch {
  seasonNumber: number;
  /** How many of the season's episodes come before this item's episode 1. */
  episodeOffset: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Start dates are calendar days in the broadcaster's time zone, while air times are UTC. */
const START_TOLERANCE_MS = 2 * DAY_MS;

/** "YYYY-MM-DD" (or an ISO timestamp) → UTC midnight of that day. */
export function startDateMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/**
 * Strip season and part suffixes so a TVmaze search finds the parent show:
 * "Mushoku Tensei: Jobless Reincarnation Season 3" → "Mushoku Tensei:
 * Jobless Reincarnation"; "Mushoku Tensei ... 3rd Season" likewise.
 */
export function baseShowTitle(title: string): string {
  return title
    .replace(/\s*[:\-–]?\s*\b(season|part|cour)\s*\d+\b.*$/i, "")
    .replace(/\s*[:\-–]?\s*\b\d+(st|nd|rd|th)\s+(season|cour|part)\b.*$/i, "")
    .replace(/\s*[:\-–]?\s*\b(second|third|fourth|fifth|final)\s+season\b.*$/i, "")
    .replace(/\s*[:\-–]\s*$/, "")
    .trim();
}

/**
 * Find the season and starting episode whose air date matches the item's
 * start date. An item that starts partway through a TVmaze season (a split
 * cour) gets a non-zero offset. Returns null when nothing aired close enough.
 */
export function matchScheduleSeason(
  startDate: number,
  episodes: ScheduleEpisode[],
): ScheduleMatch | null {
  const seasons = new Map<number, ScheduleEpisode[]>();
  for (const episode of episodes) {
    const list = seasons.get(episode.season) ?? [];
    list.push(episode);
    seasons.set(episode.season, list);
  }

  let best: (ScheduleMatch & { distance: number }) | null = null;
  for (const [seasonNumber, list] of seasons) {
    list.sort((a, b) => a.number - b.number);
    list.forEach((episode, index) => {
      if (episode.airingAt === null) return;
      const distance = Math.abs(episode.airingAt - startDate);
      if (distance > START_TOLERANCE_MS) return;
      if (!best || distance < best.distance) {
        best = { seasonNumber, episodeOffset: index, distance };
      }
    });
  }
  if (!best) return null;
  const { seasonNumber, episodeOffset } = best;
  return { seasonNumber, episodeOffset };
}

/** The episodes of a matched season that belong to the item, renumbered from 1. */
export function scheduleForMatch(
  episodes: ScheduleEpisode[],
  match: ScheduleMatch,
  episodeCount: number | null,
): Array<ScheduleEpisode & { localNumber: number }> {
  const season = episodes
    .filter((episode) => episode.season === match.seasonNumber)
    .sort((a, b) => a.number - b.number)
    .slice(match.episodeOffset);
  const own = episodeCount !== null && episodeCount > 0 ? season.slice(0, episodeCount) : season;
  return own.map((episode, index) => ({ ...episode, localNumber: index + 1 }));
}
