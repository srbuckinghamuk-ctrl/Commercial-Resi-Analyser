import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Restores the codebase's existing `_name` convention for a destructured
      // property discarded only to drop it from a rest spread (e.g.
      // `const { inputs_version: _v2Version, ...rest } = v2`, used across the
      // v2/v3 migration helpers) — `no-unused-vars` was flagging that pattern
      // even though the underscore prefix already signals "intentionally
      // unused" and `ignoreRestSiblings` is the rule's own option for exactly
      // this destructure-then-spread shape.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],

      // R9 (spec §15.4) — single-accessor enforcement.
      //
      // Two values in this codebase are derived once and consumed everywhere:
      // the construction cost area and the acquisition tax. R8 proved that
      // convention alone does not hold them — the same "moved the computation,
      // missed a consumer" defect recurred three times in one release, each
      // site individually self-consistent and therefore invisible to a green
      // test suite.
      //
      // Read the area through `developedAreaSqm`/`areaBridge` (model/areas.ts)
      // and the tax through `calculateAcquisitionTax` (tax/acquisition-tax.ts).
      'no-restricted-syntax': ['error',
        {
          selector: "MemberExpression[property.name='total_construction_sqm']",
          message:
            'Do not read total_construction_sqm directly — call developedAreaSqm(inputs) '
            + 'from model/areas.ts. It resolves the bridge-derived vs manual basis (spec §15.3). '
            + 'If you are the areas module, the type definitions, migration or defaults, add this '
            + 'file to the allowlist in eslint.config.js. ConversionCostsPage.tsx\'s own '
            + 'legitimate read is an eslint-disable-next-line at the call site instead (R10 Task 9) '
            + '— see the allowlist comment below for why.',
        },
        {
          // Same field, destructured: `const { total_construction_sqm } = costs`.
          // The MemberExpression selector above cannot see this shape at all —
          // there is no member access to match — so a consumer could have
          // destructured its way straight past the guard. Scoped to
          // `ObjectPattern` deliberately: an ObjectExpression property of the
          // same name is a WRITE (`updateCosts({ total_construction_sqm: v })`,
          // migration output, defaults), which this rule has never restricted.
          selector: "ObjectPattern > Property[key.name='total_construction_sqm']",
          message:
            'Do not destructure total_construction_sqm out of the cost block — call '
            + 'developedAreaSqm(inputs) from model/areas.ts. It resolves the bridge-derived vs '
            + 'manual basis (spec §15.3).',
        },
        {
          // Same field, computed: `costs['total_construction_sqm']`. A computed
          // MemberExpression carries the name on `property.value` (a Literal),
          // not `property.name` (an Identifier), so the first selector misses it.
          selector: "MemberExpression[computed=true][property.value='total_construction_sqm']",
          message:
            'Do not read total_construction_sqm through a computed member access — call '
            + 'developedAreaSqm(inputs) from model/areas.ts. It resolves the bridge-derived vs '
            + 'manual basis (spec §15.3).',
        },
        {
          // `TAX_TABLES` is an exported top-level const, imported by name — so it
          // appears as a bare Identifier, NOT a MemberExpression. Matching it with
          // a MemberExpression selector (the shape that is correct for
          // `costs.total_construction_sqm`) would compile fine and never fire,
          // which is the "a plausible default is the same defect as a wrong
          // number" trap R8 recorded. Verified against the real symbol before
          // being written here.
          selector: "Identifier[name='TAX_TABLES']",
          message:
            'Do not read the acquisition-tax band table directly — call calculateAcquisitionTax() '
            + 'from tax/acquisition-tax.ts, which selects the jurisdiction and date-effective band '
            + 'set (spec §14). Only the files on the allowlist below (acquisition-tax.ts itself, '
            + 'test files, and the fixture builders that construct raw input documents) may '
            + 'reference TAX_TABLES directly.',
        },
        {
          // The hole the TAX_TABLES rule left open: `selectBandSet` is an
          // exported function that hands back the very `.bands` array TAX_TABLES
          // holds, so a consumer could evaluate its own acquisition tax through
          // it and trip neither half of the guard. Restricted on the same
          // Identifier shape and for the same reason.
          //
          // model/validation.ts legitimately calls it — to surface an
          // out-of-range acquisition date as a ValidationIssue, not to compute
          // tax — and is allowlisted at its two CALL SITES with
          // `eslint-disable-next-line` comments rather than by being added to
          // the file allowlist below. A file-level exemption would switch the
          // whole rule off for validation.ts, including the cost-area
          // selectors; accessor-guard.test.ts pins that validation.ts never
          // appears in this config.
          selector: "Identifier[name='selectBandSet']",
          message:
            'Do not select acquisition-tax band sets directly — call calculateAcquisitionTax() '
            + 'from tax/acquisition-tax.ts (spec §14). selectBandSet returns the raw band array, '
            + 'so computing tax through it bypasses the single accessor exactly as reading '
            + 'TAX_TABLES would. Only acquisition-tax.ts itself, test files, and validation.ts\'s '
            + 'two explicitly disabled date-check call sites may reference it.',
        },
        {
          // R10 spec §16 — single-accessor enforcement for the cost plan. Once
          // Task 5 shipped `cost_plan`, `conversion_costs.contingency_pct` is a
          // legacy field: still on the type (a pre-v7 document and the engine's
          // legacy fallback both use it), but no longer the live figure for a
          // document that carries a `cost_plan` block. Read the resolved
          // contingency through `run.metrics.cost_plan.contingency` instead.
          selector: "MemberExpression[property.name='contingency_pct']",
          message:
            'Do not read contingency_pct directly — read run.metrics.cost_plan.contingency '
            + '(model/cost-plan.ts). It resolves the detailed-mode package classes vs the '
            + 'legacy headline percentage (spec §16). If you are the cost-plan module or the '
            + 'type/migration/defaults modules that construct a raw document, add this file to '
            + 'the allowlist in eslint.config.js. Any other genuinely legitimate raw read (e.g. '
            + 'validating pre-cost_plan input) should be an eslint-disable-next-line at the call '
            + 'site, not a file-wide exemption — see the allowlist comment below for why.',
        },
        {
          // Same field, destructured: `const { contingency_pct } = costs`. See
          // the total_construction_sqm destructuring selector above for why this
          // needs its own selector and why it is scoped to ObjectPattern only.
          selector: "ObjectPattern > Property[key.name='contingency_pct']",
          message:
            'Do not destructure contingency_pct out of the cost block — read '
            + 'run.metrics.cost_plan.contingency (model/cost-plan.ts). It resolves the '
            + 'detailed-mode package classes vs the legacy headline percentage (spec §16).',
        },
        {
          // Same field, computed: `costs['contingency_pct']`. See the
          // total_construction_sqm computed-access selector above for why the
          // property name lands on `property.value`, not `property.name`, here.
          selector: "MemberExpression[computed=true][property.value='contingency_pct']",
          message:
            'Do not read contingency_pct through a computed member access — read '
            + 'run.metrics.cost_plan.contingency (model/cost-plan.ts). It resolves the '
            + 'detailed-mode package classes vs the legacy headline percentage (spec §16).',
        },
        {
          // R11 spec §17.2 rule 2 — single-accessor enforcement for the VAT
          // block. The R10 post-mortem records a schema carrying two mechanisms
          // for one fact, where the engines read one and the product wrote the
          // other; `vat.treatments` plus a per-line `vat_override` is
          // structurally capable of repeating it. `resolveVatTreatment` applies
          // the precedence (override, else the category row) and is the only
          // function that may see either. The same three read shapes as the
          // cost-area and contingency selectors above, because a destructure or
          // a computed access is a different AST node the member selector
          // cannot match at all.
          selector: "MemberExpression[property.name='treatments']",
          message:
            'Do not read vat.treatments directly — call resolveVatTreatment() from '
            + 'model/vat.ts. It applies the line-override-then-category precedence and the '
            + 'not-registered inert case (spec §17.2). If you are the VAT module, the type '
            + 'definitions, migration or defaults, add this file to the allowlist in '
            + 'eslint.config.js; any other genuinely legitimate raw read should be an '
            + 'eslint-disable-next-line at the call site, not a file-wide exemption.',
        },
        {
          selector: "ObjectPattern > Property[key.name='treatments']",
          message:
            'Do not destructure treatments out of the VAT block — call resolveVatTreatment() '
            + 'from model/vat.ts (spec §17.2). Scoped to ObjectPattern: an ObjectExpression '
            + 'property of the same name is a WRITE (defaults, migration output), which this '
            + 'rule has never restricted.',
        },
        {
          selector: "MemberExpression[computed=true][property.value='treatments']",
          message:
            'Do not read vat.treatments through a computed member access — call '
            + 'resolveVatTreatment() from model/vat.ts (spec §17.2).',
        },
        {
          // The other half of §17.2 rule 1. An override read outside the
          // resolver is how the precedence gets re-implemented — and a second
          // implementation of a precedence rule is R10's defect exactly.
          selector: "MemberExpression[property.name='vat_override']",
          message:
            'Do not read a vat_override directly — call resolveVatTreatment() from '
            + 'model/vat.ts, passing the override as the charge\'s `override` (spec §17.2). '
            + 'It is the one site that applies the override-over-category precedence and '
            + 'keeps evidence_status a category fact.',
        },
        {
          selector: "ObjectPattern > Property[key.name='vat_override']",
          message:
            'Do not destructure vat_override out of a package or fee line — call '
            + 'resolveVatTreatment() from model/vat.ts (spec §17.2).',
        },
        {
          selector: "MemberExpression[computed=true][property.value='vat_override']",
          message:
            'Do not read a vat_override through a computed member access — call '
            + 'resolveVatTreatment() from model/vat.ts (spec §17.2).',
        },
        {
          // R11 spec §17.7 — the escape hatch out of the ChargeableConsideration
          // brand. `asChargeableConsideration` is an exported function imported
          // by name, so it appears as a bare Identifier, NOT a MemberExpression
          // — the same shape as `selectBandSet` and `TAX_TABLES` above, and for
          // the same reason. A MemberExpression selector here would lint clean
          // and never fire (R9's recorded defect); verified against the real
          // symbol, and watched failing, before being written here.
          selector: "Identifier[name='asChargeableConsideration']",
          message:
            'Do not call asChargeableConsideration() to brand a raw number — call '
            + 'chargeableConsiderationPence(inputs) from model/vat.ts, which adds purchase '
            + 'VAT where the vendor has opted to tax and TOGC does not apply (spec §17.7). '
            + 'SDLT, LBTT and LTT are all charged on the VAT-INCLUSIVE consideration, and '
            + 'passing the exclusive price under-reports a PERMANENT cost. Only '
            + 'acquisition-tax.ts (which declares the brand), vat.ts (which owns the '
            + 'accessor), the document-constructing modules on the allowlist below, and '
            + 'test files may call it.',
        },
      ],
    },
  },
  {
    // The allowlist for the single-accessor rule above. These files either OWN
    // the value (areas.ts, acquisition-tax.ts, cost-plan.ts), DECLARE it (the
    // type modules), construct documents where no accessor exists yet
    // (migration, defaults), or build fixture input documents
    // (memo-fixtures.ts — same category as the `*.test.*` files below, but its
    // filename does not match that glob).
    //
    // ConversionCostsPage.tsx is deliberately NOT here (R10 Task 9). It still
    // legitimately reads total_construction_sqm as the manual-basis area
    // editor, but that is now the ONLY field this file may read raw — a
    // file-wide exemption would also switch off the new contingency_pct
    // selectors for its (illegitimate, pending Task 12) contingency_pct read.
    // The legitimate total_construction_sqm read is exempted at its own call
    // site instead, exactly as validation.ts's selectBandSet calls are below.
    //
    // conversion-calc-engine.ts is deliberately NOT here either (R10 Task 9 fix
    // round 1, C1). calculateTotalConstructionCost has one legitimate
    // contingency_pct read, but this file also holds calculateTotalAcquisitionCost
    // (R8's first defect site) and calculateTotalConstructionCost's own docstring
    // claims a raw total_construction_sqm read here is a build failure — a
    // file-wide exemption would have made that claim false while looking
    // unrelated. Exempted at the one call site instead.
    //
    // Known limitation, recorded rather than glossed (spec §3.4): test files are
    // exempt because fixtures must construct the raw field, so a consumer defect
    // written inside a test file is not caught by this rule.
    // R11 spec §17.2 rule 2: "the allowlist gains exactly one file" —
    // src/lib/model/vat.ts, which OWNS `resolveVatTreatment` and
    // `chargeableConsiderationPence`. It is the same category as areas.ts and
    // cost-plan.ts, not a widening: it holds five legitimate raw reads (the
    // resolver's `vat.treatments`, and computeVat's four collect-and-forward
    // `vat_override` reads that hand the value straight to the resolver
    // without interpreting it). accessor-guard.test.ts asserts this array's
    // EXACT contents, so any future addition fails a test rather than
    // silently un-guarding whatever else that file happens to read — R10
    // found a widening whose guard test pinned the hole it had opened.
    files: [
      'src/lib/model/areas.ts',
      'src/lib/tax/acquisition-tax.ts',
      'src/lib/model/cost-plan.ts',
      'src/lib/model/vat.ts',
      'src/lib/conversion-types.ts',
      'src/lib/model/finance-types.ts',
      'src/lib/model/migrate.ts',
      'src/lib/conversion-defaults.ts',
      'src/lib/report-qa/memo-fixtures.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
])
