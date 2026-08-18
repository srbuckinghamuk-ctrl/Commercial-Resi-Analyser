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
            + 'If you are the areas module, the type definitions, migration, defaults or the '
            + 'cost-page editor, add this file to the allowlist in eslint.config.js.',
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
      ],
    },
  },
  {
    // The allowlist for the single-accessor rule above. These files either OWN
    // the value (areas.ts, acquisition-tax.ts), DECLARE it (the type modules),
    // WRITE it as the user's manual input (ConversionCostsPage), construct
    // documents where no accessor exists yet (migration, defaults), or build
    // fixture input documents (memo-fixtures.ts — same category as the
    // `*.test.*` files below, but its filename does not match that glob).
    //
    // Known limitation, recorded rather than glossed (spec §3.4): test files are
    // exempt because fixtures must construct the raw field, so a consumer defect
    // written inside a test file is not caught by this rule.
    files: [
      'src/lib/model/areas.ts',
      'src/lib/tax/acquisition-tax.ts',
      'src/lib/conversion-types.ts',
      'src/lib/model/finance-types.ts',
      'src/lib/model/migrate.ts',
      'src/lib/conversion-defaults.ts',
      'src/components/calculator/ConversionCostsPage.tsx',
      'src/lib/report-qa/memo-fixtures.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
])
