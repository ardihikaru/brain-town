import type { EventMapCell } from '@web/backoffice/pages/setup.page';

const TOLERANCE_PX = 1;

/** Cells whose text is wider than the cell itself (it would be clipped or spill out). */
export function cellsOverflowing(cells: EventMapCell[]): string[] {
  return cells
    .filter((c) => c.scrollWidth > c.clientWidth)
    .map((c) => `${c.text} (${c.scrollWidth} > ${c.clientWidth})`);
}

/** Cells whose content rect leaves the cell's own box. */
export function cellsLeakingContent(cells: EventMapCell[]): string[] {
  return cells
    .filter(
      (c) =>
        c.content.left < c.box.left - TOLERANCE_PX ||
        c.content.right > c.box.right + TOLERANCE_PX ||
        c.content.top < c.box.top - TOLERANCE_PX ||
        c.content.bottom > c.box.bottom + TOLERANCE_PX,
    )
    .map((c) => c.text);
}

/** Pairs of cells in the same row whose content rects intersect. */
export function overlappingNeighbours(cells: EventMapCell[]): string[] {
  const overlaps: string[] = [];
  for (const a of cells) {
    for (const b of cells) {
      const sameRowRightOf = a.row === b.row && a.col < b.col;
      const intersects =
        a.content.left < b.content.right - TOLERANCE_PX &&
        b.content.left < a.content.right - TOLERANCE_PX &&
        a.content.top < b.content.bottom - TOLERANCE_PX &&
        b.content.top < a.content.bottom - TOLERANCE_PX;
      if (sameRowRightOf && intersects) overlaps.push(`${a.text} | ${b.text}`);
    }
  }
  return overlaps;
}
