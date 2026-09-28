import { expect, test, vi } from "vite-plus/test";

vi.mock("$lib/sources.svelte.js", () => ({}));

import type { NormalizedMedia } from "$lib/connectors/contracts.js";
import { platformMatchScore } from "./platforms.js";

const result = (fields: Partial<NormalizedMedia> & Record<string, unknown>): NormalizedMedia => ({
  providerId: "1",
  kind: "series",
  title: "",
  ...fields,
});
const OCT_3_2019 = Date.UTC(2019, 9, 3);

test("the same title matches, even from another season's start date", () => {
  const media = { titleEnglish: "ORIENT", titleRomaji: "ORIENT" };
  expect(platformMatchScore(media, null, result({ title: "Orient" }))).toBe(2);
  expect(
    platformMatchScore(media, OCT_3_2019, result({ title: "ORIENT", startDate: "2022-01-06" })),
  ).toBe(1);
});

test("a title before a subtitle matches only with the same start date", () => {
  const media = {
    titleEnglish: "Ascendance of a Bookworm: I'll Do Anything to Become a Librarian!",
    titleRomaji: "Honzuki no Gekokujou: Shisho ni Naru Tame ni wa Shudan wo Erandeiraremasen",
  };
  const aniList = { title: "Honzuki no Gekokujou", titleEnglish: "Ascendance of a Bookworm" };
  expect(
    platformMatchScore(
      media,
      OCT_3_2019,
      result({ ...aniList, startDateParts: { year: 2019, month: 10, day: 3 } }),
    ),
  ).toBe(1);
  expect(
    platformMatchScore(
      media,
      OCT_3_2019,
      result({ ...aniList, startDateParts: { year: 2020, month: 4, day: 4 } }),
    ),
  ).toBe(0);
  expect(platformMatchScore(media, null, result(aniList))).toBe(0);
});

test("a spin-off with a longer name does not match", () => {
  const media = { titleEnglish: "Soul Eater", titleRomaji: "Soul Eater" };
  expect(platformMatchScore(media, null, result({ title: "Soul Eater Not!" }))).toBe(0);
});
