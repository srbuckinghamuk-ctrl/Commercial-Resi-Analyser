import { describe, it, expect } from 'vitest';
import { repairGluedDescription } from './format';

/**
 * The repair is narrow by design, so most of these cases assert that it does
 * *nothing*. A repair that fires too eagerly on stored prose would be worse than
 * the defect it fixes — it would silently rewrite the property description a
 * lender reads.
 */
describe('repairGluedDescription', () => {
  it('removes a section label glued to the first sentence', () => {
    // The live 9 & 9A Stonegate record, verbatim.
    expect(
      repairGluedDescription(
        'DescriptionThe property comprises a three storey building arranged as ground '
        + 'floor and basement retail accommodation.',
      ),
    ).toBe(
      'The property comprises a three storey building arranged as ground '
      + 'floor and basement retail accommodation.',
    );
  });

  it('matches the longest label, so a longer heading is not half-removed', () => {
    expect(repairGluedDescription('Property DescriptionThe unit is arranged over two floors.'))
      .toBe('The unit is arranged over two floors.');
    expect(repairGluedDescription('Full Property DescriptionA mid-terrace building.'))
      .toBe('A mid-terrace building.');
  });

  it('handles the other headings these listing pages use', () => {
    expect(repairGluedDescription('SummaryVacant since 2025.')).toBe('Vacant since 2025.');
    expect(repairGluedDescription('OverviewGround floor retail.')).toBe('Ground floor retail.');
    expect(repairGluedDescription('AccommodationGround floor 95 sq m.')).toBe('Ground floor 95 sq m.');
    expect(repairGluedDescription('Key FeaturesClass E use.')).toBe('Class E use.');
  });

  it('leaves a correctly spaced description alone', () => {
    const clean = 'Description The property comprises a three storey building.';
    expect(repairGluedDescription(clean)).toBe(clean);
  });

  it('leaves prose that merely begins with the word alone', () => {
    // Lowercase after the label: a sentence, not a glued heading.
    const prose = 'Descriptions of the accommodation are available from the agent.';
    expect(repairGluedDescription(prose)).toBe(prose);
    const sentence = 'Description of the lease is attached.';
    expect(repairGluedDescription(sentence)).toBe(sentence);
  });

  it('does not touch a label that appears anywhere but the start', () => {
    const mid = 'The agent has issued a revised DescriptionThe unit is larger than stated.';
    expect(repairGluedDescription(mid)).toBe(mid);
  });

  it('does not perform the general lowercase-uppercase repair', () => {
    // The tempting general rule would mangle all of these.
    for (const text of [
      'The iPhone shop occupies the ground floor.',
      'Vendor holds a PhD in surveying.',
      'GDVs quoted are net of VAT.',
      'Let to McDonald\'s until 2031.',
    ]) {
      expect(repairGluedDescription(text)).toBe(text);
    }
  });

  it('leaves an empty or label-only value alone', () => {
    expect(repairGluedDescription('')).toBe('');
    expect(repairGluedDescription('Description')).toBe('Description');
  });
});
