/**
 * A geometric inspector for the PDFs this app generates.
 *
 * The report QA gate the second lender-readiness audit asks for ("no content
 * overflows page bounds", "no orphan or effectively blank pages") cannot be
 * answered by searching the PDF byte stream for a substring — the audit's
 * release-blocking defect was a line of text that was *present and correct*
 * but drawn at 40 pt off the right-hand edge of the page. Only position and
 * measured width expose that.
 *
 * So this module parses what jsPDF actually emitted. jsPDF writes uncompressed
 * content streams in a narrow, stable subset of the PDF operator set:
 *
 *     BT
 *     /F2 40 Tf            <- font resource + size in points
 *     46. TL               <- leading
 *     0 g
 *     56.69 771.02 Td      <- absolute position (a fresh BT resets the matrix)
 *     (text) Tj            <- show
 *     ET
 *
 * and, for rotated text, a full `a b c d e f Tm` in place of the `Td`. Widths
 * are measured with jsPDF's own font metrics (a scratch document set to the
 * same base font and size), so a reported width is the width the renderer will
 * lay out, not an approximation.
 *
 * Test-support only — nothing in the application imports this, so it is not in
 * the production bundle.
 */
import { jsPDF } from 'jspdf';

const PT_PER_MM = 72 / 25.4;

/** Baseline-relative extents as a fraction of font size, for a bounding box. */
const ASCENT_RATIO = 0.75;
const DESCENT_RATIO = 0.25;

export interface TextItem {
  /** 1-based physical page. */
  page: number;
  text: string;
  /** Left edge of the drawn text, mm from the page's left edge. */
  xMm: number;
  /** Text baseline, mm from the page's TOP edge (screen-style, not PDF-style). */
  baselineMm: number;
  /** Effective font size in points, after any scale in the text matrix. */
  sizePt: number;
  /** PDF base font name, e.g. "Helvetica-Bold". */
  baseFont: string;
  /** Rotation in degrees anticlockwise, 0 for the ordinary `Td` case. */
  angleDeg: number;
  /** Measured advance width in mm at `sizePt` in `baseFont`. */
  widthMm: number;
  /** Axis-aligned bounding box in mm from the top-left of the page. */
  box: { left: number; top: number; right: number; bottom: number };
}

export interface PageInfo {
  page: number;
  widthMm: number;
  heightMm: number;
  items: TextItem[];
}

export interface PdfDocumentInfo {
  pages: PageInfo[];
  /** Every text item across the document, in page then draw order. */
  items: TextItem[];
  /** Raw latin1 bytes, for the few assertions that genuinely want the byte stream. */
  raw: string;
}

// ── PDF object plumbing ──────────────────────────────────────────────────────

interface PdfObject {
  num: number;
  body: string;
}

function parseObjects(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = raw.indexOf('endobj', start);
    if (end === -1) continue;
    objects.set(num, { num, body: raw.slice(start, end) });
  }
  return objects;
}

/** The page objects in reading order, taken from the /Pages /Kids array. */
function pageObjectNumbers(objects: Map<number, PdfObject>): number[] {
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Pages\b/.test(obj.body)) continue;
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(obj.body);
    if (!kids) continue;
    return [...kids[1].matchAll(/(\d+)\s+0\s+R/g)].map((k) => Number(k[1]));
  }
  // No /Pages object (should not happen with jsPDF) — fall back to file order.
  return [...objects.values()]
    .filter((o) => /\/Type\s*\/Page\b(?!s)/.test(o.body))
    .map((o) => o.num);
}

/** Content-stream bytes for a stream object. */
function streamBody(raw: string, objects: Map<number, PdfObject>, num: number): string {
  const obj = objects.get(num);
  if (!obj) return '';
  const start = obj.body.indexOf('stream');
  if (start === -1) return '';
  let from = start + 'stream'.length;
  if (raw[from] === '\r') from++;
  if (obj.body[from] === '\n') from++;
  const end = obj.body.indexOf('endstream', from);
  return obj.body.slice(from, end === -1 ? undefined : end);
}

/** /F<n> -> PDF base font name, read from the page's shared /Resources object. */
function fontMap(objects: Map<number, PdfObject>, resourcesNum: number): Map<string, string> {
  const map = new Map<string, string>();
  const res = objects.get(resourcesNum);
  if (!res) return map;
  const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(res.body);
  if (!fontDict) return map;
  for (const entry of fontDict[1].matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
    const fontObj = objects.get(Number(entry[2]));
    const base = fontObj && /\/BaseFont\s*\/([^\s/>]+)/.exec(fontObj.body);
    if (base) map.set(entry[1], base[1]);
  }
  return map;
}

// ── Font metrics ─────────────────────────────────────────────────────────────

const BASE_FONT_TO_JSPDF: Record<string, [string, string]> = {
  'Helvetica': ['helvetica', 'normal'],
  'Helvetica-Bold': ['helvetica', 'bold'],
  'Helvetica-Oblique': ['helvetica', 'italic'],
  'Helvetica-BoldOblique': ['helvetica', 'bolditalic'],
  'Times-Roman': ['times', 'normal'],
  'Times-Bold': ['times', 'bold'],
  'Times-Italic': ['times', 'italic'],
  'Times-BoldItalic': ['times', 'bolditalic'],
  'Courier': ['courier', 'normal'],
  'Courier-Bold': ['courier', 'bold'],
  'Courier-Oblique': ['courier', 'italic'],
  'Courier-BoldOblique': ['courier', 'bolditalic'],
};

/**
 * Measure with jsPDF's own metrics so the width is the one the renderer uses.
 * The scratch document is created once and re-set per measurement.
 */
let scratch: jsPDF | null = null;

function measureMm(text: string, baseFont: string, sizePt: number): number {
  const mapped = BASE_FONT_TO_JSPDF[baseFont];
  if (!mapped) {
    // Unknown base font (a genuinely embedded face) — fall back to Helvetica
    // metrics rather than silently reporting zero width.
    return measureMm(text, 'Helvetica', sizePt);
  }
  scratch ??= new jsPDF({ unit: 'mm', format: 'a4' });
  scratch.setFont(mapped[0], mapped[1]);
  scratch.setFontSize(sizePt);
  return scratch.getTextWidth(text);
}

// ── Content-stream parsing ───────────────────────────────────────────────────

/**
 * jsPDF writes strings in WinAnsiEncoding. Bytes 0x00–0x7F and 0xA0–0xFF agree
 * with Latin-1 (so `£`, `²` and `€`-free text round-trip untouched), but
 * 0x80–0x9F is where WinAnsi puts the punctuation this report actually uses —
 * the em dash in "— not part of the appraisal", the dagger on provisional
 * spider axes, the ellipsis. Without this table those characters decode to C1
 * control codes and every string comparison against them fails.
 */
const WINANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
};

function fromWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += code >= 0x80 && code <= 0x9f ? (WINANSI_HIGH[code] ?? ch) : ch;
  }
  return out;
}

/** Decode a PDF literal string: `\(`, `\)`, `\\`, `\n`, and octal escapes. */
function decodePdfString(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = src[++i];
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '(': case ')': case '\\': out += next; break;
      default:
        if (next >= '0' && next <= '7') {
          let oct = next;
          while (oct.length < 3 && src[i + 1] >= '0' && src[i + 1] <= '7') oct += src[++i];
          out += String.fromCharCode(parseInt(oct, 8));
        } else {
          out += next;
        }
    }
  }
  return fromWinAnsi(out);
}

/**
 * Scan a literal `(...)` string starting at `start` (the opening paren),
 * honouring escapes and balanced inner parens. Returns the decoded contents and
 * the index just past the closing paren.
 */
function readLiteralString(src: string, start: number): { text: string; end: number } {
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  return { text: decodePdfString(src.slice(start + 1, i)), end: i + 1 };
}

interface TextState {
  font: string;
  sizePt: number;
  leadingPt: number;
  xPt: number;
  yPt: number;
  /** [a, b, c, d] of the text matrix; identity unless `Tm` set a rotation. */
  matrix: [number, number, number, number];
}

const NUMBER_TOKEN = /^-?(?:\d+\.?\d*|\.\d+)\.?$/;

function parseContentStream(
  stream: string,
  fonts: Map<string, string>,
  page: number,
  pageHeightPt: number,
): TextItem[] {
  const items: TextItem[] = [];
  const state: TextState = {
    font: 'Helvetica', sizePt: 12, leadingPt: 0,
    xPt: 0, yPt: 0, matrix: [1, 0, 0, 1],
  };
  /** Pending numeric/name operands, cleared at every operator. */
  let operands: string[] = [];

  const num = (i: number): number => {
    // jsPDF emits trailing-dot reals such as "46." — Number() handles them.
    const v = Number(operands[operands.length - i]);
    return Number.isFinite(v) ? v : 0;
  };

  const show = (text: string): void => {
    if (text.length === 0) return;
    const [a, b, c, d] = state.matrix;
    // Uniform-scale factor of the text matrix (jsPDF only ever emits a rotation
    // or the identity, so the x and y scales agree).
    const scale = Math.hypot(a, b) || 1;
    const sizePt = state.sizePt * scale;
    const baseFont = fonts.get(state.font) ?? 'Helvetica';
    const widthMm = measureMm(text, baseFont, sizePt);
    const xMm = state.xPt / PT_PER_MM;
    const baselineMm = (pageHeightPt - state.yPt) / PT_PER_MM;
    // Anticlockwise in PDF space is clockwise in top-down screen space; report
    // the PDF sense and derive the box from the matrix directly.
    const angleDeg = (Math.atan2(b, a) * 180) / Math.PI;
    const ascentMm = (sizePt * ASCENT_RATIO) / PT_PER_MM;
    const descentMm = (sizePt * DESCENT_RATIO) / PT_PER_MM;

    // Corners of the unrotated glyph box in text space (x right, y up from the
    // baseline), mapped through the matrix, then into top-down page space.
    const corners: Array<[number, number]> = [
      [0, -descentMm], [widthMm, -descentMm], [widthMm, ascentMm], [0, ascentMm],
    ];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [tx, ty] of corners) {
      const px = a * tx + c * ty;
      const py = b * tx + d * ty;
      xs.push(xMm + px);
      ys.push(baselineMm - py);
    }
    items.push({
      page, text, xMm, baselineMm, sizePt, baseFont, angleDeg, widthMm,
      box: {
        left: Math.min(...xs), right: Math.max(...xs),
        top: Math.min(...ys), bottom: Math.max(...ys),
      },
    });
  };

  for (let i = 0; i < stream.length; i++) {
    const ch = stream[i];

    if (ch === '(') {
      const { text, end } = readLiteralString(stream, i);
      i = end - 1;
      operands.push(' STR' + text);
      continue;
    }
    if (ch === '[') {
      // TJ array: collect the literal strings, ignore the kerning numbers —
      // jsPDF applies charSpace through them, which does not move the origin.
      let joined = '';
      let j = i + 1;
      for (; j < stream.length && stream[j] !== ']'; j++) {
        if (stream[j] === '(') {
          const { text, end } = readLiteralString(stream, j);
          joined += text;
          j = end - 1;
        }
      }
      i = j;
      operands.push(' STR' + joined);
      continue;
    }
    if (/\s/.test(ch)) continue;

    // Read one token.
    let j = i;
    while (j < stream.length && !/[\s([<]/.test(stream[j])) j++;
    const token = stream.slice(i, j);
    i = j - 1;
    if (token.length === 0) continue;

    if (token.startsWith('/') || NUMBER_TOKEN.test(token)) {
      operands.push(token);
      continue;
    }

    switch (token) {
      case 'BT':
        state.matrix = [1, 0, 0, 1];
        state.xPt = 0;
        state.yPt = 0;
        break;
      case 'Tf': {
        state.sizePt = num(1);
        const name = operands[operands.length - 2] ?? '/F1';
        state.font = name.startsWith('/') ? name.slice(1) : name;
        break;
      }
      case 'TL':
        state.leadingPt = num(1);
        break;
      case 'Td':
      case 'TD':
        // Within a BT block jsPDF emits exactly one Td, so treating it as
        // absolute matches the emitted geometry; a second Td would be relative,
        // which the accumulate below preserves.
        state.xPt += num(2);
        state.yPt += num(1);
        if (token === 'TD') state.leadingPt = -num(1);
        break;
      case 'Tm':
        state.matrix = [num(6), num(5), num(4), num(3)];
        state.xPt = num(2);
        state.yPt = num(1);
        break;
      case 'T*':
        state.yPt -= state.leadingPt;
        break;
      case 'Tj':
      case 'TJ': {
        const last = operands[operands.length - 1];
        if (last?.startsWith(' STR')) show(last.slice(4));
        break;
      }
      case "'":
      case '"': {
        state.yPt -= state.leadingPt;
        const last = operands[operands.length - 1];
        if (last?.startsWith(' STR')) show(last.slice(4));
        break;
      }
      default:
        break;
    }
    operands = [];
  }
  return items;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function inspectPdf(blob: Blob): Promise<PdfDocumentInfo> {
  const raw = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  const objects = parseObjects(raw);
  const pages: PageInfo[] = [];

  pageObjectNumbers(objects).forEach((pageNum, index) => {
    const pageObj = objects.get(pageNum);
    if (!pageObj) return;
    const media = /\/MediaBox\s*\[([^\]]*)\]/.exec(pageObj.body);
    const bounds = media ? media[1].trim().split(/\s+/).map(Number) : [0, 0, 595.28, 841.89];
    const widthPt = bounds[2] - bounds[0];
    const heightPt = bounds[3] - bounds[1];

    const contentsRef = /\/Contents\s+(\d+)\s+0\s+R/.exec(pageObj.body);
    const resourcesRef = /\/Resources\s+(\d+)\s+0\s+R/.exec(pageObj.body);
    const stream = contentsRef ? streamBody(raw, objects, Number(contentsRef[1])) : '';
    const fonts = resourcesRef ? fontMap(objects, Number(resourcesRef[1])) : new Map<string, string>();

    pages.push({
      page: index + 1,
      widthMm: widthPt / PT_PER_MM,
      heightMm: heightPt / PT_PER_MM,
      items: parseContentStream(stream, fonts, index + 1, heightPt),
    });
  });

  return { pages, items: pages.flatMap((p) => p.items), raw };
}
