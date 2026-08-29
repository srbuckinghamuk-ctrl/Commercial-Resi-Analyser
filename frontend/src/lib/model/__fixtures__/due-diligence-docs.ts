/**
 * R15 spec §23. The shared due-diligence document builders. Every builder
 * starts from fixture Y (fixtures/financial-model/y-due-diligence.json) via
 * `migrateInputsToV16` (R16b Task 2 moved this on from `migrateInputsToV15`,
 * which itself moved it on from `migrateInputsToV14`, spec §25.7, which
 * itself moved it on from `migrateInputsToV13`, spec §24.8) — never a
 * hand-authored default object — so the tests and the golden corpus share
 * one document. Mirrors `tests/fixtures_due_diligence.py`, using this
 * language's own naming convention for the same functions (camelCase here,
 * snake_case there). Twin of `unit-sales-docs.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV16 } from '../migrate';
import { buildSchedule } from '../schedule';
import { computeDueDiligence, defaultDueDiligence } from '../due-diligence';
import { runAppraisal } from '../index';
import { generateInvestmentMemo } from '../../export-investment-memo';
import { inspectPdf } from '../../report-qa/pdf-inspect';
import { documentText } from '../../report-qa/report-checks';
import { FIXTURE_PROJECT } from './investment-case-docs';
import type { DueDiligenceResult } from '../due-diligence';
import type { QsProvenance, PriceBasis } from '../cost-plan';
import type {
  AnyCalculatorInputs, CalculatorInputsV16, LenderValuation, Schedule,
} from '../finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

/** Fixture Y's QS provenance record, exported so a test can vary ONE of its
 *  fields (`{ ...QS, status: 'draft' }`) rather than restate the block. */
export const QS: QsProvenance = {
  source: 'Gardiner & Theobald', stage: 'riba_3', date: '2026-08-01',
  status: 'issued', base_date: '2026-07-01', inflation: null,
};

function rawY(): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'y-due-diligence.json'), 'utf-8')) as {
    inputs: Record<string, unknown>;
  };
  // Deep clone so callers never mutate the module-level parse across calls.
  return JSON.parse(JSON.stringify(doc.inputs)) as Record<string, unknown>;
}

/**
 * Fixture Y's inputs as a genuine v12 document: the three §23 additions
 * (`due_diligence`, `cost_plan.qs`, every package's `price_basis`) deleted and
 * the version stamped back to 12. Not a v13 document with keys blanked — a
 * document the v12 schema itself accepts, which is what the pre-v13 read path
 * actually receives.
 */
export function rawYAsV12(): Record<string, unknown> {
  const raw = rawY();
  delete raw.due_diligence;
  const costPlan = raw.cost_plan as { qs?: unknown; packages: Array<Record<string, unknown>> };
  delete costPlan.qs;
  for (const p of costPlan.packages) delete p.price_basis;
  raw.inputs_version = 12;
  return raw;
}

interface RawItem extends Record<string, unknown> {
  code: string;
}

/** The override keys `ddDoc` accepts (spec §23, Task 3's brief). Each is a
 *  SINGLE named deviation from fixture Y's base. */
export interface DdDocOverrides {
  /** Sets those items' statuses — a status change ALONE; the caller supplies
   *  evidence/action/notes through the keys below when a rule needs them. */
  status?: Record<string, string>;
  evidence?: Record<string, { source: string; reference: string; date: string } | null>;
  action?: Record<string, string>;
  notes?: Record<string, string>;
  /** The item's `expiry_date`. */
  expiry?: Record<string, string | null>;
  /** `[cost_impact_pence, programme_impact_months]`, either nullable. */
  impacts?: Record<string, [number | null, number | null]>;
  /** Replaces the captured listing record. */
  sourceRecord?: Record<string, unknown> | null;
  /** Sets that one field on the record. */
  isVacant?: boolean | null;
  /** The record's `floor_area_sqm`. */
  listingArea?: number | null;
  existingGia?: number;
  /** e1's `evidence_status`. */
  equityStatus?: string;
  lenderValuation?: LenderValuation;
  requiresConfirmation?: boolean;
  /** A PATCH onto the vat block: top-level keys are merged, and
   *  `treatmentPatch` is a `{ category: { field: value } }` map applied to the
   *  matching treatments rows. */
  vat?: {
    registered?: boolean;
    treatmentPatch?: Record<string, Record<string, unknown>>;
  };
  qs?: QsProvenance | null;
  priceBasis?: Record<string, PriceBasis | null>;
  /** Headline mode AND no packages, as the Costs page's own mode switch
   *  leaves the document. */
  mode?: 'headline';
  /** Removes that catalogue item. */
  dropItem?: string;
  /** Appends a copy of that item (a duplicate code). */
  dupItem?: string;
  /** Appends a raw item. */
  addItem?: Record<string, unknown>;
  /** Replaces `due_diligence.items` wholesale. */
  items?: Array<Record<string, unknown>>;
  acquisitionDate?: string | null;
  /** Only `null` is a meaningful value — drops the network, so the
   *  construction start falls to 0 under §6. */
  programme?: null;
  /** Replaces `items` with the migration seed and clears `source_record`, `qs`
   *  and every `price_basis`: the money-inertness twin. */
  seed?: boolean;
}

/** Fixture Y, optionally altered. See {@link DdDocOverrides}. */
export function ddDoc(overrides: DdDocOverrides = {}): CalculatorInputsV16 {
  const o = overrides;
  const raw = rawY();
  const dd = raw.due_diligence as { source_record: Record<string, unknown> | null; items: RawItem[] };
  const costPlan = raw.cost_plan as {
    mode: string; qs: QsProvenance | null; packages: Array<Record<string, unknown>>;
  };

  if (o.seed) {
    dd.items = defaultDueDiligence().items as unknown as RawItem[];
    dd.source_record = null;
    costPlan.qs = null;
    for (const p of costPlan.packages) p.price_basis = null;
  }
  if (o.items !== undefined) {
    dd.items = JSON.parse(JSON.stringify(o.items)) as RawItem[];
  }

  const byCode = new Map(dd.items.map((item) => [item.code, item]));
  for (const [code, status] of Object.entries(o.status ?? {})) byCode.get(code)!.status = status;
  for (const [code, evidence] of Object.entries(o.evidence ?? {})) {
    byCode.get(code)!.evidence = evidence == null ? null : { ...evidence };
  }
  for (const [code, action] of Object.entries(o.action ?? {})) byCode.get(code)!.action = action;
  for (const [code, notes] of Object.entries(o.notes ?? {})) byCode.get(code)!.notes = notes;
  for (const [code, expiry] of Object.entries(o.expiry ?? {})) byCode.get(code)!.expiry_date = expiry;
  for (const [code, [cost, months]] of Object.entries(o.impacts ?? {})) {
    const item = byCode.get(code)!;
    item.cost_impact_pence = cost;
    item.programme_impact_months = months;
  }

  if (o.dropItem !== undefined) dd.items = dd.items.filter((item) => item.code !== o.dropItem);
  if (o.dupItem !== undefined) {
    dd.items.push(JSON.parse(JSON.stringify(byCode.get(o.dupItem)!)) as RawItem);
  }
  if (o.addItem !== undefined) {
    dd.items.push(JSON.parse(JSON.stringify(o.addItem)) as RawItem);
  }

  if ('sourceRecord' in o) {
    dd.source_record = o.sourceRecord == null
      ? null
      : (JSON.parse(JSON.stringify(o.sourceRecord)) as Record<string, unknown>);
  }
  if ('isVacant' in o && dd.source_record != null) dd.source_record.is_vacant = o.isVacant;
  if ('listingArea' in o && dd.source_record != null) dd.source_record.floor_area_sqm = o.listingArea;

  if (o.existingGia !== undefined) {
    (raw.areas as Record<string, unknown>).existing_gia_sqm = o.existingGia;
  }
  if (o.equityStatus !== undefined) {
    (raw.equity_sources as Array<Record<string, unknown>>)[0].evidence_status = o.equityStatus;
  }
  if (o.lenderValuation !== undefined) raw.lender_valuation = { ...o.lenderValuation };
  if (o.requiresConfirmation !== undefined) {
    (raw.finance as Record<string, unknown>).requires_confirmation = o.requiresConfirmation;
  }
  if (o.vat !== undefined) {
    const patch: Record<string, unknown> = { ...o.vat };
    delete patch.treatmentPatch;
    const vat = raw.vat as { treatments: Array<Record<string, unknown>> } & Record<string, unknown>;
    Object.assign(vat, patch);
    // §17.2's single-accessor guard is about RESOLVING a treatment for a
    // charge; this is a fixture builder WRITING the raw input block, the same
    // write the migration and the defaults do (the rule's own message exempts
    // an ObjectExpression write for exactly that reason). Nothing here reads a
    // resolved rate, and this module is imported only by `.test.ts` files, so
    // the narrow per-site exemption the rule's message sanctions is used rather
    // than a file-wide allowlist entry.
    for (const [category, fields] of Object.entries(o.vat.treatmentPatch ?? {})) {
      // eslint-disable-next-line no-restricted-syntax
      for (const treatment of vat.treatments) {
        if (treatment.category === category) Object.assign(treatment, fields);
      }
    }
  }

  if ('qs' in o) costPlan.qs = o.qs == null ? null : { ...o.qs };
  for (const [packageId, basis] of Object.entries(o.priceBasis ?? {})) {
    for (const p of costPlan.packages) if (p.id === packageId) p.price_basis = basis;
  }
  if (o.mode === 'headline') {
    costPlan.mode = 'headline';
    costPlan.packages = [];
  }

  if ('acquisitionDate' in o) {
    (raw.acquisition as Record<string, unknown>).acquisition_date = o.acquisitionDate;
  }
  if ('programme' in o && o.programme === null) raw.programme = null;

  return migrateInputsToV16(raw);
}

export function scheduleFor(doc: AnyCalculatorInputs): Schedule {
  return buildSchedule(doc);
}

/** The derivation as the engine will call it (Task 5): every argument comes off
 *  ONE run of the appraisal, so the cost plan, the VAT result and the
 *  acquisition tax the schedule was built from are the very ones the rows read.
 *  Re-deriving any of them here would let the fixture drift from the run. */
export function computeFor(doc: AnyCalculatorInputs): DueDiligenceResult {
  const run = runAppraisal(doc);
  return computeDueDiligence(
    doc, run.metrics.cost_plan, run.schedule.vat, run.metrics.acquisition_tax, run.schedule,
  );
}

/** Runs a document through the real memo generator and returns its extracted
 *  text. Copied from `unit-sales-docs.ts`'s `memoText`, widened to accept a
 *  `CalculatorInputsV16` document. */
export async function memoText(doc: CalculatorInputsV16): Promise<string> {
  const run = runAppraisal(doc);
  const blob = generateInvestmentMemo(FIXTURE_PROJECT, run);
  const info = await inspectPdf(blob);
  return documentText(info);
}
