import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { inspectPdf } from './pdf-inspect';

/**
 * The inspector is the instrument the report QA gate depends on, so it is
 * calibrated here against documents whose geometry is known by construction —
 * not against the memo, which is the thing being measured.
 */
describe('inspectPdf', () => {
  it('reports the page count and A4 page size in mm', async () => {
    const doc = new jsPDF();
    doc.text('one', 20, 25);
    doc.addPage();
    doc.text('two', 20, 25);
    doc.addPage();
    doc.text('three', 20, 25);

    const info = await inspectPdf(doc.output('blob'));
    expect(info.pages).toHaveLength(3);
    expect(info.pages[0].widthMm).toBeCloseTo(210, 1);
    expect(info.pages[0].heightMm).toBeCloseTo(297, 1);
  });

  it('recovers the drawn position, page and text of each item', async () => {
    const doc = new jsPDF();
    doc.setFontSize(10);
    doc.text('first page line', 20, 25);
    doc.addPage();
    doc.text('second page line', 35, 120);

    const info = await inspectPdf(doc.output('blob'));
    const [a, b] = info.items;

    expect(a.text).toBe('first page line');
    expect(a.page).toBe(1);
    expect(a.xMm).toBeCloseTo(20, 2);
    expect(a.baselineMm).toBeCloseTo(25, 2);
    expect(a.sizePt).toBe(10);

    expect(b.text).toBe('second page line');
    expect(b.page).toBe(2);
    expect(b.xMm).toBeCloseTo(35, 2);
    expect(b.baselineMm).toBeCloseTo(120, 2);
  });

  it('recovers font size and base font, including a mid-stream change', async () => {
    const doc = new jsPDF();
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('small normal', 20, 25);
    doc.setFontSize(40);
    doc.setFont('helvetica', 'bold');
    doc.text('big bold', 20, 60);
    doc.setFont('times', 'italic');
    doc.setFontSize(14);
    doc.text('times italic', 20, 90);

    const info = await inspectPdf(doc.output('blob'));
    expect(info.items.map((i) => [i.text, i.sizePt, i.baseFont])).toEqual([
      ['small normal', 9, 'Helvetica'],
      ['big bold', 40, 'Helvetica-Bold'],
      ['times italic', 14, 'Times-Italic'],
    ]);
  });

  it('measures width with the renderer\'s own metrics, so a 40pt line is wider than the page', async () => {
    const doc = new jsPDF();
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text('[Information Required: Team CVs]', 20, 25);
    const small = (await inspectPdf(doc.output('blob'))).items[0];

    const big = new jsPDF();
    big.setFontSize(40);
    big.setFont('helvetica', 'italic');
    big.text('[Information Required: Team CVs]', 20, 25);
    const large = (await inspectPdf(big.output('blob'))).items[0];

    // Same string, 4x the size: 4x the width, and past the 210mm page edge.
    expect(large.widthMm / small.widthMm).toBeCloseTo(4, 5);
    expect(small.box.right).toBeLessThan(210);
    expect(large.box.right).toBeGreaterThan(210);
  });

  it('escapes and octal sequences round-trip', async () => {
    const doc = new jsPDF();
    doc.setFontSize(10);
    doc.text('Profit (net) of £1,234 — 50 m²', 20, 25);

    const info = await inspectPdf(doc.output('blob'));
    expect(info.items[0].text).toBe('Profit (net) of £1,234 — 50 m²');
  });

  it('derives a rotated bounding box from the text matrix', async () => {
    const doc = new jsPDF();
    doc.setFontSize(12);
    doc.text('rotated', 105, 150, { angle: 35, align: 'center' });

    const item = (await inspectPdf(doc.output('blob'))).items[0];
    expect(item.angleDeg).toBeCloseTo(35, 3);
    // A 35-degree line has real height: its box is taller than the glyph box.
    expect(item.box.bottom - item.box.top).toBeGreaterThan(item.sizePt / (72 / 25.4));
    // and it straddles the centre it was drawn about.
    expect(item.box.left).toBeLessThan(105);
    expect(item.box.right).toBeGreaterThan(105);
  });

  it('reads text drawn inside a jspdf-autotable table', async () => {
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF();
    autoTable(doc, {
      startY: 30,
      head: [['Metric', 'Value']],
      body: [['Peak debt', '£123,456']],
    });

    const info = await inspectPdf(doc.output('blob'));
    const texts = info.items.map((i) => i.text);
    expect(texts).toContain('Peak debt');
    expect(texts).toContain('£123,456');
  });
});
