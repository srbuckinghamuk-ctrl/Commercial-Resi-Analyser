"""Reconcile the audited York (Stonegate) appraisal through the R17 governed
resave (spec Sec 11; migration notes Sec 20.4).

    python scripts/york_reconcile.py --base-url http://localhost:8000 \
        --email you@example.com --password '...'
    python scripts/york_reconcile.py --base-url http://localhost:8000 --dry-run \
        [--email ... --password ...]

What it does, in order, printing every before/after:

1. Logs in (the resave route is authenticated; any role).
2. Lists projects. The York project is the one whose address contains
   'Stonegate'. Every project whose description starts with a known leading
   label glued to a capital letter ('DescriptionRetail...') has the label
   removed -- the SAME narrow rule the client's `repairGluedDescription`
   applies and nothing wider -- and is PUT back through `/projects/{id}`.
3. POSTs `/appraisals/{york}/resave`: the stored v3 / 2.1.0 state goes to
   `appraisal_versions`, the row is recalculated from its stored snapshot.
4. If the resaved document has no `due_diligence.source_records`, writes
   exactly two: `listing_structured` (existing use = the project row's
   `use_class`) and `listing_narrative` (what the listing text actually
   says: retail below, upper parts sold off), with NO resolution. Before
   that PUT, the recalculated metrics are asserted equal to the resave's,
   metric for metric (`due_diligence` and `flags`, which the new records
   are meant to change, are the two result blocks excluded and printed).
5. Prints the blocker list: why the case is DRAFT and what would move it.

`--dry-run` performs steps 1-2's reads and prints what steps 2-4 would
write, without writing anything. Design decision 12: the project's
structured use is never rewritten here -- the conflict is recorded in the
document for a person to resolve with evidence.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import math
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

# Runnable from a checkout without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import FinancialAppraisalCreate  # noqa: E402

API = "/api/v1"
YORK_ADDRESS_FRAGMENT = "Stonegate"
CAPTURED_BY = "york_reconcile.py"

# Mirrors GLUED_LEADING_LABELS in frontend/src/lib/format.ts, in the same order.
GLUED_LEADING_LABELS = (
    "Full Property Description",
    "Property Description",
    "Full Description",
    "Key Features",
    "Accommodation",
    "Description",
    "Overview",
    "Summary",
)

NARRATIVE_EXISTING_USE = (
    "retail (ground and basement); upper parts sold off on long lease "
    "(999 years from 01.01.2007) and operated as Airbnb accommodation"
)

# The two AppraisalResultV2 blocks the evidence edit is MEANT to change.
METRIC_BLOCKS_MOVED_BY_EVIDENCE = ("due_diligence", "flags")


def repair_glued_description(text: str | None) -> str | None:
    """Port of `repairGluedDescription` (frontend/src/lib/format.ts): a known
    leading label glued to a following capital letter, with no separator of
    any kind, is removed. Anything else is returned unchanged."""
    if not text:
        return text
    for label in GLUED_LEADING_LABELS:
        if len(text) <= len(label) or not text.startswith(label):
            continue
        if "A" <= text[len(label)] <= "Z":
            return text[len(label):]
    return text


def is_york(project: dict[str, Any]) -> bool:
    return YORK_ADDRESS_FRAGMENT.lower() in (project.get("address_raw") or "").lower()


def build_source_records(project: dict[str, Any], description: str | None, now: str) -> list[dict]:
    """The two evidence records spec Sec 11 names, with no resolution."""
    return [
        {
            "id": str(uuid.uuid4()),
            "kind": "listing_structured",
            "captured_at": now,
            "reference": "projects.use_class",
            "captured_by": CAPTURED_BY,
            "narrative_excerpt": None,
            "claims": {"existing_use": project.get("use_class")},
        },
        {
            "id": str(uuid.uuid4()),
            "kind": "listing_narrative",
            "captured_at": now,
            "reference": "listing description",
            "captured_by": CAPTURED_BY,
            "narrative_excerpt": description,
            "claims": {
                "existing_use": NARRATIVE_EXISTING_USE,
                "upper_parts_included": False,
            },
        },
    ]


def _jsonable(value: Any) -> Any:
    """A metrics block as the API prints it: JSON, with a non-finite float
    (an open-ended tax band's `inf` threshold) printed as null -- the API's
    own serialisation of the stored outputs, so both sides of the identity
    check are normalised the same way."""
    def norm(v: Any) -> Any:
        if isinstance(v, dict):
            return {k: norm(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [norm(x) for x in v]
        if isinstance(v, float) and (math.isinf(v) or math.isnan(v)):
            return None
        return v
    return norm(json.loads(json.dumps(value, default=str)))


def recalculated_metrics(project_id: str, name: str, snapshot: dict) -> dict:
    """The server's own calculation path on a document, as the JSON the
    server would store -- so a comparison with a stored `outputs.metrics`
    compares like with like."""
    from app.api.app import calculate_authoritative
    computed = calculate_authoritative(
        FinancialAppraisalCreate(project_id=project_id, name=name, inputs_snapshot=snapshot)
    )
    return _jsonable(computed["outputs"]["metrics"])


def metric_differences(before: dict, after: dict) -> list[str]:
    """Names of every metric whose value differs, ignoring the two blocks an
    evidence edit is meant to move."""
    keys = set(before) | set(after)
    return sorted(
        k for k in keys
        if k not in METRIC_BLOCKS_MOVED_BY_EVIDENCE and before.get(k) != after.get(k)
    )


def blocker_report(appraisal: dict) -> list[str]:
    """Every reason the case is where it is, from the stored row alone."""
    snap = appraisal.get("inputs_snapshot") or {}
    outputs = appraisal.get("outputs") or {}
    metrics = outputs.get("metrics") or {}
    rec = outputs.get("reconciliation") or {}
    validation = appraisal.get("validation") or {}
    lines: list[str] = []

    issues = validation.get("issues") or []
    for sev in ("error", "warning"):
        for i in (x for x in issues if x.get("severity") == sev):
            lines.append(f"validation {sev}: {i.get('field')}: {i.get('message')}")
    if not issues:
        lines.append("validation: no issues recorded")

    flags = metrics.get("flags") or []
    for f in (x for x in flags if x.get("severity") in ("red", "amber")):
        lines.append(f"flag {f.get('severity')}: {f.get('code')}: {f.get('message')}")

    fin = snap.get("finance") or {}
    lines.append(
        f"jurisdiction: {snap.get('jurisdiction')} "
        f"({snap.get('jurisdiction_evidence_status')}, source {snap.get('jurisdiction_source')})"
    )
    vat = snap.get("vat") or {}
    purchase = vat.get("purchase") or {}
    treatments = vat.get("treatments") or []
    unconfirmed_treatments = sum(1 for t in treatments if t.get("evidence_status") != "confirmed")
    lines.append(
        f"VAT: purchase {purchase.get('evidence_status')}; "
        f"{unconfirmed_treatments} of {len(treatments)} treatments unconfirmed"
    )
    equity = snap.get("equity_sources") or []
    lines.append(
        "equity: " + (", ".join(
            f"{e.get('kind') or e.get('name') or e.get('id')}={e.get('evidence_status')}"
            for e in equity
        ) or "no sources")
    )
    lines.append(
        f"facility: requires_confirmation={fin.get('requires_confirmation')}"
        f" evidence_status={fin.get('evidence_status')}"
    )
    for block in ("lender_valuation", "investment_case", "unit_sales"):
        lines.append(f"{block}: {'present' if snap.get(block) is not None else 'absent'}")
    lines.append(
        f"reconciliation: report_safe={rec.get('report_safe')} "
        f"senior_repaid={rec.get('senior_repaid')} sources_equal_uses={rec.get('sources_equal_uses')}"
    )
    dd = metrics.get("due_diligence") or {}
    totals = dd.get("totals") or {}
    lines.append(
        f"due diligence: unknown={totals.get('unknown')} "
        f"entered_unknown={totals.get('entered_unknown_count')} "
        f"unresolved_source_conflicts={dd.get('unresolved_source_conflicts')}"
    )
    dd_in = snap.get("due_diligence") or {}
    lines.append(
        f"source records: {len(dd_in.get('source_records') or [])}, "
        f"resolutions: {len(dd_in.get('source_resolutions') or [])}"
    )
    lines.append(
        f"stored: status={appraisal.get('status')} inputs_version={appraisal.get('inputs_version')} "
        f"calc_version={appraisal.get('calc_version')}"
    )
    lines.append(
        f"hashes: input={appraisal.get('input_hash')} outputs={appraisal.get('outputs_hash')} "
        f"audit={appraisal.get('audit_hash')}"
    )
    return lines


def _raise_for(resp: httpx.Response, what: str) -> dict:
    if resp.status_code >= 400:
        raise SystemExit(f"{what}: HTTP {resp.status_code}: {resp.text}")
    return resp.json()


async def login(client: httpx.AsyncClient, email: str, password: str) -> dict:
    token = _raise_for(
        await client.post(f"{API}/auth/login", json={"email": email, "password": password}),
        "login",
    )["token"]
    return {"Authorization": f"Bearer {token}"}


async def reconcile(
    client: httpx.AsyncClient, *, email: str | None, password: str | None,
    dry_run: bool = False, out: Callable[[str], None] = print,
    now: Callable[[], str] | None = None,
) -> dict[str, Any]:
    """The whole run against `client`; returns a summary the test reads."""
    now = now or (lambda: datetime.now(timezone.utc).isoformat())
    headers: dict[str, str] = {}
    if email and password:
        headers = await login(client, email, password)
    elif not dry_run:
        raise SystemExit("--email and --password are required unless --dry-run")

    projects = _raise_for(await client.get(f"{API}/projects", params={"limit": 1000}), "list projects")
    summary: dict[str, Any] = {"repaired": [], "york_project_id": None, "records_written": 0}

    # 2. Descriptions: the narrow rule only, every glued row printed.
    for project in projects:
        before = project.get("description")
        after = repair_glued_description(before)
        if after == before:
            continue
        out(f"[description] {project['id']} {project.get('address_raw')}")
        out(f"  before: {before!r}")
        out(f"  after:  {after!r}")
        summary["repaired"].append(project["id"])
        if dry_run:
            out("  (dry run: not written)")
            continue
        _raise_for(
            await client.put(f"{API}/projects/{project['id']}", json={"description": after}),
            "repair description",
        )
        project["description"] = after

    york = [p for p in projects if is_york(p)]
    if len(york) != 1:
        raise SystemExit(f"expected exactly one project with '{YORK_ADDRESS_FRAGMENT}' in its address, found {len(york)}")
    york_project = york[0]
    summary["york_project_id"] = york_project["id"]
    out(f"[york] project {york_project['id']} {york_project.get('address_raw')} use_class={york_project.get('use_class')}")

    stored = _raise_for(await client.get(f"{API}/appraisals/{york_project['id']}"), "read appraisal")
    out(
        f"[york] stored: status={stored.get('status')} inputs_version={stored.get('inputs_version')} "
        f"calc_version={stored.get('calc_version')} audit_hash={stored.get('audit_hash')}"
    )

    # 3. The governed resave.
    if dry_run:
        out("[york] dry run: would POST /appraisals/{id}/resave and write two source records")
        summary["blockers"] = blocker_report(stored)
        for line in summary["blockers"]:
            out("  " + line)
        return summary

    resaved = _raise_for(
        await client.post(f"{API}/appraisals/{york_project['id']}/resave", headers=headers),
        "resave",
    )
    summary["previous_version_id"] = resaved.get("previous_version_id")
    out(
        f"[york] resaved: status={resaved.get('status')} inputs_version={resaved.get('inputs_version')} "
        f"calc_version={resaved.get('calc_version')} previous_version_id={resaved.get('previous_version_id')}"
    )

    # 4. The two evidence records, with no resolution.
    appraisal = _raise_for(await client.get(f"{API}/appraisals/{york_project['id']}"), "read appraisal")
    snapshot = copy.deepcopy(appraisal["inputs_snapshot"])
    dd = snapshot.setdefault("due_diligence", {})
    if dd.get("source_records"):
        out(f"[york] {len(dd['source_records'])} source records already present; none written")
    else:
        records = build_source_records(york_project, york_project.get("description"), now())
        dd["source_records"] = records
        dd.setdefault("source_resolutions", [])
        before_metrics = _jsonable((appraisal.get("outputs") or {})["metrics"])
        after_metrics = recalculated_metrics(york_project["id"], appraisal["name"], snapshot)
        moved = metric_differences(before_metrics, after_metrics)
        if moved:
            raise SystemExit(
                "ABORT: adding evidence records moved these metrics, which must not happen: "
                + ", ".join(moved)
            )
        out(
            "[york] metric identity holds across the evidence edit "
            f"(only {', '.join(METRIC_BLOCKS_MOVED_BY_EVIDENCE)} may move)"
        )
        appraisal = _raise_for(
            await client.put(
                f"{API}/appraisals/{york_project['id']}",
                json={"inputs_snapshot": snapshot}, headers=headers,
            ),
            "write source records",
        )
        summary["records_written"] = len(records)
        out(f"[york] wrote {len(records)} source records (no resolution)")

    # 5. The blocker list.
    summary["appraisal"] = appraisal
    summary["blockers"] = blocker_report(appraisal)
    out("[york] blockers:")
    for line in summary["blockers"]:
        out("  " + line)
    return summary


def make_client(base_url: str) -> httpx.AsyncClient:
    """Replaced under test with an ASGI-transport client."""
    return httpx.AsyncClient(base_url=base_url, timeout=60.0)


async def _amain(args: argparse.Namespace) -> None:
    async with make_client(args.base_url) as client:
        await reconcile(client, email=args.email, password=args.password, dry_run=args.dry_run)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--dry-run", action="store_true")
    asyncio.run(_amain(parser.parse_args(argv)))


if __name__ == "__main__":
    main()
