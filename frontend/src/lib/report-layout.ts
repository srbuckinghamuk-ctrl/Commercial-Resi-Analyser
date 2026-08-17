/**
 * Page geometry shared by every PDF this app produces.
 *
 * The draft watermark used to be implemented twice — once in
 * export-investment-memo.ts and once in export-pdf.ts — with a comment on the
 * second copy explaining that it could not share the first. Both copies drew a
 * fixed 40 pt banner that measured ~390 mm along its own axis and was therefore
 * clipped by both page edges, and both left the document in 40 pt bold grey for
 * whatever drew next. One implementation, so a fix lands once.
 */
import type { jsPDF } from 'jspdf';

export const PAGE_W = 210;
export const PAGE_H = 297;
export const PT_PER_MM = 72 / 25.4;

export const WATERMARK_ANGLE = 35;
export const WATERMARK_CX = PAGE_W / 2;
export const WATERMARK_CY = 160;
/** Clear space the banner keeps from every page edge. */
export const WATERMARK_MARGIN = 6;

/** Watermark grey for an ordinary white page. */
export const LIGHT_PAGE_TONE = 200;
/**
 * Watermark tone for the dark cover.
 *
 * The banner has to be legible without obliterating what it crosses. On a white
 * page a light grey does both; on the cover's near-black field the same grey is
 * *brighter* than the headline metrics it runs through, so the numbers a reader
 * opens the document for are the first thing it obscures. A mid slate sits above
 * the background and well below the text, so the banner reads as a banner and
 * the metrics overprint it cleanly.
 */
export const DARK_PAGE_TONE: [number, number, number] = [71, 85, 105];

/** Baseline-relative glyph extents as a fraction of font size. */
const ASCENT_RATIO = 0.75;
const DESCENT_RATIO = 0.25;

export interface WatermarkGeometry {
  sizePt: number;
  /** Draw origin — pass straight to `doc.text(text, xStart, yStart, { angle })`. */
  xStart: number;
  yStart: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Run `measure` with a throwaway font state, restoring whatever was current. */
function preservingFont<T>(doc: jsPDF, measure: () => T): T {
  const size = doc.getFontSize();
  const { fontName, fontStyle } = doc.getFont();
  const result = measure();
  doc.setFontSize(size);
  doc.setFont(fontName, fontStyle);
  return result;
}

/**
 * Where a rotated, centred banner lands at a given size, and the box it fills.
 *
 * The origin is computed here rather than delegated to jsPDF's
 * `align: 'center'`, which subtracts half the *unrotated* advance width from x
 * and leaves y untouched. For short strings the difference is invisible; for a
 * 45-character banner it moves the whole thing 20 mm down and left of the point
 * it is supposed to be centred on.
 */
export function watermarkBox(doc: jsPDF, text: string, sizePt: number): WatermarkGeometry {
  const rad = (WATERMARK_ANGLE * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const width = preservingFont(doc, () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(sizePt);
    return doc.getTextWidth(text);
  });
  const ascent = (sizePt * ASCENT_RATIO) / PT_PER_MM;
  const descent = (sizePt * DESCENT_RATIO) / PT_PER_MM;
  // Step back along the text's own axis so its midpoint sits on the centre.
  const xStart = WATERMARK_CX - (width / 2) * cos;
  const yStart = WATERMARK_CY + (width / 2) * sin;
  const corners: Array<[number, number]> = [
    [0, -descent], [width, -descent], [width, ascent], [0, ascent],
  ];
  const xs = corners.map(([tx, ty]) => xStart + cos * tx - sin * ty);
  const ys = corners.map(([tx, ty]) => yStart - (sin * tx + cos * ty));
  return {
    sizePt, xStart, yStart,
    left: Math.min(...xs), right: Math.max(...xs),
    top: Math.min(...ys), bottom: Math.max(...ys),
  };
}

/** The largest size at which the whole banner still sits inside the page. */
export function fitWatermark(doc: jsPDF, text: string): WatermarkGeometry {
  let smallest = watermarkBox(doc, text, 6);
  for (let size = 40; size >= 6; size -= 0.5) {
    const box = watermarkBox(doc, text, size);
    smallest = box;
    if (
      box.left >= WATERMARK_MARGIN &&
      box.right <= PAGE_W - WATERMARK_MARGIN &&
      box.top >= WATERMARK_MARGIN &&
      box.bottom <= PAGE_H - WATERMARK_MARGIN
    ) {
      return box;
    }
  }
  return smallest;
}

/**
 * Draw the banner, leaving font, size and colour exactly as they were.
 *
 * The restore is the whole point. Without it the document is left at banner
 * size in grey, and the next thing drawn — typically the first line on the page
 * the banner was just added to — inherits it.
 */
export function drawWatermark(
  doc: jsPDF,
  text: string,
  geometry?: WatermarkGeometry,
  tone: number | [number, number, number] = LIGHT_PAGE_TONE,
): void {
  const box = geometry ?? fitWatermark(doc, text);
  const size = doc.getFontSize();
  const { fontName, fontStyle } = doc.getFont();
  const color = doc.getTextColor();
  if (Array.isArray(tone)) doc.setTextColor(tone[0], tone[1], tone[2]);
  else doc.setTextColor(tone);
  doc.setFontSize(box.sizePt);
  doc.setFont('helvetica', 'bold');
  doc.text(text, box.xStart, box.yStart, { angle: WATERMARK_ANGLE });
  doc.setFontSize(size);
  doc.setFont(fontName, fontStyle);
  doc.setTextColor(color);
}

/**
 * Document metadata every generated PDF carries.
 *
 * Full PDF/UA tagging (a structure tree, role map and artifact marking) is not
 * expressible through jsPDF's public API, so it remains open — see the release
 * report. What is available and does help a screen reader is set here: a
 * document title that is announced instead of the filename, a declared
 * language, and subject/creator metadata.
 */
export function setDocumentMetadata(
  doc: jsPDF,
  properties: { title: string; subject: string; keywords?: string },
): void {
  doc.setProperties({
    title: properties.title,
    subject: properties.subject,
    creator: 'Commercial-Resi-Analyser',
    keywords: properties.keywords ?? '',
  });
  doc.setLanguage('en-GB');
  // Show the document title in the window/tab rather than the file name — the
  // title is what an assistive reader announces first.
  doc.viewerPreferences({ DisplayDocTitle: true });
}
