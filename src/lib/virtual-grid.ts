export interface VirtualGridOptions {
  itemCount: number;
  columnCount: number;
  rowHeight: number;
  rowGap: number;
  scrollTop: number;
  viewportHeight: number;
  overscanRows: number;
}

export interface VirtualGridWindow {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
}

export function virtualGridWindow(options: VirtualGridOptions): VirtualGridWindow {
  const columns = Math.max(1, options.columnCount);
  const rowStride = Math.max(1, options.rowHeight + options.rowGap);
  const totalRows = Math.ceil(options.itemCount / columns);
  const windowRows = Math.ceil(options.viewportHeight / rowStride) + options.overscanRows * 2;
  const startRow = Math.min(
    Math.max(0, totalRows - windowRows),
    Math.max(0, Math.floor(Math.max(0, options.scrollTop) / rowStride) - options.overscanRows),
  );
  const endRow = Math.min(totalRows, startRow + windowRows);

  return {
    startIndex: startRow * columns,
    endIndex: Math.min(options.itemCount, endRow * columns),
    offsetTop: startRow * rowStride,
    totalHeight:
      totalRows === 0 ? 0 : totalRows * options.rowHeight + (totalRows - 1) * options.rowGap,
  };
}
