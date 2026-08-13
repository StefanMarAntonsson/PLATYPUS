import type { MediaKind } from "./types.js";

export interface GroupableSearchResult {
  key: string;
  sourceKey: string;
  sourceName: string;
  providerId: string;
  kind: MediaKind;
  title: string;
  alternateTitles: string[];
  year: number | null;
}

export interface GroupedSearchResult<T extends GroupableSearchResult = GroupableSearchResult> {
  key: string;
  results: T[];
}

/** Preserve each source's relevance order while giving every source equal visibility. */
export function interleaveSearchResults<T>(sourceResults: T[][]): T[] {
  const interleaved: T[] = [];
  const longest = Math.max(0, ...sourceResults.map((results) => results.length));

  for (let index = 0; index < longest; index++) {
    for (const results of sourceResults) {
      const result = results[index];
      if (result !== undefined) interleaved.push(result);
    }
  }

  return interleaved;
}

export function normalizeSearchTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleKeys(result: GroupableSearchResult): Set<string> {
  return new Set(
    [result.title, ...result.alternateTitles]
      .map(normalizeSearchTitle)
      .filter((title) => title.length > 0),
  );
}

function compatibleYears(left: number | null, right: number | null): boolean {
  return left === null || right === null || Math.abs(left - right) <= 1;
}

export function searchResultsMatch(
  left: GroupableSearchResult,
  right: GroupableSearchResult,
): boolean {
  if (left.kind !== right.kind || !compatibleYears(left.year, right.year)) return false;
  const leftTitles = titleKeys(left);
  return [...titleKeys(right)].some((title) => leftTitles.has(title));
}

export function groupSearchResults<T extends GroupableSearchResult>(
  results: T[],
): GroupedSearchResult<T>[] {
  const groups: GroupedSearchResult<T>[] = [];

  for (const result of results) {
    const group = groups.find(
      (candidate) =>
        !candidate.results.some((existing) => existing.sourceKey === result.sourceKey) &&
        candidate.results.some((existing) => searchResultsMatch(existing, result)),
    );
    if (group) group.results.push(result);
    else groups.push({ key: result.key, results: [result] });
  }

  return groups;
}
