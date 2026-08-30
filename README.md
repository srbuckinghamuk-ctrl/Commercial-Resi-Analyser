# Commercial-Resi-Analyser

UK commercial-to-residential property conversion analyser for Permitted Development
Rights (PDR) opportunities.

The app helps appraise commercial properties (offices, retail, restaurants, light
industrial, agricultural buildings, etc.) for conversion to residential use under
the GPDO 2015 (as amended) permitted development rights — Classes MA, M, N, Q and G.
It provides:

- **Listing capture** — scrape a commercial listing URL (Rightmove Commercial,
  Allsop, Savills Auctions, Estates Gazette) into a project.
- **Eligibility screening** — a rules engine that maps the property's use class to
  a PDR route and evaluates statutory gates (floor-area caps, Article 4, listed
  building, use periods) and prior-approval matters (transport, contamination,
  noise, flooding), producing a green/amber/red verdict. Auto-checks use
  postcodes.io, the EA flood-warnings feed, the non-domestic EPC register and a
  bundled Article 4 dataset.
- **Financial appraisal** — GDV/cost/profit/RLV appraisals per project.
- **Pipeline tracking** — stage transitions from opportunity through prior
  approval to completion, including prior-approval submission/decision dates.

## Quick Start

```bash
docker compose up
```

API: http://localhost:8000 (OpenAPI docs at /docs)
Frontend: http://localhost:5173 (dev mode)

Or run the API locally against your own Postgres:

```bash
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.api.app:app --reload
```

## Environment variables

Settings are read from the environment or a `.env` file (see `config/settings.py`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:password@localhost:5432/commercial_resi` | Async SQLAlchemy database URL |
| `EPC_API_KEY` | *(empty — EPC lookups skipped)* | Auth for the EPC register (see below) |
| `API_SECRET_KEY` | `change-me-in-production` | Signs bearer tokens; rotating it invalidates every token. Startup refuses the default when `ENVIRONMENT=production` |
| `API_PREFIX` | `/api/v1` | API route prefix |
| `ENVIRONMENT` | `development` | `development` or `production`; only the secret-key startup check depends on it |
| `AUTH_TOKEN_TTL_SECONDS` | `43200` | Bearer token lifetime (12 h). Tokens are stateless: logout is client-side discard |
| `ADMIN_BOOTSTRAP_EMAIL` | *(empty)* | With `ADMIN_BOOTSTRAP_PASSWORD`, creates the first administrator at startup when the users table is empty |
| `ADMIN_BOOTSTRAP_PASSWORD` | *(empty)* | See above; `python -m app.auth.cli create-user` does the same from a shell |
| `CORS_ORIGINS` | localhost dev origins | Allowed CORS origins |
| `LOG_LEVEL` | `INFO` | Log level |

### EPC_API_KEY

Register at https://epc.opendatacommunities.org/ to get an API token. The
non-domestic EPC API uses HTTP Basic auth; the app sends the value of
`EPC_API_KEY` **as-is** in the `Authorization: Basic <EPC_API_KEY>` header, so it
must be the base64 encoding of `email:token`, not the raw token:

```bash
EPC_API_KEY=$(echo -n "you@example.com:your-token" | base64)
```

## Tests

```bash
python -m pytest tests/ -q
```

## Authentication and roles

Every write to lender cases, users, benchmark sets and index datasets requires a
bearer token; reads on projects, appraisals and lender cases stay open (the product
is single-tenant). Authentication is standard-library only: passwords are hashed with
PBKDF2-HMAC-SHA256 (390,000 iterations, 16-byte salt) and the token is an
HMAC-SHA256-signed, expiring, opaque token over `API_SECRET_KEY` — rotating the key
invalidates every token, and the server refuses to start with the default key when
`ENVIRONMENT=production`.

Roles: `developer`, `broker`, `underwriter`, `credit_approver`, `administrator`.
Developers, brokers and administrators create and submit lender cases; underwriters
and credit approvers review; only a credit approver decides. **Maker-checker is a
user-id rule, not a role rule**: the user who created or submitted a case can never
decide it, whatever their role. Every transition carries `expected_version`,
`expected_case_hash` and an `idempotency_key`; a stale version, a mismatched hash, a
tampered locked snapshot or a replayed key with a different target is a 409.

Bootstrap the first administrator with `ADMIN_BOOTSTRAP_EMAIL` /
`ADMIN_BOOTSTRAP_PASSWORD` (applied at startup when the users table is empty) or from
a shell:

```bash
python -m app.auth.cli create-user
```

## Elemental cost benchmark and data sources

The appraisal can carry an elemental cost benchmark (calculation specification §27)
against which the QS or developer cost plan is compared. Sources and licences are
documented in [`docs/data-sources-and-licensing.md`](docs/data-sources-and-licensing.md).
Seven statements, each of which the product also makes on screen and in the memo:

1. **BCIS data is not bundled.** BCIS elemental analyses, average prices, location
   factors and indices are licensed subscription products; none ship here and the
   benchmark library is empty of elemental rates on install.
2. **An authorised manual BCIS import is supported.** A user who holds a BCIS licence
   may import their own export as a `bcis_licensed` set (JSON or the CSV template at
   `GET /api/v1/benchmark-sets/template.csv`); the application records the licence
   note and states that it has not verified the licence or the underlying data.
3. **Public benchmarks are labelled by their real publisher.** A `public_benchmark`
   set must name its publisher, source title, URL, licence, publication date and
   retrieval date, and is printed under those names — never as BCIS.
4. **The ONS Construction Output Price Index is a currentisation proxy, not a BCIS
   elemental dataset.** The shipped series (`data/index-datasets/`, Open Government
   Licence v3.0, loaded by `python -m app.benchmarks.seed`) moves a rate from its base
   date to the currentisation date by an index ratio; it is not a tender-price index
   and is labelled as a proxy wherever it appears.
5. **Benchmarks are not a substitute for a quantity surveyor.** Every report carries,
   verbatim: "Benchmark rates are an initial reasonableness check, not a substitute
   for project-specific QS advice, surveys, design development, contractor pricing or
   lender monitoring."
6. **Currentisation is not forward inflation.** Currentisation brings a benchmark rate
   *to* the cost plan's base date; the cost plan's own inflation line (§24.3) is the
   only forward step, and applying benchmark rows to the plan is refused when the two
   dates differ, so nothing is inflated twice.
7. **The unit toggle changes no canonical value.** The document stores m² and pence
   per m²; ft² is display only (see below).

## Area units

The canonical basis is square metres and pence per square metre. A global m²/ft²
toggle (a browser preference, not an input, so it cannot move `input_hash` or stale a
lender case) reprints every area and rate using the exact constant
`1 m² = 10.7639104167097 ft²`, shared by both engines. A figure typed in ft² is
converted once on entry (areas stored to 4 dp of m², rates unrounded); money is rounded
once, at the amount. The lender-valuation `global_per_sqft` basis keeps its stored
`10.7639` convention deliberately (§27.9 limitation 6).

## API

All routes sit under `API_PREFIX` (default `/api/v1`); the OpenAPI document is served
at `/docs`. Route families:

| Family | Routes | Notes |
| --- | --- | --- |
| Projects and eligibility | `/projects`, `/projects/{id}/eligibility`, listing capture | open reads |
| Appraisals | `GET/PUT /appraisals/{project_id}`, `POST /appraisals/{project_id}/resave`, `GET /appraisals/{project_id}/versions`, `GET /appraisals/stale` | every save and every governed resave writes the pre-save state to `appraisal_versions`; `stale` lists rows behind the server's `inputs_version` or `calc_version` |
| Lender cases | `POST /lender-cases`, `POST /lender-cases/{id}/transition`, `GET …` | writes require a token; the role matrix is server-enforced; the body carries `expected_version`, `expected_case_hash`, `idempotency_key`; `created_by` / `actor` in the body are rejected with 422 |
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | tokens are stateless; logout is client-side discard |
| Users | `GET/POST /users`, `PATCH /users/{id}` | administrator only; the last active administrator cannot be demoted |
| Benchmark sets | `GET /benchmark-sets`, `GET /benchmark-sets/{id}`, `POST /benchmark-sets`, `POST /benchmark-sets/import-csv`, `GET /benchmark-sets/template.csv` | immutable once imported; identical content is a 409 naming the existing id; imports need `administrator` or `underwriter` |
| Index datasets | `GET /index-datasets`, `GET /index-datasets/{id}`, `POST /index-datasets`, `POST /index-datasets/import-csv` | versioned series; periods strictly increasing, values finite and positive; no PUT or DELETE; nothing is fetched from the internet |

## Documentation

- [`docs/financial-model/calculation-specification.md`](docs/financial-model/calculation-specification.md) — the authoritative model (§27: benchmark, area units, currentisation).
- [`docs/financial-model/model-governance.md`](docs/financial-model/model-governance.md) — versioning, hashes, the FINAL gate, single-accessor rules.
- [`docs/financial-model/test-cases.md`](docs/financial-model/test-cases.md) — the golden fixture register and hand derivations.
- [`docs/financial-model/migration-notes.md`](docs/financial-model/migration-notes.md) — every input-schema migration.
- [`docs/data-sources-and-licensing.md`](docs/data-sources-and-licensing.md) — benchmark and index data sources, licences and what is not bundled.
- [`docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`](docs/superpowers/plans/2026-08-17-second-audit-release-plan.md) — the release plan (R7 → R17).
- [`frontend/README.md`](frontend/README.md) — frontend scripts, gates and conventions.

## Legal note

- **Scraping**: fetching listing pages is subject to each source site's terms of
  service and robots policy. You are responsible for ensuring your use complies
  with them.
- **Eligibility output is screening guidance, not planning advice.** The rules
  engine encodes a screening-level baseline of the GPDO permitted development
  rights (ruleset version stamped on each assessment). Legislation and local
  designations change; every result must be verified against the current GPDO and
  with the local planning authority by a qualified planning professional before
  any decision is made.
