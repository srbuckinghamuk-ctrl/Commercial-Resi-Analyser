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
| `API_SECRET_KEY` | `change-me-in-production` | Reserved for future auth |
| `API_PREFIX` | `/api/v1` | API route prefix |
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
