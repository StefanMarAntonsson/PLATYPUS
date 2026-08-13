import { describe, expect, test } from "vite-plus/test";
import { virtualGridWindow } from "./virtual-grid.js";

const base = {
  itemCount: 1_000,
  columnCount: 10,
  rowHeight: 300,
  rowGap: 16,
  viewportHeight: 700,
  overscanRows: 2,
};

describe("virtualGridWindow", () => {
  test("renders the viewport and overscan rows at the top", () => {
    expect(virtualGridWindow({ ...base, scrollTop: 0 })).toMatchObject({
      startIndex: 0,
      endIndex: 70,
      offsetTop: 0,
    });
  });

  test("moves a bounded window through a large library", () => {
    expect(virtualGridWindow({ ...base, scrollTop: 3_160 })).toMatchObject({
      startIndex: 80,
      endIndex: 150,
      offsetTop: 2_528,
    });
  });

  test("does not render beyond the final partial row", () => {
    const result = virtualGridWindow({ ...base, itemCount: 95, scrollTop: 30_000 });
    expect(result.startIndex).toBe(30);
    expect(result.endIndex).toBe(95);
  });

  test("has no height or items for an empty library", () => {
    expect(virtualGridWindow({ ...base, itemCount: 0, scrollTop: 0 })).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
  });
});
