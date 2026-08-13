import { describe, it, expect } from 'vitest';
import { buildSpiderContent } from './export-pdf';
import { computeSpider } from './deal-spider';
import { defaultCalculatorInputsV2 } from './conversion-defaults';
import type { CalculatorInputsV2 } from './model';
import type { EligibilityAssessment, EligibilityCriterion } from '../types';

function fixtureInputs(): CalculatorInputsV2 {
  const inputs = defaultCalculatorInputsV2();
  inputs.acquisition.purchase_price_pence = 50_000_000;
  inputs.unit_mix.units = [
    { id: 'u1', type: '2bed', floor_area_sqm: 65, estimated_value_pence: 32_000_000, comparable_notes: '' },
    { id: 'u2', type: '1bed', floor_area_sqm: 52, estimated_value_pence: 24_000_000, comparable_notes: '' },
  ];
  inputs.conversion_costs.total_construction_sqm = 120;
  return inputs;
}

function criterion(key: string, passed: boolean | null, label = key): EligibilityCriterion {
  return { key, label, passed, source: null, auto_checked: false, value: null, risk_flag: null };
}

function assessment(criteria: EligibilityCriterion[]): EligibilityAssessment {
  return {
    id: 'a1',
    project_id: 'p1',
    pdr_class: 'class_ma',
    criteria,
    verdict: 'green',
    suggested_next_steps: [],
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('buildSpiderContent', () => {
  it('lists every axis with raw value, score, weight and contribution, plus overall and RAG', () => {
    const result = computeSpider(fixtureInputs(), assessment([criterion('use_class_check', true)]));
    const lines = buildSpiderContent(result);
    const text = lines.join('\n');
    expect(text).toContain('DEAL SPIDER');
    for (const axis of result.axes) {
      const line = lines.find((l) => l.includes(axis.short));
      expect(line, `line for ${axis.short}`).toBeDefined();
      expect(line).toContain(axis.score.toFixed(1));
      expect(line).toContain(axis.raw.toFixed(1));
    }
    expect(text).toContain(`Overall: ${result.overall!.toFixed(1)}/5`);
    expect(text.toUpperCase()).toContain(result.rag.toUpperCase());
  });

  it('renders a blocked state naming the failing check instead of a score', () => {
    const result = computeSpider(
      fixtureInputs(),
      assessment([criterion('article_4', false, 'Not in Article 4 direction area')]),
    );
    const lines = buildSpiderContent(result);
    const text = lines.join('\n');
    expect(text).toContain('BLOCKED');
    expect(text).toContain('Not in Article 4 direction area');
    expect(text).not.toContain('Overall:');
  });

  it('carries provisional caveats through to the export', () => {
    const result = computeSpider(
      fixtureInputs(),
      assessment([criterion('use_class_check', true), criterion('article_4', null, 'Article 4 check')]),
    );
    const lines = buildSpiderContent(result);
    const text = lines.join('\n');
    expect(text).toContain('PROVISIONAL');
    expect(text).toContain('Article 4 check');
  });
});
