# Release 7 sample investment memoranda

Rendered from the report release gate's own fixtures
(`frontend/src/lib/report-qa/memo-fixtures.ts`) at calc `2.6.0`, with a fixed
generation timestamp (17 Aug 2026 10:30 Europe/London) and placeholder hashes,
so re-rendering produces byte-comparable documents.

| File | Route | Pages | Draft banner |
|---|---|---:|---|
| `memo-sell.pdf` | sell all | 13 | NOT APPROVED |
| `memo-retain.pdf` | retain all | 13 | SENIOR DEBT NOT REPAID |
| `memo-refinance.pdf` | retain + refinance | 13 | NOT APPROVED |
| `memo-blended.pdf` | part sale, phased, part retained | 13 | UNRECONCILED |
| `memo-legacy-draft.pdf` | migrated v1 snapshot | 12 | UNRECONCILED |

All five carry no content outside the page box, no blank, orphaned or sparse
page, no orphaned heading, and a complete provenance panel — asserted by
`memo-release-gate.test.ts`, not by inspection of these files.

The three different banners are the point of the set: they are the three
conditions of spec §13.3, and each document fails a different one.

To regenerate, see the emit harness described in
`docs/reviews/2026-08-17-release-7-implementation-report.md` §10.2 — note that
rasterising them for visual review needs a PDF renderer this project does not
depend on.
