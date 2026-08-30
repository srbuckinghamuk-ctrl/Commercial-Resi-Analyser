# Commercial-Resi-Analyser — frontend

React + TypeScript + Vite client for the appraisal engine. The TypeScript
financial model under `src/lib/model/` is one of the two independent
implementations of `docs/financial-model/calculation-specification.md`
(the other is `app/financial_model/` in Python); both must agree to the penny
on every golden fixture under `fixtures/financial-model/`.

## Scripts

```bash
npm install
npm run dev          # Vite dev server on :5173, proxying /api to :8000
npm run build        # tsc -b && vite build, then the bundle gate
npm run lint         # eslint
npx tsc -b           # type-check only
npx vitest run       # the full unit suite
npx vitest run src/lib/model/elemental-benchmark.test.ts   # one file
```

## The five gates

Every change ships only when all five are green, in this order:

1. `npx vitest run` — unit and fixture parity tests (the golden corpus, the
   migration identity gates, the memo and PDF QA harness).
2. `python -m pytest -q` (from the repository root) — the Python twin's suite,
   including the cross-engine parity and message-drift tests that read this
   package's source.
3. `npm run lint` — eslint, including the accessor guard below.
4. `npx tsc -b` — strict type-check; several invariants are pinned with
   `satisfies` so a missing case is a compile error.
5. `npm run build` — the production build and the bundle gate.

## The accessor guard

`model-governance.md` §9 forbids reading certain raw fields anywhere but their
one accessor (for example `total_construction_sqm` outside
`developedAreaSqm`, and the tax band table outside `calculateAcquisitionTax`);
§9.2's table lists every covered value, including R17's `SQFT_PER_SQM` and
`benchmarkContentHash`. The `no-restricted-syntax` rules in `eslint.config.js`
fail the lint gate on a violation; test files are exempt (§9.5). If you need a
value, import the accessor.

## The bundle gate

`scripts/assert-bundle.mjs` runs after `vite build` and fails when the static
closure of the entry chunk exceeds 512,000 bytes. The memo generator, the PDF
library and the calculator pages load behind dynamic seams
(`LazyLoadBoundary`); a seam that stops being dynamic is caught here. Do not
raise the ceiling to make a build pass — move the import behind a seam.

## Area units

The document stores square metres and pence per square metre only. The m²/ft²
toggle is a presentation preference held in `AreaUnitProvider` (React
context, persisted under `localStorage` key `cra.area_unit`) and passed to the
memo as an explicit option; it never touches an input, so toggling cannot
move `input_hash` or make a lender case stale. Use `useAreaUnit()` and the
formatters in `src/lib/area-units.ts` (`formatAreaBoth`, `formatRatePence`)
for every printed area or rate; never write a `m²` literal or a `10.7639`
constant in a component. The lender-valuation module's own `10.7639` is a
stored calculation convention and is deliberately left alone.

## Authentication

`AuthProvider` keeps the bearer token in `sessionStorage`; `src/lib/api.ts`
sends `Authorization: Bearer …` on every request. Writes to lender cases,
users, benchmark sets and index datasets require a signed-in user with an
allowed role; the lender-case page offers only the transitions the server's
role matrix allows and prints the server's refusal verbatim.
