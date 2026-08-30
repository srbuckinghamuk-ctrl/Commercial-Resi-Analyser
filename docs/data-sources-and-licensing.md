# Data sources and licensing — the benchmark library and index datasets

R17 (spec §27.6; design decisions 9–10; stated limitations §27.9 1–3).
This page records what data the product ships, under what licence, what it
deliberately does not ship, and how a person puts data into the library.

## 1. Summary

| Item | Shipped? | Licence | Where |
|---|---|---|---|
| Elemental cost benchmark rates (BCIS or any other provider) | **No** | — | Library is empty; see §2 |
| ONS Construction Output Price Indices, Q2 2026 (ten monthly series) | **Yes**, as data | Open Government Licence v3.0, Crown copyright | `data/index-datasets/ons-construction-opi-2026q2.json` |
| Test benchmark set `TEST FIXTURE — NOT MARKET DATA` | Fixture only, never seeded | Fictional; no licence required | `fixtures/benchmarks/test-elemental-benchmark-set.json` |

Nothing in the repository fetches from the internet at runtime. No route
downloads anything (§27.9 limitation 3).

## 2. Elemental benchmark rates: the library ships empty

**BCIS (Building Cost Information Service).** The BCIS product pages were
read on 30 August 2026. BCIS elemental cost data — elemental analyses,
quartile rates, sample counts, the Tender Price Index (TPI) and the location
factors — are subscription-only and licensed to the subscribing organisation.
The licence does not permit redistribution inside a software product, so
**nothing from BCIS is bundled** in this repository, its fixtures, its seed
data or its tests.

No other lawful, reusable elemental-rate source with quartiles and sample
counts was found (design decision 10). Consequently:

- The elemental benchmark library (`benchmark_sets`, `benchmark_rates`) is
  **empty on a fresh install**, and the product says so in the
  benchmark panel and the memo (§27.9 limitation 1).
- The product cannot benchmark a scheme out of the box. A licensed BCIS
  subscriber, a QS with their own cost plan, or an organisation holding a
  set it is entitled to redistribute, imports it by hand (§4).
- The only elemental rates anywhere in the repository are the fixture's
  (§5), which are fictional and labelled as such.

### Provider tiers (spec §27.5 rules 10–12)

Every imported set carries a `provider_type` and the fields that tier
requires; an import missing one is refused with a 422 naming the field.

| `provider_type` | Required | Meaning |
|---|---|---|
| `bcis_licensed` | `source_title`, `licence_or_permission`, `imported_by`, `building_function`, `source_publication_date`, `location_factor`, `base_index_name`, `base_index_value` | A BCIS export the importing organisation is licensed to use. The licence reference is recorded on the row and printed in the memo's provenance. |
| `public_benchmark` | `provider_name`, `source_title`, `source_url`, `licence_or_permission`, `source_publication_date`, `retrieved_at` | A published dataset under a stated open licence, with the URL and retrieval date that let a reader find the same file. |
| `user_qs` | `source_title`, `imported_by`, `base_date` | A quantity surveyor's own cost plan, attributed to the person who entered it. |

## 3. ONS Construction Output Price Indices (OPI)

**What ships.** `data/index-datasets/ons-construction-opi-2026q2.json`:

| Field | Value |
|---|---|
| Publisher | Office for National Statistics |
| Title | Construction Output Price Indices (OPIs), Quarter 2 (April to June) 2026 |
| Source file | `https://www.ons.gov.uk/file?uri=/businessindustryandtrade/constructionindustry/datasets/interimconstructionoutputpriceindices/current/bulletindataset9.xlsx` |
| Released | 13 August 2026 |
| Retrieved | 30 August 2026 |
| Source-file SHA-256 | `ea0cbfe6573be52210ea0469f182ac5f03c68af39b193ab0f328feb24626edde` |
| Base | 2015 = 100 |
| Coverage | monthly, January 2014 – June 2026 (150 observations per series), Great Britain |
| Series | `all_new_work`, `all_repair_maintenance`, `all_construction`, `new_housing`, `new_public_other`, `new_private_industrial`, `new_private_commercial`, `new_infrastructure`, `rm_housing`, `rm_non_housing` |
| Licence | Open Government Licence v3.0 |

**Attribution.** Contains public sector information licensed under the Open
Government Licence v3.0. Source: Office for National Statistics, *Construction
Output Price Indices (OPIs), Quarter 2 (April to June) 2026*. Crown copyright.
The OGL v3 text is at
<https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/>.
The product reproduces this attribution wherever an OPI value is printed.

**The proxy statement.** Everywhere the dataset appears — the library
listing, the provenance panel, the memo — it is labelled:

> ONS Construction Output Price Index — a public currentisation proxy; not
> BCIS TPI and not an elemental-cost dataset.

OPI measures the price of construction *output*; it is not a tender-price
index and carries no elemental breakdown. Using it to currentise elemental
rates is an approximation, and the report says so (§27.9 limitation 2). The
engine never reads the JSON file: an appraisal embeds the two observations
(base and current) it used, so the document is self-contained and its hash
does not depend on the library's state (design decision 9).

**Regenerating the JSON.** `scripts/ons_opi_to_json.py` reads the ONS
workbook a person has downloaded and writes the JSON with the workbook's
SHA-256 inside it:

```
python -m pip install openpyxl        # script-only; deliberately not a project dependency
python scripts/ons_opi_to_json.py path/to/bulletindataset9.xlsx --version 2026-Q3 \
    --publication-date YYYY-MM-DD --retrieved-at YYYY-MM-DD
```

`tests/test_index_import.py::test_committed_ons_json_invariants` pins the
committed file's provenance fields, series set, observation count, period
range and first/last values.

## 4. Importing and seeding

All routes are under `/api/v1` and require a bearer token. The import (POST)
routes require the `administrator` or `underwriter` role; reads are open to
any authenticated user.

### Index datasets

- **Seed the shipped ONS data** (idempotent; keyed by
  `(publisher, series_code, dataset_version)`; a second run inserts nothing):

  ```
  python -m app.benchmarks.seed            # reads data/index-datasets/*.json
  python -m app.benchmarks.seed --dir path # another directory of release files
  ```

- **Import a series by JSON** — `POST /index-datasets` with
  `{publisher, series_code, series_name, dataset_version, source_url, licence,
  publication_date, retrieved_at, base_period, observations: [{period, value}]}`.
- **Import a series by CSV** — `POST /index-datasets/import-csv`, multipart:
  `file` is a `period,value` CSV (leading `#` lines are comments, e.g.
  `# source: <url>; licence: OGL v3`) and the header fields are form fields.
  The file's SHA-256 is recorded. `fixtures/benchmarks/ons-opi-2026q2-sample.csv`
  is a worked example (twelve real `all_new_work` rows).
- Validation: `period` must be `YYYY-MM`; periods strictly increasing and
  unique; every value a finite number greater than zero; the CSV header
  exactly `period,value`. Each failure is a 422 with one of five fixed
  messages (pinned by `tests/test_index_import.py`).
- A version that already exists is a 409 naming the existing row.

### Benchmark sets

- **Template** — `GET /benchmark-sets/template.csv`: the column header row
  and one comment row (id `#`) per catalogue element (39 rows), each
  pre-filled with the element's code, label, default basis and unit.
- **Import by JSON** — `POST /benchmark-sets` with an `ElementalBenchmarkSet`
  *without* `id`, `created_at` or `content_hash` (the server assigns them and
  discards anything supplied).
- **Import by CSV** — `POST /benchmark-sets/import-csv`, multipart: `file`
  in the template's columns plus a `header` form field holding the set's
  header fields as a JSON object. The file's SHA-256 is recorded as
  `source_file_sha256`. A CSV and a JSON import of the same content produce
  the same `content_hash`.
- **Read** — `GET /benchmark-sets` (headers), `GET /benchmark-sets/{id}`
  (with rates). Adding `?currentisation_date=YYYY-MM-DD&current_index_value=N`
  returns, under `currentised`, the rates currentised by the engine's own
  arithmetic (factor = current ÷ base index, location multiplier = factor ÷
  100). That block is computed on every read and **never stored**.

## 5. The test fixture

`fixtures/benchmarks/test-elemental-benchmark-set.json` is the import form
of the `elemental_benchmark.set` inside
`fixtures/financial-model/ab-elemental-benchmark.json`. It is **fictional**:
seven rates under `provider_type: user_qs`, named
`AB — elemental benchmark, TEST FIXTURE — NOT MARKET DATA`, with a made-up
`TEST index`. Its content hash,
`087c57e76aeb98e5814faf68991481d579a28ad4c650c186f4d38acd9e3d6baf`, is
pinned by `tests/test_benchmark_api.py` so the server's hash and both
engines' hash of the same set agree. It is never seeded and must not be used
for a real appraisal.

## 6. Immutability rules

- A benchmark set is immutable once imported. There is no `PUT` and no
  `DELETE`. Changing one rate is a new set with a new `content_hash`.
- `content_hash` is `canonical_hash` over the normalised set (`id`,
  `created_at`, `content_hash`, `imported_by` removed; rates sorted by
  `element_code, id`). The same content re-imported under the same
  `(provider_type, dataset_version)` is a 409 naming the existing id.
- An index-dataset version is immutable once imported: unique on
  `(publisher, series_code, dataset_version)`, observations unique on
  `(dataset, period)`, no `PUT`, no `DELETE`. A new release is a new
  `dataset_version`.
- Repositories flush, never commit; the route owns the transaction, so a
  failed import leaves nothing behind.
- An appraisal that used a set or an index embeds what it used (the set's
  rates and hash; the two observations), so a later import cannot change a
  stored appraisal's result.

## 7. Stated limitations (§27.9)

1. **No elemental rates ship.** The library is empty until a person imports
   a licensed export, a set they may redistribute, or their own cost plan.
2. **ONS OPI is an output-price proxy**, not a tender-price index and not
   elemental; currentising elemental rates with it is an approximation the
   report labels as such.
3. **No automatic download.** Refreshing an index means running the seed or
   the import with a file a person retrieved.
