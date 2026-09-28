import type { NormalizedMedia } from "$lib/connectors/contracts.js";
import type { ExternalLink, Media } from "$lib/types.js";
import { startDateMs } from "$lib/schedule-match.js";
import { streamingLinksFrom } from "$lib/watch-destination.js";
import { enabledSourceForTemplate, fetchSourceDetails, searchSource } from "$lib/sources.svelte.js";

/**
 * Finding where to stream a title whose own source doesn't say, e.g. TVmaze,
 * which rarely lists streaming services for anime. The title is looked up on
 * a source that does list them.
 */

/** Sources that list streaming platforms, best first. */
const PLATFORM_SOURCES = ["anilist", "kitsu"];
/** Search results to consider per source. */
const MAX_RESULTS = 5;
const START_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titlesOf(item: {
  title?: unknown;
  titleEnglish?: unknown;
  titleRomaji?: unknown;
}): string[] {
  return [item.title, item.titleEnglish, item.titleRomaji]
    .filter((title): title is string => typeof title === "string" && !!title.trim())
    .map(normalizeTitle);
}

/** A result's start date: an ISO date, or AniList's `{ year, month, day }`. */
export function resultStartMs(result: NormalizedMedia): number | null {
  const fromString = startDateMs(result.startDate ?? result.releaseDate);
  if (fromString !== null) return fromString;
  const parts = (result as { startDateParts?: unknown }).startDateParts;
  if (!parts || typeof parts !== "object") return null;
  const { year, month, day } = parts as Record<string, unknown>;
  return typeof year === "number" && typeof month === "number" && typeof day === "number"
    ? Date.UTC(year, month - 1, day)
    : null;
}

/**
 * How well a search result matches the title: 2 for the same title, 1 for
 * the same title before a subtitle (TVmaze's "Ascendance of a Bookworm: I'll
 * Do Anything…" is AniList's "Ascendance of a Bookworm"), 0 for no match.
 * A subtitle match needs the same start date, since a spin-off shares the
 * main title too.
 */
export function platformMatchScore(
  media: Pick<Media, "titleEnglish" | "titleRomaji">,
  startMs: number | null,
  result: NormalizedMedia,
): number {
  const own = titlesOf(media);
  const theirs = titlesOf(result);
  const resultStart = resultStartMs(result);
  const sameStart =
    startMs !== null &&
    resultStart !== null &&
    Math.abs(startMs - resultStart) <= START_TOLERANCE_MS;
  const differentStart = startMs !== null && resultStart !== null && !sameStart;
  if (own.some((title) => theirs.includes(title))) return differentStart ? 1 : 2;
  const beforeSubtitle = (title: string) => normalizeTitle(title.split(":")[0]);
  const rawOwn = [media.titleEnglish, media.titleRomaji].filter((t): t is string => !!t?.trim());
  const rawTheirs = [result.title, result.titleEnglish, result.titleRomaji].filter(
    (t): t is string => typeof t === "string" && !!t.trim(),
  );
  const subtitleMatch =
    rawOwn.some((title) => theirs.includes(beforeSubtitle(title))) ||
    rawTheirs.some((title) => own.includes(beforeSubtitle(title)));
  return subtitleMatch && sameStart ? 1 : 0;
}

/**
 * Streaming links for the title from the first platform source that has a
 * match. Returns an empty list when nothing matched; lookup errors are left
 * to the caller.
 */
export async function findPlatformsElsewhere(
  media: Media,
  ownTemplateId: string,
  startDate: string | undefined,
  signal?: AbortSignal,
): Promise<ExternalLink[]> {
  const query = media.titleEnglish ?? media.titleRomaji;
  if (!query?.trim()) return [];
  const startMs = startDateMs(startDate);
  for (const templateId of PLATFORM_SOURCES) {
    if (templateId === ownTemplateId) continue;
    const source = enabledSourceForTemplate(templateId, ["search"]);
    if (!source) continue;
    const results = (await searchSource(source, query, signal)).slice(0, MAX_RESULTS);
    const best = results
      .map((result) => ({ result, score: platformMatchScore(media, startMs, result) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.result;
    if (!best) continue;
    let links = streamingLinksFrom(best.streamingLinks);
    if (!links.length && !("streamingLinks" in best) && source.template.operations.details) {
      links = streamingLinksFrom(
        (await fetchSourceDetails(source, best.providerId, signal))?.streamingLinks,
      );
    }
    if (links.length) return links;
  }
  return [];
}
