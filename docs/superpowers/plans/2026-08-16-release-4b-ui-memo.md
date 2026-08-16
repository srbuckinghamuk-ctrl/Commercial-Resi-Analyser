# Release 4b — Sensitivity UI + Memo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the R4a sensitivity engine on screen as calculator page 9 and make the investment memo's §10 matrices consume it, with the memo's printed numbers pinned unchanged.

**Architecture:** R4a built `runSensitivity` (`frontend/src/lib/model/sensitivity.ts`) but wired it to nothing. R4b is pure consumption: no spec change, no engine change, no calc-version bump, no Python change. The memo's hardcoded §10 grid loop is first *extracted* into a pure exported function and pinned by a golden test, then *reimplemented* on `runSensitivity` with that same test unmoved — so the refactor cannot drift. The new `SensitivityPage` computes through a `safe-run.ts`-style wrapper because the page's axis editor lets a user pick lever ranges the appraisal engine can throw on.

**Tech Stack:** TypeScript + React 19 + vitest (jsdom + @testing-library/react), jsPDF + jspdf-autotable for the memo. No new dependencies.

## Global Constraints

- **No calculation change.** `CALC_VERSION` stays `2.4.0` in both `app/financial_model/types.py` and `frontend/src/lib/model/finance-types.ts`. Nothing in `frontend/src/lib/model/` or `app/financial_model/` is modified by this release. If a task seems to need an engine edit, stop and report it — it means the design was wrong, not that the engine should move.
- **No Python change and no fixture change.** `pytest` count stays at **750**, and every file under `fixtures/financial-model/` is untouched.
- **Hard regression invariant (design §5.2):** every number and every label in the memo's two existing §10 matrices is byte-identical before and after the refactor. Task 1 pins them as literals; that test is never edited again.
- **Import-cycle rule (carried from R4a, still binding):** `frontend/src/lib/model/index.ts` must **not** import or re-export `sensitivity`, and `app/financial_model/__init__.py` must **not** import `sensitivity`. Consumers import `../lib/model/sensitivity` by its own path. Do not "tidy" this by adding a re-export.
- **No Tailwind classNames.** The codebase styles exclusively with inline `style={{...}}` objects. Match the dark palette already in use: background `#0f172a`, border `#1e3a5f`, body text `#e2e8f0`, muted `#94a3b8`, red `#f87171`, amber `#fbbf24`, green `#22c55e`, accent `#2563eb`.
- **`tsc --noEmit` is inert in this repo** — `tsconfig.json` has `"files": []` with project references. Only `tsc -b` checks anything. Never substitute `--noEmit`.
- **Gates for the branch:** from `frontend/`: `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npm run build`. From the repo root: `python -m pytest -q`.
- **Baseline suite sizes:** frontend vitest **776**, backend pytest **750**. Both stay green throughout; new frontend tests add to 776.
- **Never use `git stash`** (shared stack — two subagents violated this in R2b; verify `git stash list` is unchanged after your task).
- **Branch:** all work commits directly on `release-4b-ui-memo`, cut from `main` at the `docs(plan): Release 4b` commit, whose parent is R4a's merge `cac6dcd`.
- **Commit style:** conventional-commit subject, a body explaining *why*, and the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Historical docs** (`docs/superpowers/plans/*`, `docs/reviews/*`) are point-in-time records — never rewrite them.
- **Ops note for any browser UAT:** run `docker restart commercial-resi-analyser-frontend-1` first. Windows bind mounts do not propagate inotify, so the frontend container serves a stale Vite module graph after a merge.

---

## File Structure

**Created:**

- `frontend/src/lib/sensitivity-format.ts` — presentation-only helpers shared by the memo and the page: lever labels (long and short), step/range formatting, the FE/FG/NR short codes, and the six-metric selector list. Lives outside `lib/model/` deliberately: `lib/model/` mirrors the Python engine file-for-file and this has no Python counterpart, exactly as `safe-run.ts` does not.
- `frontend/src/lib/sensitivity-format.test.ts` — unit tests for the above.
- `frontend/src/lib/safe-sensitivity.ts` — `runSensitivity` wrapped so a throw becomes a value. Same rationale and shape as `safe-run.ts`.
- `frontend/src/lib/safe-sensitivity.test.ts` — unit tests for the above.
- `frontend/src/components/calculator/SensitivityPage.tsx` — calculator page 9: tornado, two-way matrix with a metric selector, axis/step editor.
- `frontend/src/components/calculator/SensitivityPage.test.tsx` — component tests.
- `docs/reviews/2026-08-16-release-4b-uat.md` — live browser UAT record.
- `docs/reviews/2026-08-16-release-4b-implementation-report.md` — release report.

**Modified:**

- `frontend/src/lib/export-investment-memo.ts` — §10 grid extracted to an exported pure function (Task 1), reimplemented on `runSensitivity` (Task 2), tornado table added (Task 3).
- `frontend/src/lib/export-investment-memo.test.ts` — the golden pin (Task 1) and the tornado assertions (Task 3).
- `frontend/src/components/ConversionCalculator.tsx` — `CalcPage` union, `PAGES` list and page dispatch (Task 7).
- `frontend/src/components/calculator/ExitStrategyPage.tsx:111`, `RiskRegisterPage.tsx:52`, `DealSpiderPage.tsx:125`, `InvestorSummaryPage.tsx:22` — heading numbers renumbered 9→10, 10→11, 11→12, 12→13 (Task 7).

**Deliberately not touched:** anything under `frontend/src/lib/model/`, anything under `app/`, anything under `fixtures/`, `docs/financial-model/*` (no spec change — R4a already specified §12).

---

### Task 0: Cut the release branch

**Files:** none.

**Interfaces:**
- Produces: the branch every later task commits on.

- [ ] **Step 1: Confirm a clean tree on `main` at this plan's commit**

```bash
git status --porcelain          # expect no output
git log --oneline -2            # expect: docs(plan): Release 4b ... on top of cac6dcd merge: Release 4a ...
git stash list                  # note this — it must be unchanged at the end of every task
```

This plan is committed on `main`, and that commit is where the branch is cut from. R4a's merge `cac6dcd` is its parent.

- [ ] **Step 2: Cut the branch**

```bash
git checkout -b release-4b-ui-memo
```

- [ ] **Step 3: Record the baseline**

```bash
cd frontend && npx vitest run 2>&1 | tail -5      # expect: 41 files, 776 tests passed
cd .. && python -m pytest -q 2>&1 | tail -3       # expect: 750 passed
```

Both numbers must match before any code changes. If they do not, stop and report — the plan's baselines are wrong and every later count assertion is unreliable.

---

### Task 1: Extract the memo's §10 grid into a pure function and pin it

This task changes **no behaviour whatsoever**. It moves the existing grid loop into an exported function and captures the exact strings it produces today, so Task 2's reimplementation has something to be measured against. Do the extraction as a literal move — do not "improve" the arithmetic, the rounding, the label strings or the flag ordering while moving it.

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts` (add the exported function near `sourcesAndUsesTotals` at line 129; replace the inline grid at lines 1178–1236)
- Modify: `frontend/src/lib/export-investment-memo.test.ts` (add a new `describe` block)

**Interfaces:**
- Consumes: the module-private `fmtPctSafe`, `flagShortCodes`, `runAppraisal`, `applyScenario` already in `export-investment-memo.ts`.
- Produces:
  ```ts
  export interface MemoSensitivityTables {
    head: string[];        // ['', 'GDV -15%', ...] — the column header row
    pocRows: string[][];   // [['Cost -5%', '8.6%', ...], ...] — profit-on-cost matrix body
    ltgdvRows: string[][]; // same shape, LTGDV developer basis
  }
  export function sensitivityTables(inputs: AnyCalculatorInputs): MemoSensitivityTables;
  ```
  Task 3 extends this interface with `tornadoRows: string[][]`. Task 2 reimplements the body without touching the signature.

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `frontend/src/lib/export-investment-memo.test.ts`, at the end of the file, outside the existing `describe('generateInvestmentMemo', ...)`. The literals below were captured from the calc-2.4.0 build on 16 Aug 2026 against this file's own `baseInputs()` fixture — they are the pre-refactor output, and they are what "unchanged" means for the rest of this release.

```ts
// ── Release 4b: the §10 sensitivity matrices are pinned, string for string ──
//
// Design §5.2's hard regression invariant. These literals were captured from
// the pre-refactor (calc 2.4.0, R4a) build. Task 2 reimplements
// sensitivityTables() on top of runSensitivity and this test does not move —
// that is the whole point of it. If a later change makes this fail, the memo's
// printed output has drifted and the change is wrong, not the test.
describe('sensitivityTables — memo §10 regression pin', () => {
  const EXPECTED_HEAD = ['', 'GDV -15%', 'GDV -10%', 'GDV -5%', 'GDV +0%', 'GDV +5%'];

  const EXPECTED_POC_ROWS = [
    ['Cost -5%', '8.6%', '14.9%', '21.2%', '27.4%', '33.6%'],
    ['Cost +0%', '6.0%', '12.2%', '18.3%', '24.4%', '30.5%'],
    ['Cost +5%', '3.6%', '9.6%', '15.6%', '21.5%', '27.5%'],
    ['Cost +10%', '1.2%', '7.1%', '12.9%', '18.8%', '24.6%'],
    ['Cost +15%', '-1.0% [FG]', '4.7% [FG]', '10.5% [FG]', '16.2% [FG]', '21.9% [FG]'],
  ];

  const EXPECTED_LTGDV_ROWS = [
    ['Cost -5%', '55.2%', '52.1%', '49.4%', '46.9%', '44.7%'],
    ['Cost +0%', '57.5%', '54.3%', '51.4%', '48.8%', '46.5%'],
    ['Cost +5%', '59.7%', '56.4%', '53.4%', '50.7%', '48.3%'],
    ['Cost +10%', '61.9%', '58.5%', '55.4%', '52.6%', '50.1%'],
    ['Cost +15%', '62.2% [FG]', '58.8% [FG]', '55.7% [FG]', '52.9% [FG]', '50.4% [FG]'],
  ];

  it('prints the column headers unchanged', () => {
    expect(sensitivityTables(baseInputs()).head).toEqual(EXPECTED_HEAD);
  });

  it('prints the profit-on-cost matrix unchanged', () => {
    expect(sensitivityTables(baseInputs()).pocRows).toEqual(EXPECTED_POC_ROWS);
  });

  it('prints the LTGDV matrix unchanged', () => {
    expect(sensitivityTables(baseInputs()).ltgdvRows).toEqual(EXPECTED_LTGDV_ROWS);
  });

  // Spec §12.5: the all-levers-zero cell is the unadjusted appraisal. In the
  // default grid that is (Cost +0%, GDV +0%) — row index 1, column index 4
  // (the label occupies column 0, so the GDV +0% column is body index 4).
  it('agrees with the unadjusted appraisal in the base cell (spec §12.5)', () => {
    const run = runAppraisal(baseInputs());
    const tables = sensitivityTables(baseInputs());
    expect(tables.pocRows[1][4]).toBe(`${run.metrics.profit_on_cost_pct!.toFixed(1)}%`);
    expect(tables.ltgdvRows[1][4]).toBe(`${run.metrics.ltgdv_developer_pct!.toFixed(1)}%`);
  });
});
```

Add `sensitivityTables` to the existing import at the top of the test file:

```ts
import { generateInvestmentMemo, sourcesAndUsesTotals, sensitivityTables } from './export-investment-memo';
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/lib/export-investment-memo.test.ts
```

Expected: FAIL — `sensitivityTables is not a function` (or a TypeScript resolution error on the import). It must fail for that reason and not because a literal is wrong.

- [ ] **Step 3: Add the exported function**

Insert into `frontend/src/lib/export-investment-memo.ts` immediately **above** `export function generateInvestmentMemo` (around line 150, after `sourcesAndUsesTotals`). The body is the existing grid loop from lines 1178–1236 moved verbatim; only the surrounding plumbing is new.

```ts
/**
 * The §10 two-way sensitivity matrices, as the exact string rows the PDF prints.
 *
 * Extracted from generateInvestmentMemo's body (R4b Task 1) so its output can be
 * pinned by a test before Task 2 reimplements it on the R4a engine
 * (frontend/src/lib/model/sensitivity.ts). Presentation only — every number in
 * here comes from run.metrics of an ordinary appraisal, per the file header's
 * no-recalculation rule.
 */
export interface MemoSensitivityTables {
  head: string[];
  pocRows: string[][];
  ltgdvRows: string[][];
}

export function sensitivityTables(inputs: AnyCalculatorInputs): MemoSensitivityTables {
  // Shared grid: one runAppraisal per (cost, GDV) combination, feeding both matrices.
  const gdvSteps = [-15, -10, -5, 0, 5];
  const costSteps = [-5, 0, 5, 10, 15];
  const grid = costSteps.map((costAdj) =>
    gdvSteps.map((gdvAdj) => {
      const scenRun = runAppraisal(applyScenario(inputs, {
        label: '',
        gdv_adjustment_pct: gdvAdj,
        construction_cost_adjustment_pct: costAdj,
        timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      }));
      return {
        pocPct: scenRun.metrics.profit_on_cost_pct,
        ltgdvPct: scenRun.metrics.ltgdv_developer_pct,
        flags: flagShortCodes(scenRun.metrics.flags),
      };
    }),
  );

  const rowLabel = (costAdj: number) => `Cost ${costAdj >= 0 ? '+' : ''}${costAdj}%`;

  return {
    head: ['', ...gdvSteps.map((g) => `GDV ${g >= 0 ? '+' : ''}${g}%`)],
    pocRows: costSteps.map((costAdj, ci) => [
      rowLabel(costAdj),
      ...grid[ci].map((cell) => `${fmtPctSafe(cell.pocPct)}${cell.flags ? ` [${cell.flags}]` : ''}`),
    ]),
    ltgdvRows: costSteps.map((costAdj, ci) => [
      rowLabel(costAdj),
      ...grid[ci].map((cell) => `${fmtPctSafe(cell.ltgdvPct)}${cell.flags ? ` [${cell.flags}]` : ''}`),
    ]),
  };
}
```

Widen the type import at the top of the file (line 4) so `AnyCalculatorInputs` resolves:

```ts
import type { AnyCalculatorInputs, AppraisalRun, ModelFlag } from './model';
```

- [ ] **Step 4: Replace the inline grid in §10 with a call**

In `generateInvestmentMemo`, delete lines 1178–1236 (from the `// Shared grid:` comment through the end of the LTGDV `table({...})` call's `body:` construction) and replace them with the following. The two `table({...})` calls keep their `styles`, `headStyles`, `bodyStyles`, `columnStyles` and `didParseCell` blocks exactly as they are — only `head` and `body` now come from the function.

```ts
  const sens = sensitivityTables(inputs);

  y = subHeading(y, 'Two-Way Sensitivity Matrix: Profit on Cost (%)');

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [sens.head],
    body: sens.pocRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [51, 65, 85], halign: 'center' },
    columnStyles: { 0: { fontStyle: 'bold', halign: 'left' } },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index > 0) {
        const val = parseFloat(String(data.cell.raw));
        if (val < 0) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else if (val < 15) {
          data.cell.styles.textColor = [217, 119, 6];
        }
      }
    },
  });
  y = lastAutoTableFinalY(doc) + 6;

  y = subHeading(y, 'Two-Way Sensitivity Matrix: LTGDV, developer basis (%)');

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [sens.head],
    body: sens.ltgdvRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [51, 65, 85], halign: 'center' },
    columnStyles: { 0: { fontStyle: 'bold', halign: 'left' } },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index > 0) {
        const val = parseFloat(String(data.cell.raw));
        if (val > 75) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else if (val > 65) {
          data.cell.styles.textColor = [217, 119, 6];
        }
      }
    },
  });
  y = lastAutoTableFinalY(doc) + 6;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/lib/export-investment-memo.test.ts
npx tsc -b && npx eslint .
```

Expected: PASS, with 4 more tests than before in that file. If any of the three literal blocks fails, the extraction was not verbatim — diff your function against lines 1178–1236 of `git show HEAD:frontend/src/lib/export-investment-memo.ts` rather than adjusting the literals.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts
git commit -m "$(cat <<'EOF'
refactor(memo): extract the §10 sensitivity grid and pin its printed output

The two-way matrices a lender reads were built by a loop inside
generateInvestmentMemo, so there was no way to assert their output without
parsing a PDF byte stream. Extracting them into sensitivityTables() and pinning
the exact strings gives the next commit — which reimplements this on the R4a
engine — something to be measured against. No behaviour changes here: the loop
is moved verbatim.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Reimplement the memo grid on `runSensitivity`

The extracted function's body is replaced by a call into the R4a engine. **The Task 1 test is not edited.** It passing unchanged is the deliverable.

**Files:**
- Create: `frontend/src/lib/sensitivity-format.ts`
- Create: `frontend/src/lib/sensitivity-format.test.ts`
- Modify: `frontend/src/lib/export-investment-memo.ts`

**Interfaces:**
- Consumes: `runSensitivity`, `SensitivityCell`, `SensitivityLever`, `SensitivityMetrics` from `./model/sensitivity`; `FlagCode` from `./model`.
- Produces:
  ```ts
  // frontend/src/lib/sensitivity-format.ts
  export const LEVER_LABEL: Record<SensitivityLever, string>;   // 'GDV' | 'Construction cost' | 'Timeline' | 'Interest rate'
  export const LEVER_SHORT: Record<SensitivityLever, string>;   // 'GDV' | 'Cost' | 'Timeline' | 'Rate'
  export function formatStepLabel(lever: SensitivityLever, step: number): string;
  export function formatRangeLabel(lever: SensitivityLever, low: number, high: number): string;
  export function flagShortCodes(codes: readonly FlagCode[]): string;
  ```
  Task 5 adds `SENSITIVITY_METRICS` to this same file.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/sensitivity-format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LEVER_LABEL, LEVER_SHORT, formatStepLabel, formatRangeLabel, flagShortCodes } from './sensitivity-format';

describe('sensitivity-format', () => {
  // The short labels are load-bearing: they reproduce the memo's historical
  // axis captions ("GDV -15%", "Cost +0%") exactly, so the §10 regression pin
  // in export-investment-memo.test.ts keeps passing.
  it('reproduces the memo axis captions', () => {
    expect(`${LEVER_SHORT.gdv} ${formatStepLabel('gdv', -15)}`).toBe('GDV -15%');
    expect(`${LEVER_SHORT.gdv} ${formatStepLabel('gdv', 0)}`).toBe('GDV +0%');
    expect(`${LEVER_SHORT.construction_cost} ${formatStepLabel('construction_cost', -5)}`).toBe('Cost -5%');
    expect(`${LEVER_SHORT.construction_cost} ${formatStepLabel('construction_cost', 15)}`).toBe('Cost +15%');
  });

  it('formats each lever in its own unit (spec §12.1)', () => {
    expect(formatStepLabel('timeline', -3)).toBe('-3 months');
    expect(formatStepLabel('timeline', 3)).toBe('+3 months');
    expect(formatStepLabel('interest_rate', -1)).toBe('-1.0 pp');
    expect(formatStepLabel('interest_rate', 1.5)).toBe('+1.5 pp');
  });

  it('formats a tornado range with the unit stated once', () => {
    expect(formatRangeLabel('gdv', -10, 10)).toBe('-10% to +10%');
    expect(formatRangeLabel('timeline', -3, 3)).toBe('-3 to +3 months');
    expect(formatRangeLabel('interest_rate', -1, 1)).toBe('-1.0 to +1.0 pp');
  });

  it('gives every lever a readable long label', () => {
    expect(LEVER_LABEL.gdv).toBe('GDV');
    expect(LEVER_LABEL.construction_cost).toBe('Construction cost');
    expect(LEVER_LABEL.timeline).toBe('Timeline');
    expect(LEVER_LABEL.interest_rate).toBe('Interest rate');
  });

  // The FE/FG/NR order is fixed, not the engine's flag order — the memo has
  // always printed them in this sequence and the §10 pin depends on it.
  it('emits flag short codes in the fixed FE, FG, NR order', () => {
    expect(flagShortCodes([])).toBe('');
    expect(flagShortCodes(['funding_gap'])).toBe('FG');
    expect(flagShortCodes(['senior_outstanding_at_maturity', 'facility_exceeded', 'funding_gap']))
      .toBe('FE,FG,NR');
  });

  it('ignores flag codes that have no short form', () => {
    expect(flagShortCodes(['requires_confirmation', 'funding_gap'])).toBe('FG');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/lib/sensitivity-format.test.ts
```

Expected: FAIL — cannot resolve `./sensitivity-format`.

- [ ] **Step 3: Create the shared presentation module**

Create `frontend/src/lib/sensitivity-format.ts`:

```ts
import type { FlagCode } from './model';
import type { SensitivityLever } from './model/sensitivity';

/**
 * Presentation for the spec §12 sensitivity suite, shared by the investment
 * memo and the calculator's Sensitivity page.
 *
 * Deliberately outside `lib/model/`: that directory mirrors the Python engine
 * file-for-file (governance §1) and none of this has — or should have — a
 * Python counterpart. Same reasoning as `safe-run.ts`.
 */

/** Full lever names, for the tornado and the page's lever pickers. */
export const LEVER_LABEL: Record<SensitivityLever, string> = {
  gdv: 'GDV',
  construction_cost: 'Construction cost',
  timeline: 'Timeline',
  interest_rate: 'Interest rate',
};

/**
 * Abbreviated lever names for matrix axis captions. These reproduce the
 * captions the investment memo has printed since before R4 ("GDV -15%",
 * "Cost +0%") — changing `construction_cost` here changes printed memo output
 * and will fail the §10 regression pin.
 */
export const LEVER_SHORT: Record<SensitivityLever, string> = {
  gdv: 'GDV',
  construction_cost: 'Cost',
  timeline: 'Timeline',
  interest_rate: 'Rate',
};

/** Decimal places each lever's unit is quoted to. Rates are quoted to 0.1pp. */
function decimalsFor(lever: SensitivityLever): number {
  return lever === 'interest_rate' ? 1 : 0;
}

function signed(value: number, decimals: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

/** One lever position in its own unit (spec §12.1): "+5%", "-3 months", "+1.0 pp". */
export function formatStepLabel(lever: SensitivityLever, step: number): string {
  const text = signed(step, decimalsFor(lever));
  if (lever === 'gdv' || lever === 'construction_cost') return `${text}%`;
  if (lever === 'timeline') return `${text} months`;
  return `${text} pp`;
}

/** A tornado range with the unit stated once: "-10% to +10%", "-3 to +3 months". */
export function formatRangeLabel(lever: SensitivityLever, low: number, high: number): string {
  const d = decimalsFor(lever);
  if (lever === 'gdv' || lever === 'construction_cost') {
    return `${signed(low, d)}% to ${signed(high, d)}%`;
  }
  const unit = lever === 'timeline' ? 'months' : 'pp';
  return `${signed(low, d)} to ${signed(high, d)} ${unit}`;
}

/**
 * The memo's FE/FG/NR shorthand for the three covenant flags a fixed-facility
 * cell can raise (spec §12.2). The order is fixed rather than following the
 * engine's flag order, because the memo has always printed it this way.
 *
 * This is presentation, not model: `SensitivityMetrics.flags` carries raw
 * codes, and codes with no short form (e.g. `requires_confirmation`) are simply
 * not part of this grid's vocabulary.
 */
export function flagShortCodes(codes: readonly FlagCode[]): string {
  const shorthand: Array<[FlagCode, string]> = [
    ['facility_exceeded', 'FE'],
    ['funding_gap', 'FG'],
    ['senior_outstanding_at_maturity', 'NR'],
  ];
  return shorthand.filter(([code]) => codes.includes(code)).map(([, short]) => short).join(',');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/lib/sensitivity-format.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Reimplement `sensitivityTables` on the engine**

In `frontend/src/lib/export-investment-memo.ts`, replace the **body** of `sensitivityTables` (added in Task 1) with the engine-backed version. Keep the interface and the signature.

```ts
export function sensitivityTables(inputs: AnyCalculatorInputs): MemoSensitivityTables {
  // R4b: the grid steps, the lever rule and the base-case identity are now the
  // engine's (spec §12.3–§12.5) rather than constants living in this file. The
  // default config *is* the grid this memo has always printed — R4a promoted
  // these very steps into the specification — so the output is unchanged, and
  // export-investment-memo.test.ts pins that string for string.
  const result = runSensitivity(inputs);
  const { rows, cols } = result.config;

  const axisCaption = (lever: SensitivityLever, step: number) =>
    `${LEVER_SHORT[lever]} ${formatStepLabel(lever, step)}`;

  const cellText = (cell: SensitivityCell, key: 'profit_on_cost_pct' | 'ltgdv_developer_pct') => {
    const codes = flagShortCodes(cell.flags);
    return `${fmtPctSafe(cell[key])}${codes ? ` [${codes}]` : ''}`;
  };

  const bodyFor = (key: 'profit_on_cost_pct' | 'ltgdv_developer_pct') =>
    result.matrix.map((row) => [
      axisCaption(rows.lever, row[0].row_step),
      ...row.map((cell) => cellText(cell, key)),
    ]);

  return {
    head: ['', ...cols.steps.map((step) => axisCaption(cols.lever, step))],
    pocRows: bodyFor('profit_on_cost_pct'),
    ltgdvRows: bodyFor('ltgdv_developer_pct'),
  };
}
```

Update the imports at the top of `export-investment-memo.ts`:

```ts
import type { AnyCalculatorInputs, AppraisalRun, ModelFlag } from './model';
import { runAppraisal } from './model';
import { applyScenario } from './model/apply-scenario';
import { runSensitivity } from './model/sensitivity';
import type { SensitivityCell, SensitivityLever } from './model/sensitivity';
import { LEVER_SHORT, formatStepLabel, flagShortCodes } from './sensitivity-format';
import { formatProgrammeMonth } from './programme-months';
```

Then **delete** the now-unused module-private `flagShortCodes` (lines 105–113 of the pre-Task-1 file) — the imported one replaces it. Leave `flagPresent` and `flagSummary` alone: `flagSummary` is the Scenario Comparison table's full-word summary and still takes `ModelFlag[]`.

- [ ] **Step 6: Run the pin to verify the refactor did not drift**

```bash
cd frontend && npx vitest run src/lib/export-investment-memo.test.ts
```

Expected: PASS, all four Task 1 tests included, **with no edit to them**. If a literal now fails, the engine's default config and the memo's old constants have diverged — that is a real finding: stop, report which cell differs, and do not adjust the literal.

- [ ] **Step 7: Full gates**

```bash
cd frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
```

Expected: **786** tests passing (776 baseline + 4 from Task 1 + 6 from Task 2), all green. The running target for later tasks: Task 3 → 789, Task 4 → 793, Task 5 → 801, Task 6 → 812, Task 7 → 814. A count below target means a test was silently skipped; a count above it means you wrote tests the plan did not ask for, which is fine — say so in the report.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/sensitivity-format.ts frontend/src/lib/sensitivity-format.test.ts frontend/src/lib/export-investment-memo.ts
git commit -m "$(cat <<'EOF'
refactor(memo): §10 matrices now consume the R4a sensitivity engine

The grid steps, the lever rule and the FE/FG/NR policy were hardcoded in the
exporter, free to drift from the named-scenario code that shares their lever
arithmetic. They now come from runSensitivity and spec §12's normative default
config — which is where R4a promoted these exact steps from. The regression pin
added in the previous commit is unchanged and still passes, so the printed
output is provably identical.

Lever and flag presentation moves to lib/sensitivity-format.ts, outside
lib/model/, because it has no Python counterpart and must not acquire one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add the tornado table to memo §10

Design §5.2: the tornado joins §10 as a third table, printed **above** the two matrices.

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`
- Modify: `frontend/src/lib/export-investment-memo.test.ts`

**Interfaces:**
- Consumes: `MemoSensitivityTables` and `sensitivityTables` from Task 2.
- Produces: `MemoSensitivityTables` gains `tornadoRows: string[][]` — rows of `[lever, range, profit at low, profit at high, swing]`.

- [ ] **Step 1: Write the failing test**

Add to the `describe('sensitivityTables — memo §10 regression pin', ...)` block created in Task 1:

```ts
  // Spec §12.4: bars sort by span descending, ties broken by the fixed lever
  // order. For any deal with meaningful sales revenue GDV dominates, so its bar
  // leads — asserted on the fixture rather than hardcoding a pence figure.
  it('lists tornado bars widest-swing first', () => {
    const rows = sensitivityTables(baseInputs()).tornadoRows;
    expect(rows.map((r) => r[0])).toEqual([
      'GDV', 'Construction cost', 'Timeline', 'Interest rate',
    ]);
  });

  it('prints each tornado bar with its range and both endpoint profits', () => {
    const rows = sensitivityTables(baseInputs()).tornadoRows;
    expect(rows[0][1]).toBe('-10% to +10%');
    expect(rows[2][1]).toBe('-3 to +3 months');
    expect(rows[3][1]).toBe('-1.0 to +1.0 pp');
    // Five columns: lever, range, low profit, high profit, swing.
    for (const row of rows) {
      expect(row).toHaveLength(5);
      expect(row[2]).toMatch(/^-?£[\d,]+$/);
      expect(row[3]).toMatch(/^-?£[\d,]+$/);
      expect(row[4]).toMatch(/^£[\d,]+$/);
    }
  });

  // The swing is |profit(high) - profit(low)| (spec §12.4), so it is never
  // signed even when the high endpoint is the worse one (as it is for cost).
  it('prints the construction-cost swing unsigned despite its inverted endpoints', () => {
    const rows = sensitivityTables(baseInputs()).tornadoRows;
    const cost = rows.find((r) => r[0] === 'Construction cost')!;
    expect(cost[4].startsWith('-')).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/lib/export-investment-memo.test.ts
```

Expected: FAIL — `tornadoRows` is undefined on the returned object.

- [ ] **Step 3: Build the tornado rows**

In `export-investment-memo.ts`, extend the interface and the function.

```ts
export interface MemoSensitivityTables {
  head: string[];
  pocRows: string[][];
  ltgdvRows: string[][];
  /** [lever, range, profit at low, profit at high, swing] per spec §12.4 bar. */
  tornadoRows: string[][];
}
```

Inside `sensitivityTables`, add before the `return`:

```ts
  const tornadoRows = result.tornado.map((bar) => [
    LEVER_LABEL[bar.lever],
    formatRangeLabel(bar.lever, bar.low_step, bar.high_step),
    fmt(bar.low.profit_pence),
    fmt(bar.high.profit_pence),
    // |profit(high) - profit(low)| (spec §12.4) — a magnitude, so it stays
    // unsigned even where the high endpoint is the adverse one (cost, rate).
    fmt(bar.span_pence),
  ]);
```

and add `tornadoRows` to the returned object. Extend the `sensitivity-format` import:

```ts
import { LEVER_LABEL, LEVER_SHORT, formatRangeLabel, formatStepLabel, flagShortCodes } from './sensitivity-format';
```

- [ ] **Step 4: Print the table in §10**

In `generateInvestmentMemo`, after the Scenario Comparison table's `y = lastAutoTableFinalY(doc) + 8;` and **before** the `y = subHeading(y, 'Two-Way Sensitivity Matrix: Profit on Cost (%)');` line, insert:

```ts
  y = subHeading(y, 'Single-Lever Sensitivity (Tornado)');
  y = bodyText(
    y,
    'Each lever is moved alone, with every other assumption at base. Swing is the absolute profit difference between the two endpoints; bars are listed widest swing first (spec §12.4).',
  );

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Lever', 'Range', 'Profit at low', 'Profit at high', 'Swing']],
    body: sens.tornadoRows,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
    },
  });
  y = lastAutoTableFinalY(doc) + 8;
```

The `const sens = sensitivityTables(inputs);` line from Task 1 Step 4 must move up to just above this block so `sens` is in scope for all three tables.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/lib/export-investment-memo.test.ts
npx tsc -b && npx eslint .
```

Expected: PASS. The §10 pin from Task 1 still passes — the tornado is additive and does not touch the matrices.

- [ ] **Step 6: Check §10 still paginates sanely**

`generateInvestmentMemo` decides §10's page break with `if (y > 200)` before the section title. A third table makes §10 taller, so confirm nothing overruns the footer.

```bash
cd frontend && npx vitest run src/lib/export-investment-memo.test.ts -t 'watermarks every physical page'
```

Expected: PASS — that test already asserts the watermark reaches every physical page including autoTable's internally paginated ones, so it is the existing guard against a table running off the page. If it fails, lower the §10 threshold from `y > 200` to `y > 170` and re-run; do not shrink the tables.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts
git commit -m "$(cat <<'EOF'
feat(memo): print the single-lever tornado in §10

The two-way matrices show where covenants break across two levers at once, but
a lender reading them cannot tell which single assumption the deal is most
exposed to. The tornado answers that directly, and R4a already computes it —
this only prints it. Swing is the unsigned span of spec §12.4, so cost and rate
bars (whose adverse endpoint is the high one) read the same way as GDV's.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `safeRunSensitivity` — a throw becomes a value

The Sensitivity page's axis editor makes `runSensitivity`'s spec §12.6 throw reachable for the first time — the memo only ever calls it with the fixed default config. A throw in a page component is caught by `CalculatorErrorBoundary`, but that blanks the page and loses the axis text the user typed; returning the failure as a value lets the page keep its editor and show the reason.

**Verified before writing this task, and it changes what the tests assert:** a `timeline` step that drives `finance.term_months` to zero or below does *not* throw. The engine clamps to a one-month term and returns a plausible result — on fixture F, steps of −11, −12 and −13 all give profit 26,556,933p with a `funding_gap` flag. Silent clamping is worse than a throw here, because three different assumptions produce one identical column. `safeRunSensitivity` cannot help with that; Task 6 adds a page-level term guard instead, and a §12.6 rule bounding the resulting term goes on the R5 list.

**Files:**
- Create: `frontend/src/lib/safe-sensitivity.ts`
- Create: `frontend/src/lib/safe-sensitivity.test.ts`

**Interfaces:**
- Consumes: `runSensitivity`, `SensitivityConfig`, `SensitivityResult` from `./model/sensitivity`; `AnyCalculatorInputs` from `./model`.
- Produces:
  ```ts
  export type SafeSensitivityResult =
    | { ok: true; result: SensitivityResult }
    | { ok: false; error: Error };
  export function safeRunSensitivity(
    inputs: AnyCalculatorInputs,
    config?: SensitivityConfig,
  ): SafeSensitivityResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/safe-sensitivity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { safeRunSensitivity } from './safe-sensitivity';
import { migrateInputsToV4 } from './model';
import { defaultSensitivityConfig } from './model/sensitivity';

const FIXTURE_DIR = resolve(__dirname, '../../../fixtures/financial-model');
const fixtureF = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'f-dev-finance-12mo.json'), 'utf-8'),
) as { inputs: Record<string, unknown> };

function baseInputs() {
  return migrateInputsToV4(fixtureF.inputs);
}

describe('safeRunSensitivity', () => {
  it('returns the suite for a computable document', () => {
    const outcome = safeRunSensitivity(baseInputs());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.matrix).toHaveLength(5);
      expect(outcome.result.tornado).toHaveLength(4);
    }
  });

  // An invalid config makes runSensitivity throw (spec §12.6). The page needs
  // that as a value so it can render the reason instead of unmounting.
  it('returns the error instead of throwing on an invalid config', () => {
    const config = defaultSensitivityConfig();
    config.cols.lever = config.rows.lever;
    const outcome = safeRunSensitivity(baseInputs(), config);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toMatch(/different levers/i);
  });

  it('returns the error on an empty step list', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'gdv', steps: [] };
    const outcome = safeRunSensitivity(baseInputs(), config);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toMatch(/at least one step/i);
    }
  });

  // ── Documented engine behaviour, verified 16 Aug 2026 against fixture F ──
  //
  // A timeline step that drives finance.term_months to zero or below does NOT
  // throw and does NOT raise a validation issue: the appraisal engine clamps to
  // a one-month term and returns a plausible-looking result. Steps of -11, -12
  // and -13 on this 12-month deal all yield profit 26,556,933p with a
  // funding_gap flag — three distinct assumptions, one answer.
  //
  // This is pinned as the *current* behaviour, not as desirable behaviour. It is
  // why SensitivityPage carries its own term guard (Task 6) and why a §12.6 rule
  // bounding the resulting term is on the R5 list.
  it('does not fail on a term-emptying timeline step — the engine clamps instead', () => {
    const config = defaultSensitivityConfig();
    config.rows = { lever: 'timeline', steps: [-11, -12, -13] };
    config.cols = { lever: 'gdv', steps: [0] };
    const outcome = safeRunSensitivity(baseInputs(), config);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const [atOne, atZero, atMinusOne] = outcome.result.matrix.map((row) => row[0].profit_pence);
      expect(atZero).toBe(atOne);
      expect(atMinusOne).toBe(atOne);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/lib/safe-sensitivity.test.ts
```

Expected: FAIL — cannot resolve `./safe-sensitivity`.

- [ ] **Step 3: Write the wrapper**

Create `frontend/src/lib/safe-sensitivity.ts`:

```ts
import { runSensitivity } from './model/sensitivity';
import type { SensitivityConfig, SensitivityResult } from './model/sensitivity';
import type { AnyCalculatorInputs } from './model';

export type SafeSensitivityResult =
  | { ok: true; result: SensitivityResult }
  | { ok: false; error: Error };

/**
 * `runSensitivity` wrapped so a thrown call becomes a value — the same pattern,
 * and the same rationale, as `safeRunAppraisal` in `safe-run.ts`. This is UI
 * resilience, not part of the calculation contract, so it lives outside
 * `lib/model/` and has no Python counterpart.
 *
 * `runSensitivity` throws on an invalid config (spec §12.6). The investment memo
 * never reaches that — it only ever passes the fixed default config — but the
 * Sensitivity page puts the axes in the user's hands, so the throw becomes
 * reachable. CalculatorErrorBoundary would catch it, at the cost of blanking the
 * page and the axis text that caused it; a value lets the page keep its editor
 * and state the reason.
 *
 * Note what this does NOT cover: a *valid* config whose timeline step drives
 * finance.term_months to zero or below does not throw at all. The engine clamps
 * to a one-month term and returns a plausible result (verified 16 Aug 2026 —
 * see safe-sensitivity.test.ts). SensitivityPage guards that itself.
 *
 * Callers must not substitute a stale or default grid for a failed one: spec §2
 * forbids showing a number that is not the current calculation.
 */
export function safeRunSensitivity(
  inputs: AnyCalculatorInputs,
  config?: SensitivityConfig,
): SafeSensitivityResult {
  try {
    return { ok: true, result: config ? runSensitivity(inputs, config) : runSensitivity(inputs) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/lib/safe-sensitivity.test.ts
npx tsc -b && npx eslint .
```

Expected: PASS (4 tests). The clamping test is the one to watch: if it fails because the engine now *throws*, that is a change in engine behaviour since 16 Aug 2026 — report it rather than adjusting the assertion, because Task 6's term guard is built on the clamping being real.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/safe-sensitivity.ts frontend/src/lib/safe-sensitivity.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): safeRunSensitivity so a bad axis keeps the editor on screen

The memo only ever calls runSensitivity with the fixed default config, so its
spec §12.6 throw was unreachable. The Sensitivity page puts the axes in the
user's hands. The error boundary would catch the throw but blank the page along
with the axis text that caused it; a value lets the page state the reason and
keep the control that fixes it.

The tests also pin an engine behaviour worth knowing about: a timeline step that
empties the term does not throw at all. The engine clamps to a one-month term,
so steps of -11, -12 and -13 on a 12-month deal return one identical column.
That needs a page-level guard, not a wrapper, and eventually a §12.6 rule.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `SensitivityPage` — tornado and matrix at spec defaults

Design §5.1 regions 1 and 2. The axis editor is Task 6; this task renders the spec default grid only, so the two halves can be reviewed independently.

**Files:**
- Create: `frontend/src/components/calculator/SensitivityPage.tsx`
- Create: `frontend/src/components/calculator/SensitivityPage.test.tsx`
- Modify: `frontend/src/lib/sensitivity-format.ts` (add `SENSITIVITY_METRICS`)

**Interfaces:**
- Consumes: `safeRunSensitivity` (Task 4); `LEVER_LABEL`, `LEVER_SHORT`, `formatStepLabel`, `formatRangeLabel`, `flagShortCodes` (Task 2); `penceToPounds`, `formatPct` from `../../lib/format`; `CalculatorFailurePanel` from `../CalculatorFailurePanel`.
- Produces:
  ```ts
  // frontend/src/lib/sensitivity-format.ts
  export type SensitivityMetricKey =
    | 'profit_pence' | 'profit_on_cost_pct' | 'profit_on_gdv_pct'
    | 'irr_annual_pct' | 'ltgdv_developer_pct' | 'peak_debt_pence';
  export const SENSITIVITY_METRICS: readonly {
    key: SensitivityMetricKey; label: string; kind: 'money' | 'pct';
  }[];

  // frontend/src/components/calculator/SensitivityPage.tsx
  interface Props { inputs: CalculatorInputsV4 }
  export default function SensitivityPage({ inputs }: Props): JSX.Element;
  ```
  **`SensitivityPage` takes no `onChange`.** Design §5.1: the page mutates view state only, never writes `inputs`, never triggers autosave. Not having the prop is how that is enforced rather than merely intended.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/calculator/SensitivityPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import SensitivityPage from './SensitivityPage';
import { runAppraisal, migrateInputsToV4 } from '../../lib/model';
import type { CalculatorInputsV4 } from '../../lib/model';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const fixtureF = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'f-dev-finance-12mo.json'), 'utf-8'),
) as { inputs: Record<string, unknown> };

function buildInputs(): CalculatorInputsV4 {
  return migrateInputsToV4(fixtureF.inputs);
}

describe('SensitivityPage — two-way matrix', () => {
  it('renders the spec §12.3 default grid: 5 cost rows x 5 GDV columns', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    // 1 header row + 5 body rows.
    expect(within(matrix).getAllByRole('row')).toHaveLength(6);
    for (const caption of ['GDV -15%', 'GDV -10%', 'GDV -5%', 'GDV +0%', 'GDV +5%']) {
      expect(within(matrix).getByText(caption)).toBeInTheDocument();
    }
    for (const caption of ['Cost -5%', 'Cost +0%', 'Cost +5%', 'Cost +10%', 'Cost +15%']) {
      expect(within(matrix).getByText(caption)).toBeInTheDocument();
    }
  });

  // Spec §12.5: the all-levers-zero cell is the unadjusted appraisal, exactly.
  // Computed from the engine here rather than pinned, so this asserts the
  // identity and not a transcription.
  //
  // Row and column are selected positionally, not by accessible name: the row
  // caption is a <th scope="row">, so getAllByRole('cell') returns only the five
  // <td>s. Default axes are rows [-5,0,5,10,15] and cols [-15,-10,-5,0,5], so the
  // base cell is body row index 1, cell index 3.
  it('shows the unadjusted appraisal in the base cell (spec §12.5)', () => {
    const inputs = buildInputs();
    const expected = `${runAppraisal(inputs).metrics.profit_on_cost_pct!.toFixed(1)}%`;
    render(<SensitivityPage inputs={inputs} />);
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const baseRow = within(matrix).getAllByRole('row')[2]; // header + 'Cost -5%' precede it
    expect(within(baseRow).getAllByRole('rowheader')[0]).toHaveTextContent('Cost +0%');
    expect(within(baseRow).getAllByRole('cell')[3]).toHaveTextContent(expected);
  });

  it('re-renders the matrix in the selected metric', () => {
    const inputs = buildInputs();
    const expected = `${runAppraisal(inputs).metrics.ltgdv_developer_pct!.toFixed(1)}%`;
    render(<SensitivityPage inputs={inputs} />);
    fireEvent.change(screen.getByLabelText(/metric/i), { target: { value: 'ltgdv_developer_pct' } });
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const baseRow = within(matrix).getAllByRole('row')[2];
    expect(within(baseRow).getAllByRole('cell')[3]).toHaveTextContent(expected);
  });

  it('offers all six compact-record metrics', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const select = screen.getByLabelText(/metric/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(6);
  });

  // Spec §12.2: a cell needing more debt than the committed facility does not
  // get it — it raises a flag, and the flag is the finding. Fixture F's +15%
  // cost row is the corner where that happens.
  it('marks flagged cells with their short codes', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    const worstRow = within(matrix).getAllByRole('row')[5]; // 'Cost +15%', the last body row
    expect(within(worstRow).getAllByRole('rowheader')[0]).toHaveTextContent('Cost +15%');
    expect(within(worstRow).getAllByText(/\[(FE|FG|NR)/).length).toBeGreaterThan(0);
  });
});

describe('SensitivityPage — tornado', () => {
  it('lists bars widest swing first (spec §12.4)', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const tornado = screen.getByRole('table', { name: /single-lever/i });
    const labels = within(tornado).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(labels).toEqual(['GDV', 'Construction cost', 'Timeline', 'Interest rate']);
  });

  it('states each bar range in its own unit', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    const tornado = screen.getByRole('table', { name: /single-lever/i });
    expect(within(tornado).getByText('-10% to +10%')).toBeInTheDocument();
    expect(within(tornado).getByText('-3 to +3 months')).toBeInTheDocument();
    expect(within(tornado).getByText('-1.0 to +1.0 pp')).toBeInTheDocument();
  });

  it('prints the base profit as the tornado centre reference', () => {
    const inputs = buildInputs();
    const baseProfit = runAppraisal(inputs).metrics.profit_pence;
    const formatted = (baseProfit / 100).toLocaleString('en-GB', {
      style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
    });
    render(<SensitivityPage inputs={inputs} />);
    expect(screen.getByText(new RegExp(`Base profit.*${formatted.replace(/[£,]/g, '\\$&')}`)))
      .toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/components/calculator/SensitivityPage.test.tsx
```

Expected: FAIL — cannot resolve `./SensitivityPage`.

- [ ] **Step 3: Add the metric list to `sensitivity-format.ts`**

Append to `frontend/src/lib/sensitivity-format.ts`:

```ts
/** The six fields of the §12 compact record, in the order the page offers them. */
export type SensitivityMetricKey =
  | 'profit_pence'
  | 'profit_on_cost_pct'
  | 'profit_on_gdv_pct'
  | 'irr_annual_pct'
  | 'ltgdv_developer_pct'
  | 'peak_debt_pence';

export const SENSITIVITY_METRICS: readonly {
  key: SensitivityMetricKey;
  label: string;
  kind: 'money' | 'pct';
}[] = [
  { key: 'profit_on_cost_pct', label: 'Profit on Cost', kind: 'pct' },
  { key: 'profit_pence', label: 'Profit', kind: 'money' },
  { key: 'profit_on_gdv_pct', label: 'Profit on GDV', kind: 'pct' },
  { key: 'irr_annual_pct', label: 'IRR (Annual)', kind: 'pct' },
  { key: 'ltgdv_developer_pct', label: 'LTGDV (developer basis)', kind: 'pct' },
  { key: 'peak_debt_pence', label: 'Peak Debt', kind: 'money' },
];
```

- [ ] **Step 4: Write the page**

Create `frontend/src/components/calculator/SensitivityPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { CalculatorInputsV4 } from '../../lib/model';
import type { SensitivityCell, SensitivityMetrics } from '../../lib/model/sensitivity';
import { safeRunSensitivity } from '../../lib/safe-sensitivity';
import {
  LEVER_LABEL, LEVER_SHORT, SENSITIVITY_METRICS,
  formatStepLabel, formatRangeLabel, flagShortCodes,
} from '../../lib/sensitivity-format';
import type { SensitivityMetricKey } from '../../lib/sensitivity-format';
import { penceToPounds, formatPct } from '../../lib/format';
import CalculatorFailurePanel from '../CalculatorFailurePanel';

interface Props {
  inputs: CalculatorInputsV4;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED = '#f87171';
const AMBER = '#fbbf24';

function metricText(cell: SensitivityMetrics, key: SensitivityMetricKey): string {
  const metric = SENSITIVITY_METRICS.find((m) => m.key === key)!;
  const value = cell[key];
  return metric.kind === 'money' ? penceToPounds(value as number) : formatPct(value as number | null);
}

/**
 * The amber/red conventions the investment memo's §10 matrices have always
 * used, carried onto the screen. Presentation thresholds, not model rules —
 * spec §12 defines no colouring, and no engine flag depends on these numbers.
 */
function metricColor(key: SensitivityMetricKey, value: number | null): string {
  if (value === null) return MUTED;
  if (key === 'profit_on_cost_pct') return value < 0 ? RED : value < 15 ? AMBER : TEXT;
  if (key === 'ltgdv_developer_pct') return value > 75 ? RED : value > 65 ? AMBER : TEXT;
  if (key === 'profit_pence') return value < 0 ? RED : TEXT;
  return TEXT;
}

export default function SensitivityPage({ inputs }: Props) {
  const [metric, setMetric] = useState<SensitivityMetricKey>('profit_on_cost_pct');

  // One call runs 34 appraisals (25 cells + 8 tornado endpoints + base), so it
  // is memoised on the inputs object exactly as the engine's own docstring asks.
  const outcome = useMemo(() => safeRunSensitivity(inputs), [inputs]);

  if (!outcome.ok) {
    return (
      <div>
        <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 20 }}>9. Sensitivity</h3>
        <CalculatorFailurePanel title="The sensitivity suite could not be calculated">
          {outcome.error.message}
        </CalculatorFailurePanel>
      </div>
    );
  }

  const { base, matrix, tornado, config } = outcome.result;

  // One shared scale across every tornado endpoint and the base, so bar lengths
  // are comparable between levers rather than each bar filling its own row.
  const profits = tornado
    .flatMap((bar) => [bar.low.profit_pence, bar.high.profit_pence])
    .concat(base.profit_pence);
  const minProfit = Math.min(...profits);
  const maxProfit = Math.max(...profits);
  const span = maxProfit - minProfit;
  const pos = (pence: number) => (span === 0 ? 50 : ((pence - minProfit) / span) * 100);

  return (
    <div>
      <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 8 }}>9. Sensitivity</h3>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 24, maxWidth: 780 }}>
        Every cell and every bar re-runs the full appraisal with the committed facility and
        equity sources held at their base values (spec §12.2). A position needing more debt
        than the facility does not receive it — it raises FE (facility exceeded), FG (funding
        gap) or NR (senior debt not repaid within the term), and that flag is the finding.
      </p>

      {/* ── Region 1: tornado ── */}
      <h4 style={{ color: MUTED, fontSize: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        Single-Lever Sensitivity
      </h4>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
        Base profit {penceToPounds(base.profit_pence)} — the centre line below. Bars are
        ordered widest swing first (spec §12.4).
      </p>

      <table
        aria-label="Single-lever sensitivity (tornado)"
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 28 }}
      >
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left', width: 160 }}>Lever</th>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left', width: 160 }}>Range</th>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left' }}>Profit swing</th>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'right', width: 130 }}>Swing</th>
          </tr>
        </thead>
        <tbody>
          {tornado.map((bar) => {
            const lowPos = pos(Math.min(bar.low.profit_pence, bar.high.profit_pence));
            const highPos = pos(Math.max(bar.low.profit_pence, bar.high.profit_pence));
            return (
              <tr key={bar.lever} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <td style={{ padding: '8px 12px', color: TEXT }}>{LEVER_LABEL[bar.lever]}</td>
                <td style={{ padding: '8px 12px', color: MUTED }}>
                  {formatRangeLabel(bar.lever, bar.low_step, bar.high_step)}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ position: 'relative', height: 20, background: PANEL, borderRadius: 4 }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: `${lowPos}%`,
                        width: `${Math.max(highPos - lowPos, 0.5)}%`,
                        top: 3,
                        height: 14,
                        background: '#2563eb',
                        borderRadius: 3,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: `${pos(base.profit_pence)}%`,
                        top: 0,
                        width: 1,
                        height: 20,
                        background: MUTED,
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: MUTED, fontSize: 12, marginTop: 3 }}>
                    <span>{penceToPounds(bar.low.profit_pence)}</span>
                    <span>{penceToPounds(bar.high.profit_pence)}</span>
                  </div>
                </td>
                <td style={{ padding: '8px 12px', color: TEXT, textAlign: 'right', fontWeight: 600 }}>
                  {penceToPounds(bar.span_pence)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Region 2: two-way matrix ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
        <h4 style={{ color: MUTED, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
          Two-Way Sensitivity Matrix
        </h4>
        <label style={{ color: MUTED, fontSize: 13 }}>
          Metric{' '}
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as SensitivityMetricKey)}
            style={{ padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
          >
            {SENSITIVITY_METRICS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
        <table
          aria-label="Two-way sensitivity matrix"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left' }}>
                {LEVER_SHORT[config.rows.lever]} \ {LEVER_SHORT[config.cols.lever]}
              </th>
              {config.cols.steps.map((step) => (
                <th key={step} style={{ padding: '8px 12px', color: MUTED, textAlign: 'right' }}>
                  {`${LEVER_SHORT[config.cols.lever]} ${formatStepLabel(config.cols.lever, step)}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row[0].row_step} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <th scope="row" style={{ padding: '8px 12px', color: TEXT, textAlign: 'left', fontWeight: 600 }}>
                  {`${LEVER_SHORT[config.rows.lever]} ${formatStepLabel(config.rows.lever, row[0].row_step)}`}
                </th>
                {row.map((cell: SensitivityCell) => {
                  const codes = flagShortCodes(cell.flags);
                  return (
                    <td
                      key={cell.col_step}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: metricColor(metric, cell[metric]),
                        fontWeight: cell.row_step === 0 && cell.col_step === 0 ? 700 : 400,
                      }}
                    >
                      {metricText(cell, metric)}
                      {codes && (
                        <span style={{ color: RED, fontSize: 11, marginLeft: 6 }}>[{codes}]</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Note the `<th scope="row">` on each row's label: it is what makes `getByRole('row', { name: /^Cost \+0%/ })` work in the tests, and it is the correct markup for a matrix besides.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/components/calculator/SensitivityPage.test.tsx
npx tsc -b && npx eslint .
```

Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/calculator/SensitivityPage.tsx frontend/src/components/calculator/SensitivityPage.test.tsx frontend/src/lib/sensitivity-format.ts
git commit -m "$(cat <<'EOF'
feat(ui): Sensitivity page — tornado and two-way matrix

Before this, the two-way matrices a lender reads existed only inside the
exported PDF: the Scenarios page showed three named scenarios and no grid, so
nobody could see where the covenants break without generating a memo. The page
renders the spec §12 default suite with a selector over all six compact-record
fields, carrying the memo's amber/red conventions and its FE/FG/NR codes onto
the screen unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The axis and step editor

Design §5.1 region 3: it **mutates view state only** — never writes `inputs`, never triggers autosave, is not persisted, and reloading returns the spec defaults.

**Files:**
- Modify: `frontend/src/components/calculator/SensitivityPage.tsx`
- Modify: `frontend/src/components/calculator/SensitivityPage.test.tsx`

**Interfaces:**
- Consumes: `validateSensitivityConfig`, `defaultSensitivityConfig`, `LEVER_ORDER`, `MAX_AXIS_STEPS` from `../../lib/model/sensitivity`; `SensitivityConfig` type.
- Produces: no new exports. `SensitivityPage`'s props are unchanged — still `{ inputs }`, still no `onChange`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/calculator/SensitivityPage.test.tsx`:

```tsx
describe('SensitivityPage — axis and step editor', () => {
  it('re-runs the suite on an edited column step list', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-20, 0' } });
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('GDV -20%')).toBeInTheDocument();
    expect(within(matrix).queryByText('GDV -15%')).not.toBeInTheDocument();
    // 5 cost rows unchanged, now 2 GDV columns + the row label column.
    const bodyRows = within(matrix).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(5);
    expect(within(bodyRows[0]).getAllByRole('cell')).toHaveLength(2);
  });

  it('switches a row axis to another lever', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '0, 3' } });
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('Timeline +3 months')).toBeInTheDocument();
  });

  // Spec §12.6 errors are input errors, not flags. Showing the reason and
  // hiding the grid is honest; showing the previous grid beside an invalid
  // config would present numbers that are not the current calculation (spec §2).
  it('states the reason and hides the matrix when both axes name one lever', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'gdv' } });
    expect(screen.getByText(/must use different levers/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /two-way sensitivity/i })).not.toBeInTheDocument();
  });

  it('rejects an empty step list', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '' } });
    expect(screen.getByText(/at least one step/i)).toBeInTheDocument();
  });

  it('rejects a fractional timeline step (spec §12.6)', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '0, 1.5' } });
    expect(screen.getByText(/whole months/i)).toBeInTheDocument();
  });

  it('rejects more than nine steps on an axis', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), {
      target: { value: '-20,-15,-10,-5,0,5,10,15,20,25' },
    });
    expect(screen.getByText(/at most 9 steps/i)).toBeInTheDocument();
  });

  // The carried-forward §12.6 gap, and the reason this guard exists at all: the
  // engine does NOT reject a timeline step that empties the term. It clamps to a
  // one-month term, so -11, -12 and -13 on this 12-month deal would render three
  // identical columns under three different captions. The page refuses the axis
  // instead of printing an answer it cannot stand behind.
  it('refuses a timeline step that would empty the term', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-3, -12' } });
    expect(screen.getByText(/at least one month/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /two-way sensitivity/i })).not.toBeInTheDocument();
  });

  it('allows a timeline step that leaves a one-month term', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'timeline' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '-11, 0' } });
    expect(screen.queryByText(/at least one month/i)).not.toBeInTheDocument();
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('Timeline -11 months')).toBeInTheDocument();
  });

  it('restores the spec defaults on reset', () => {
    render(<SensitivityPage inputs={buildInputs()} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-20, 0' } });
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    const matrix = screen.getByRole('table', { name: /two-way sensitivity/i });
    expect(within(matrix).getByText('GDV -15%')).toBeInTheDocument();
  });

  // Design §5.1: view state only. The page has no onChange prop at all, so the
  // strongest available statement is that the inputs object it was handed is
  // untouched after every editor interaction.
  it('never mutates the inputs document', () => {
    const inputs = buildInputs();
    const before = JSON.stringify(inputs);
    render(<SensitivityPage inputs={inputs} />);
    fireEvent.change(screen.getByLabelText(/column steps/i), { target: { value: '-20, 0' } });
    fireEvent.change(screen.getByLabelText(/row lever/i), { target: { value: 'interest_rate' } });
    fireEvent.change(screen.getByLabelText(/row steps/i), { target: { value: '0, 2' } });
    expect(JSON.stringify(inputs)).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend && npx vitest run src/components/calculator/SensitivityPage.test.tsx
```

Expected: FAIL — `getByLabelText(/column steps/i)` finds nothing.

- [ ] **Step 3: Add the editor state and the validation gate**

In `SensitivityPage.tsx`, extend the imports:

```tsx
import {
  defaultSensitivityConfig, validateSensitivityConfig, LEVER_ORDER, MAX_AXIS_STEPS,
} from '../../lib/model/sensitivity';
import type {
  SensitivityCell, SensitivityConfig, SensitivityLever, SensitivityMetrics,
} from '../../lib/model/sensitivity';
```

This replaces the Task 5 type-only import of the same module — do not leave both.

Add above the component:

```tsx
/**
 * Steps are held as the user's raw text, not as numbers, so a half-typed "-" or
 * a trailing comma does not silently become a different grid. Anything that is
 * not a finite number becomes NaN and is reported by validateSensitivityConfig
 * (spec §12.6) rather than dropped — dropping it would quietly run a grid the
 * user did not ask for.
 */
function parseSteps(text: string): number[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
}

function stepsToText(steps: number[]): string {
  return steps.join(', ');
}

const DEFAULTS = defaultSensitivityConfig();
```

Replace the component's state block with:

```tsx
  const [metric, setMetric] = useState<SensitivityMetricKey>('profit_on_cost_pct');
  const [rowLever, setRowLever] = useState<SensitivityLever>(DEFAULTS.rows.lever);
  const [colLever, setColLever] = useState<SensitivityLever>(DEFAULTS.cols.lever);
  const [rowStepsText, setRowStepsText] = useState(stepsToText(DEFAULTS.rows.steps));
  const [colStepsText, setColStepsText] = useState(stepsToText(DEFAULTS.cols.steps));

  const resetToDefaults = () => {
    setRowLever(DEFAULTS.rows.lever);
    setColLever(DEFAULTS.cols.lever);
    setRowStepsText(stepsToText(DEFAULTS.rows.steps));
    setColStepsText(stepsToText(DEFAULTS.cols.steps));
  };

  // The tornado ranges stay at the spec §12.4 defaults in R4b — only the matrix
  // axes are editable, which is the whole of design §5.1's third region.
  const config: SensitivityConfig = useMemo(() => ({
    rows: { lever: rowLever, steps: parseSteps(rowStepsText) },
    cols: { lever: colLever, steps: parseSteps(colStepsText) },
    tornado: DEFAULTS.tornado,
  }), [rowLever, rowStepsText, colLever, colStepsText]);

  const issues = useMemo(() => {
    const found = validateSensitivityConfig(config).map((issue) => issue.message);
    // Spec §12.6 constrains the timeline lever to whole months but says nothing
    // about the term those months leave behind, and the appraisal engine does
    // not reject an empty one — it clamps to a single month and returns a
    // plausible result, so -11, -12 and -13 on a 12-month deal would render
    // three identical columns under three different captions. Refusing the axis
    // is the honest response until §12.6 says otherwise (R5).
    // The tornado's fixed -3 months is included: a deal with a term under four
    // months hits this without the user editing anything.
    const term = inputs.finance.term_months;
    const timelineSteps = [
      ...(config.rows.lever === 'timeline' ? config.rows.steps : []),
      ...(config.cols.lever === 'timeline' ? config.cols.steps : []),
      ...config.tornado.filter((bar) => bar.lever === 'timeline').flatMap((bar) => [bar.low, bar.high]),
    ];
    if (timelineSteps.some((step) => term + step < 1)) {
      found.push(`Every timeline step must leave at least one month of term (this deal runs ${term} months).`);
    }
    return found;
  }, [config, inputs.finance.term_months]);

  // Spec §12.6 errors are input errors: report them and compute nothing, rather
  // than leaving the previous grid on screen beside an invalid config.
  const outcome = useMemo(
    () => (issues.length > 0 ? null : safeRunSensitivity(inputs, config)),
    [inputs, config, issues],
  );
```

- [ ] **Step 4: Render the editor and the two failure surfaces**

Extract the page heading and the editor into a shared prelude so all three render paths carry them. Replace the component's `return` region with this structure (the tornado and matrix JSX from Task 5 is unchanged and goes where marked):

```tsx
  const editor = (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end',
      padding: 16, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 24,
    }}>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Row lever
        <select
          value={rowLever}
          onChange={(e) => setRowLever(e.target.value as SensitivityLever)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        >
          {LEVER_ORDER.map((lever) => (
            <option key={lever} value={lever}>{LEVER_LABEL[lever]}</option>
          ))}
        </select>
      </label>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Row steps
        <input
          type="text"
          value={rowStepsText}
          onChange={(e) => setRowStepsText(e.target.value)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', width: 200, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        />
      </label>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Column lever
        <select
          value={colLever}
          onChange={(e) => setColLever(e.target.value as SensitivityLever)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        >
          {LEVER_ORDER.map((lever) => (
            <option key={lever} value={lever}>{LEVER_LABEL[lever]}</option>
          ))}
        </select>
      </label>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Column steps
        <input
          type="text"
          value={colStepsText}
          onChange={(e) => setColStepsText(e.target.value)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', width: 200, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        />
      </label>
      <button
        type="button"
        onClick={resetToDefaults}
        style={{ padding: '6px 14px', background: '#1e3a5f', border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT, fontSize: 13, cursor: 'pointer' }}
      >
        Reset to defaults
      </button>
      <span style={{ color: MUTED, fontSize: 12, flexBasis: '100%' }}>
        Comma-separated, up to {MAX_AXIS_STEPS} per axis. This view only — nothing here is
        saved with the appraisal, and reloading restores the specified defaults.
      </span>
    </div>
  );

  const heading = (
    <>
      <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 8 }}>9. Sensitivity</h3>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 24, maxWidth: 780 }}>
        Every cell and every bar re-runs the full appraisal with the committed facility and
        equity sources held at their base values (spec §12.2). A position needing more debt
        than the facility does not receive it — it raises FE (facility exceeded), FG (funding
        gap) or NR (senior debt not repaid within the term), and that flag is the finding.
      </p>
    </>
  );

  if (issues.length > 0) {
    return (
      <div>
        {heading}
        {editor}
        <CalculatorFailurePanel title="These axes do not describe a valid grid">
          {issues.join(' ')}
        </CalculatorFailurePanel>
      </div>
    );
  }

  if (!outcome || !outcome.ok) {
    return (
      <div>
        {heading}
        {editor}
        <CalculatorFailurePanel title="The sensitivity suite could not be calculated">
          {outcome ? outcome.error.message : 'No result was produced for these axes.'}
        </CalculatorFailurePanel>
      </div>
    );
  }

  const { base, matrix, tornado, config: resolved } = outcome.result;
  // ... the tornado and matrix JSX from Task 5, unchanged, with `heading` and
  //     `editor` rendered first inside the returned <div>, and every reference
  //     to `config` replaced by `resolved`.
```

The failure panels deliberately render `editor` above them: a user who has typed an axis into an unusable state needs the control that got them there, not a dead end.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/components/calculator/SensitivityPage.test.tsx
npx tsc -b && npx eslint .
```

Expected: PASS (19 tests — Task 5's 8 plus these 11). Both `describe` blocks must be green: if a Task 5 test broke, the prelude extraction changed the default render, which it must not.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/calculator/SensitivityPage.tsx frontend/src/components/calculator/SensitivityPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): editable sensitivity axes, as view state only

A fixed 5x5 grid answers the question the memo asks, not the one an analyst has
in front of them. The axes and steps are now editable — but strictly as view
state: no onChange prop exists on this page, nothing is written to inputs, no
autosave fires, and a reload restores the spec defaults. That was the design's
deliberate choice over an inputs v5 (no migration, and every appraisal's memo
stays directly comparable).

An invalid grid reports its spec §12.6 reason and computes nothing rather than
leaving the previous grid on screen. The page also refuses a timeline step that
would empty the term: §12.6 permits it and the engine does not reject it, it
clamps to one month — so -11, -12 and -13 on a 12-month deal would otherwise
render three identical columns under three different captions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire the page in as calculator page 9

**Files:**
- Modify: `frontend/src/components/ConversionCalculator.tsx`
- Modify: `frontend/src/components/calculator/ExitStrategyPage.tsx:111`
- Modify: `frontend/src/components/calculator/RiskRegisterPage.tsx:52`
- Modify: `frontend/src/components/calculator/DealSpiderPage.tsx:125`
- Modify: `frontend/src/components/calculator/InvestorSummaryPage.tsx:22`
- Modify: `frontend/src/components/ConversionCalculator.test.tsx`

**Interfaces:**
- Consumes: `SensitivityPage` from Task 5/6.
- Produces: `CalcPage` gains `'sensitivity'`; `PAGES` becomes 13 entries.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/ConversionCalculator.test.tsx`:

```tsx
describe('ConversionCalculator — Sensitivity is page 9', () => {
  it('offers thirteen numbered pages with Sensitivity ninth', () => {
    render(<ConversionCalculator project={null} />);
    for (const label of [
      '9. Sensitivity', '10. Exit', '11. Risk', '12. Deal Spider', '13. Investor',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the Sensitivity page when its tab is selected', () => {
    render(<ConversionCalculator project={null} />);
    fireEvent.click(screen.getByRole('button', { name: '9. Sensitivity' }));
    expect(screen.getByRole('heading', { name: /9\. Sensitivity/ })).toBeInTheDocument();
  });
});
```

Make sure `render`, `screen` and `fireEvent` are imported at the top of that file, and `ConversionCalculator` too — check what the existing `describe` block already imports and add only what is missing.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/components/ConversionCalculator.test.tsx
```

Expected: FAIL — no button named `9. Sensitivity`.

- [ ] **Step 3: Register the page**

In `frontend/src/components/ConversionCalculator.tsx`:

Add the import after the `ScenariosPage` import (line 18):

```tsx
import SensitivityPage from './calculator/SensitivityPage';
```

Add `'sensitivity'` to the `CalcPage` union, between `'scenarios'` and `'exit_strategy'`:

```tsx
type CalcPage =
  | 'acquisition'
  | 'unit_mix'
  | 'conversion_costs'
  | 'finance'
  | 'programme'
  | 'cashflow'
  | 'appraisal'
  | 'scenarios'
  | 'sensitivity'
  | 'exit_strategy'
  | 'risk_register'
  | 'deal_spider'
  | 'investor_summary';
```

Replace the `PAGES` list:

```tsx
const PAGES: { key: CalcPage; label: string; num: number }[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1 },
  { key: 'unit_mix', label: 'Unit Mix', num: 2 },
  { key: 'conversion_costs', label: 'Costs', num: 3 },
  { key: 'finance', label: 'Finance', num: 4 },
  { key: 'programme', label: 'Programme', num: 5 },
  { key: 'cashflow', label: 'Cashflow', num: 6 },
  { key: 'appraisal', label: 'Appraisal', num: 7 },
  { key: 'scenarios', label: 'Scenarios', num: 8 },
  { key: 'sensitivity', label: 'Sensitivity', num: 9 },
  { key: 'exit_strategy', label: 'Exit', num: 10 },
  { key: 'risk_register', label: 'Risk', num: 11 },
  { key: 'deal_spider', label: 'Deal Spider', num: 12 },
  { key: 'investor_summary', label: 'Investor', num: 13 },
];
```

Add the dispatch branch immediately after the `scenarios` branch, inside `CalculatorErrorBoundary`:

```tsx
        {activePage === 'sensitivity' && (
          <SensitivityPage inputs={inputs} />
        )}
```

`SensitivityPage` takes neither `onChange` nor `run` — it computes its own suite from `inputs` and its base cell *is* the unadjusted appraisal (spec §12.5), so passing `run` would be a second source for the same number.

- [ ] **Step 4: Renumber the four downstream page headings**

These are display strings only; nothing reads them.

```bash
cd frontend
sed -i 's|>9\. Exit Strategy<|>10. Exit Strategy<|' src/components/calculator/ExitStrategyPage.tsx
sed -i 's|>10\. Risk Register<|>11. Risk Register<|' src/components/calculator/RiskRegisterPage.tsx
sed -i 's|>11\. Deal Spider<|>12. Deal Spider<|' src/components/calculator/DealSpiderPage.tsx
sed -i 's|>12\. Investor Summary<|>13. Investor Summary<|' src/components/calculator/InvestorSummaryPage.tsx
grep -n '<h3' src/components/calculator/{ExitStrategyPage,RiskRegisterPage,DealSpiderPage,InvestorSummaryPage}.tsx
```

Expected from the `grep`: `10. Exit Strategy`, `11. Risk Register`, `12. Deal Spider`, `13. Investor Summary`. Run the `sed` commands in exactly this order — running them in the reverse order would cascade one rename into the next.

- [ ] **Step 5: Run the full suite**

```bash
cd frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
cd .. && python -m pytest -q 2>&1 | tail -3
```

Expected: all frontend tests pass; pytest still reports **750 passed** with no file under `app/` or `fixtures/` modified (`git status --porcelain` should show nothing outside `frontend/` and `docs/`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ConversionCalculator.tsx frontend/src/components/ConversionCalculator.test.tsx frontend/src/components/calculator/ExitStrategyPage.tsx frontend/src/components/calculator/RiskRegisterPage.tsx frontend/src/components/calculator/DealSpiderPage.tsx frontend/src/components/calculator/InvestorSummaryPage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Sensitivity becomes calculator page 9

Slotting it directly after Scenarios puts the grid next to the named scenarios
it shares a lever rule with (spec §12.1), and renumbers Exit through Investor to
10-13. The page is dispatched inside CalculatorErrorBoundary, so unlike
runAppraisal — which ConversionCalculator still calls in its own render body,
above the boundary — a sensitivity throw is caught by the boundary as well as by
safeRunSensitivity. It takes neither onChange nor run: it writes nothing, and
its base cell is the unadjusted appraisal by spec §12.5.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Live browser UAT, gates and the release report

**Files:**
- Create: `docs/reviews/2026-08-16-release-4b-uat.md`
- Create: `docs/reviews/2026-08-16-release-4b-implementation-report.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the release record. No code.

- [ ] **Step 1: Run every gate from a clean tree**

```bash
cd frontend && npx vitest run && npx tsc -b && npx eslint . && npm run build
cd .. && python -m pytest -q 2>&1 | tail -3
git status --porcelain      # expect: nothing outside frontend/ and docs/
git stash list              # expect: unchanged from Task 0
```

Record the exact test counts. Do not proceed with any gate red.

- [ ] **Step 2: Restart the frontend container and open the app**

```bash
docker restart commercial-resi-analyser-frontend-1
```

Windows bind mounts do not propagate inotify, so the container serves a stale Vite module graph until it is restarted. Skipping this makes the UAT test the previous build.

Then drive the browser (Chrome tools) through the calculator on a project with a saved appraisal.

- [ ] **Step 3: Walk the UAT checklist, capturing a screenshot for each**

1. The tab bar reads `… 8. Scenarios | 9. Sensitivity | 10. Exit | 11. Risk | 12. Deal Spider | 13. Investor`.
2. Page 9 renders the tornado with four bars, GDV first, and the base-profit centre line visible on each.
3. The two-way matrix renders 5 × 5 with `Cost` row captions and `GDV` column captions.
4. The `(Cost +0%, GDV +0%)` cell is emboldened and matches the Appraisal page's Profit on Cost exactly (spec §12.5) — screenshot both pages.
5. The metric selector switches all six fields, and Peak Debt / Profit render as currency while the four percentages render as percentages.
6. A cell that breaches the committed facility shows its `[FE]` / `[FG]` / `[NR]` code in red.
7. Editing **Column steps** to `-20, -10, 0` re-renders three columns immediately.
8. Setting both levers to GDV shows the "must use different levers" panel and no matrix.
9. **Reset to defaults** restores the 5 × 5 grid.
10. Navigating away to page 10 and back to page 9 shows the spec defaults again — the editor is not persisted (design §5.1).
11. Saving the appraisal after editing the axes and reloading the project shows the defaults, confirming nothing entered `inputs`.
12. Exporting the investment memo produces a §10 with the tornado table above the two matrices, and the matrices' numbers match a memo exported from `main` before this branch.

13. Setting the row lever to Timeline with a step that exceeds the deal's term (e.g. `-12` on a 12-month deal) shows the "at least one month of term" panel and no matrix.

Item 12 is the visual counterpart of the Task 1 regression pin — if the two PDFs disagree in §10's matrices, stop and report it. Item 13 is the visual counterpart of Task 6's term guard, and the reason it exists: without it that axis renders identical columns under different captions.

- [ ] **Step 4: Write the UAT record**

Create `docs/reviews/2026-08-16-release-4b-uat.md` following the structure of `docs/reviews/2026-08-15-release-3b-uat.md`: the date, the build under test (branch + commit), the checklist above with a pass/fail and a screenshot reference per item, and a "defects found" section. Save screenshots under `docs/reviews/assets/`.

Record failures as failures. A UAT that finds nothing on a release this size is more likely an incomplete UAT than a clean one.

- [ ] **Step 5: Write the implementation report**

Create `docs/reviews/2026-08-16-release-4b-implementation-report.md` following `docs/reviews/2026-08-15-release-3b-implementation-report.md`: what shipped, the gate results with exact counts, decisions taken during implementation, and the carry-forward list. Carry forward at minimum:

- **Spec §12.6 does not bound the resulting term, and the engine clamps rather than rejecting.** A `timeline` step can drive `finance.term_months` to zero or below; the appraisal engine silently clamps to a one-month term, so on fixture F steps of −11, −12 and −13 all return profit 26,556,933p with a `funding_gap` flag. R4b guards this in `SensitivityPage` only — the memo, the named scenarios and any other `applyScenario` caller are still exposed. The real fix is a §12.6 rule plus an engine-level rejection (R5).
- **Tornado ranges are not editable** in R4b — only the matrix axes are. If users want them, that is R5 UI work with no spec implication.
- **The `kind !== 'sensitivity'` corpus filter is still hand-copied** into 3 TS and 2 Python files (carried from R4a, untouched here).
- Whatever the UAT turned up.

- [ ] **Step 6: Commit and merge**

```bash
git add docs/reviews/
git commit -m "$(cat <<'EOF'
docs(review): Release 4b UAT record and implementation report

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then use the **superpowers:finishing-a-development-branch** skill to decide the integration. The expected shape, matching R2/R3/R4a: `git checkout main && git merge --no-ff release-4b-ui-memo` with a `merge: Release 4b — sensitivity UI and memo (calc 2.4.0, no calculation change)` subject.

**Note the standing push question.** Local `main` is currently **20 commits ahead of `origin/main` (9c954f5)** — R4a was never pushed. Ask before pushing; do not push unprompted.

---

## Self-Review

**Spec coverage against design §5:**

| Design requirement | Task |
|---|---|
| §5.1 Sensitivity page inserted after Scenarios, `CalcPage` key `sensitivity` | 7 |
| §5.1 Renumber Exit → 10, Risk → 11, Deal Spider → 12, Investor → 13 | 7 |
| §5.1 Region 1 — tornado, sorted per §2.3, base profit as centre line | 5 |
| §5.1 Region 2 — two-way matrix, metric selector over the six compact-record fields, flag codes, red/amber conventions | 5 |
| §5.1 Region 3 — axis/step editor, view state only, never writes inputs, not persisted | 6 |
| *(added during planning)* page-level guard on a term-emptying timeline step | 6 |
| §5.1 `useMemo` keyed on the inputs object | 5 |
| §5.1 Inline styles, no Tailwind | 5, 6 (and Global Constraints) |
| §5.1 Renders under `CalculatorErrorBoundary` | 7 |
| §5.2 Memo drops `gdvSteps`/`costSteps` and calls `runSensitivity` | 2 |
| §5.2 `flagShortCodes` stays as the presentation mapping | 2 (moved to `sensitivity-format.ts`, unchanged in behaviour) |
| §5.2 Tornado joins §10 as a third table, above the two matrices | 3 |
| §5.2 Hard regression invariant, asserted against pre-refactor values | 1 (pinned), 2 (unmoved) |
| §5.2 Scenario Comparison and named scenarios untouched | 1–3 (never touched) |
| §5.3 Live browser UAT, `docs/reviews/2026-08-16-release-4b-uat.md`, docker restart first | 8 |
| §6 Gates: vitest, pytest, `tsc -b`, eslint, build | every task; full sweep in 8 |
| §7 Documentation changes | **none apply** — every item in design §7 was delivered by R4a. R4b changes no spec, no governance entry, no test-cases derivation and no `CALC_VERSION`. |

**Note on §7:** design §7's list is R4a's. R4b makes no calculation change, so it correctly touches none of it. This is stated in the Global Constraints so an executor does not "helpfully" bump the calc version.

**Verified while planning, not assumed:** the pre-refactor matrix literals in Task 1 were captured from a live run of the calc-2.4.0 build, and `runSensitivity`'s default config was confirmed to reproduce all 25 cells identically before this plan was written — Task 2 is a refactor whose no-op status is already known, not hoped for. The term-clamping behaviour underpinning Task 4 and Task 6 was likewise verified against fixture F rather than inferred from the spec.

**Type consistency check:** `SensitivityPage`'s `issues` is `string[]` (Task 6 folds the engine's `ValidationIssue[]` messages together with the page's own term-guard message), and the failure panel renders `issues.join(' ')`. `sensitivityTables` keeps one signature across Tasks 1–3 (its return interface gains `tornadoRows` in Task 3, declared in Task 1's Interfaces block). `flagShortCodes` changes signature exactly once, in Task 2, from `(flags: ModelFlag[])` to `(codes: readonly FlagCode[])`, and its only call site moves with it. `SensitivityPage`'s props are `{ inputs }` in Tasks 5, 6 and 7 with no `onChange` and no `run` at any point. `SensitivityMetricKey` is introduced in Task 5 and used in Tasks 5 and 6 under that name throughout.
