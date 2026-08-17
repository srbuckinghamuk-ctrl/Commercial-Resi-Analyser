/**
 * The report release gate, expressed as checks over an inspected PDF.
 *
 * The second lender-readiness audit (§9) asks that, before external issue,
 * automated QA assert "no content overflows page bounds" and "no orphan or
 * effectively blank pages". Both are geometric properties, so both are computed
 * here from `inspectPdf`'s positioned, measured text items rather than from the
 * generator's own idea of where it put things — a generator that miscalculates
 * a page break will also miscalculate its self-report.
 *
 * Test-support only; not imported by the application.
 */
import type { PdfDocumentInfo, PageInfo, TextItem } from './pdf-inspect';

/** Page furniture that is deliberately outside the flowing content box. */
export interface BodyItemOptions {
  /** Rotated text is the draft watermark, which is a page-wide artifact. */
  includeRotated?: boolean;
  /** Anything below this baseline is the running footer. */
  footerTopMm?: number;
}

/** The items that make up a page's readable body, excluding furniture. */
export function bodyItems(page: PageInfo, options: BodyItemOptions = {}): TextItem[] {
  const { includeRotated = false, footerTopMm = 282 } = options;
  return page.items.filter(
    (i) =>
      (includeRotated || Math.abs(i.angleDeg) < 0.001) &&
      i.baselineMm < footerTopMm &&
      i.text.trim().length > 0,
  );
}

export interface OverflowViolation {
  page: number;
  item: TextItem;
  /** Which edge(s) the item's bounding box crosses. */
  edges: Array<'left' | 'right' | 'top' | 'bottom'>;
}

/**
 * Every text item whose bounding box leaves the physical page.
 *
 * `toleranceMm` absorbs the small overshoot that glyph bounding boxes have
 * against advance widths (the last glyph's right side bearing) — it is not a
 * licence for content in the margin, only for sub-millimetre rounding.
 */
export function overflowingItems(
  info: PdfDocumentInfo,
  toleranceMm = 0.5,
): OverflowViolation[] {
  const violations: OverflowViolation[] = [];
  for (const page of info.pages) {
    for (const item of page.items) {
      if (item.text.trim().length === 0) continue;
      const edges: OverflowViolation['edges'] = [];
      if (item.box.left < -toleranceMm) edges.push('left');
      if (item.box.right > page.widthMm + toleranceMm) edges.push('right');
      if (item.box.top < -toleranceMm) edges.push('top');
      if (item.box.bottom > page.heightMm + toleranceMm) edges.push('bottom');
      if (edges.length > 0) violations.push({ page: page.page, item, edges });
    }
  }
  return violations;
}

export interface FillOptions {
  /** Top of the flowing content box, mm from the page top. */
  contentTopMm?: number;
  /** Bottom of the flowing content box, mm from the page top. */
  contentBottomMm?: number;
}

/**
 * The fraction of the content box's vertical extent that actually carries text.
 *
 * Measured as covered 1 mm rows rather than (lowest − highest), so a page
 * holding one line at the top and one at the bottom scores as the near-empty
 * page it is instead of as a full one.
 */
export function pageFillRatio(page: PageInfo, options: FillOptions = {}): number {
  const { contentTopMm = 18, contentBottomMm = 278 } = options;
  const rows = Math.ceil(contentBottomMm - contentTopMm);
  if (rows <= 0) return 0;
  const covered = new Set<number>();
  for (const item of bodyItems(page)) {
    const from = Math.max(contentTopMm, item.box.top);
    const to = Math.min(contentBottomMm, item.box.bottom);
    for (let r = Math.floor(from); r < Math.ceil(to); r++) {
      if (r >= contentTopMm && r < contentBottomMm) covered.add(r);
    }
  }
  return covered.size / rows;
}

/**
 * How much of the content box lies between the first and last thing on the page.
 *
 * This is the primary sparse-page measure, in preference to inked-row coverage:
 * a page holding a single table is mostly white by construction (row padding,
 * leading), and judging it by ink would condemn a perfectly ordinary schedule
 * page while a genuine orphan — a heading and three lines at the top of an
 * otherwise empty page — scores about the same. Extent separates them: the
 * schedule page runs the length of the page, the orphan stops after 20 mm.
 */
export function pageExtentRatio(page: PageInfo, options: FillOptions = {}): number {
  const { contentTopMm = 18, contentBottomMm = 278 } = options;
  const items = bodyItems(page);
  if (items.length === 0) return 0;
  const top = Math.max(contentTopMm, Math.min(...items.map((i) => i.box.top)));
  const bottom = Math.min(contentBottomMm, Math.max(...items.map((i) => i.box.bottom)));
  return Math.max(0, bottom - top) / (contentBottomMm - contentTopMm);
}

export interface SparsePage {
  page: number;
  extentRatio: number;
  fillRatio: number;
  itemCount: number;
  reason: 'extent' | 'ink' | 'orphan';
}

export interface SparseOptions extends FillOptions {
  /** Pages exempt from the check — the full-bleed cover, typically `[1]`. */
  exemptPages?: number[];
  /** Minimum content extent for an interior page. */
  minExtentRatio?: number;
  /** Minimum content extent for the last page, which legitimately ends early. */
  minLastPageExtentRatio?: number;
  /** Below this inked fraction a page is near-empty however far its content reaches. */
  minFillRatio?: number;
  /** Fewer body items than this is an orphan page whatever its extent. */
  minItems?: number;
}

/**
 * Pages that are effectively blank or so sparse they read as a pagination
 * defect. The audit's example was a page holding nothing but a short
 * "contingent exit" note because the section before it had been forced onto a
 * page of its own.
 */
export function sparsePages(info: PdfDocumentInfo, options: SparseOptions = {}): SparsePage[] {
  const {
    exemptPages = [1],
    minExtentRatio = 0.4,
    minLastPageExtentRatio = 0.2,
    minFillRatio = 0.06,
    minItems = 5,
    ...fill
  } = options;
  const last = info.pages.length;
  const sparse: SparsePage[] = [];
  for (const page of info.pages) {
    if (exemptPages.includes(page.page)) continue;
    const extentRatio = pageExtentRatio(page, fill);
    const fillRatio = pageFillRatio(page, fill);
    const itemCount = bodyItems(page).length;
    const floor = page.page === last ? minLastPageExtentRatio : minExtentRatio;
    const reason: SparsePage['reason'] | null =
      itemCount < minItems ? 'orphan'
      : fillRatio < minFillRatio ? 'ink'
      : extentRatio < floor ? 'extent'
      : null;
    if (reason) sparse.push({ page: page.page, extentRatio, fillRatio, itemCount, reason });
  }
  return sparse;
}

export interface OrphanHeading {
  page: number;
  text: string;
  sizePt: number;
}

export interface OrphanOptions extends BodyItemOptions {
  /** Smallest size counted as a heading. Table header cells are bold at 8pt. */
  minHeadingSizePt?: number;
}

/**
 * Headings left alone at the foot of a page while the content they introduce
 * starts on the next one.
 *
 * This check exists because the geometric gate did not catch the defect: a
 * sub-heading reserved its own space correctly, the table beneath it then
 * measured itself and moved whole to the next page, and the heading stayed
 * behind. Every bounds and sparseness assertion passed. It was found by
 * rendering the page and looking at it, which is not a repeatable gate — so it
 * became one.
 *
 * A heading is bold text at or above `minHeadingSizePt`; body text is 10pt
 * regular and table header cells are bold at 8pt, so the two do not collide.
 */
export function orphanHeadings(
  info: PdfDocumentInfo,
  options: OrphanOptions = {},
): OrphanHeading[] {
  const { minHeadingSizePt = 11, ...bodyOptions } = options;
  const orphans: OrphanHeading[] = [];
  for (const page of info.pages) {
    if (page.page === info.pages.length) continue; // nothing follows the last page
    const items = bodyItems(page, bodyOptions);
    if (items.length === 0) continue;
    const last = items.reduce((a, b) => (b.box.bottom > a.box.bottom ? b : a));
    if (last.baseFont.endsWith('-Bold') && last.sizePt >= minHeadingSizePt) {
      orphans.push({ page: page.page, text: last.text, sizePt: last.sizePt });
    }
  }
  return orphans;
}

/** Every distinct font size drawn on a page, largest first — a heading-scale probe. */
export function fontSizesOnPage(page: PageInfo): number[] {
  return [...new Set(bodyItems(page).map((i) => i.sizePt))].sort((a, b) => b - a);
}

/** All body text of a page, in draw order, joined for substring assertions. */
export function pageText(page: PageInfo): string {
  return bodyItems(page).map((i) => i.text).join('\n');
}

/** All body text of the document. */
export function documentText(info: PdfDocumentInfo): string {
  return info.pages.map(pageText).join('\n');
}

/**
 * The document's prose as one whitespace-normalised string.
 *
 * Wrapped paragraphs are drawn one line per `Tj`, so a sentence in the PDF is a
 * sequence of items and "not a credit paper" may straddle a line break. Any
 * assertion about prose has to read the reflowed text, or it is really an
 * assertion about where the line happened to break.
 */
export function documentProse(info: PdfDocumentInfo): string {
  return documentText(info).replace(/\s+/g, ' ').trim();
}

/** Watermark banners drawn on a page - rotated, so outside the body text. */
export function watermarkTexts(page: PageInfo): string[] {
  return page.items.filter((i) => Math.abs(i.angleDeg) > 0.001).map((i) => i.text);
}

/**
 * A compact, greppable dump of the whole document — used by failure messages so
 * a broken gate says *where* on the page it broke, not merely that it did.
 */
export function describeLayout(info: PdfDocumentInfo): string {
  return info.pages
    .map((p) => {
      const items = bodyItems(p);
      const head = `--- page ${p.page} (extent ${(pageExtentRatio(p) * 100).toFixed(0)}%, fill ${(pageFillRatio(p) * 100).toFixed(0)}%, ${items.length} items)`;
      const lines = items.map(
        (i) =>
          `  [${i.box.top.toFixed(0)}-${i.box.bottom.toFixed(0)}mm x ${i.box.left.toFixed(0)}-${i.box.right.toFixed(0)}mm ${i.sizePt}pt] ${i.text}`,
      );
      return [head, ...lines].join('\n');
    })
    .join('\n');
}
