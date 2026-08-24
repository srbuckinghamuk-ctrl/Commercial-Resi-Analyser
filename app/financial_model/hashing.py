"""Deterministic content hashes for inputs/outputs, used to detect stale
appraisals (calc_version drift, edited inputs since last run)."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from typing import Any


def canonical_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def input_hash(inputs: Any) -> str:
    return canonical_hash(inputs.model_dump(mode="json"))


def outputs_hash(metrics: Any) -> str:
    return canonical_hash(asdict(metrics))


def audit_hash(
    *,
    project_id: str,
    calc_version: str,
    inputs_version: int,
    status: str,
    input_hash_value: str,
    outputs_hash_value: str,
) -> str:
    """Spec Sec 13.2 -- the single value that binds a stored result to the exact
    inputs and model version that produced it, and to the governance status it
    was produced under.

    It is a hash *of the other hashes*, not of the payloads: `input_hash` and
    `outputs_hash` already commit to the full documents, so re-deriving from
    them keeps this value cheap to recompute and makes the binding explicit --
    a reviewer holding a printed report can recompute it from the six printed
    fields alone and detect that any one of them was altered after the fact.

    The record identity in the hash is `project_id` rather than the appraisal's
    own id: migration 003 made the appraisal unique per project, so the project
    is the stable identity of the record, and it is known before the row exists
    -- which lets the value be computed once, in the same place as the other two
    hashes, instead of after the insert has assigned a key.
    """
    parts = [
        project_id,
        calc_version,
        str(inputs_version),
        status,
        input_hash_value,
        outputs_hash_value,
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def _utc_iso(dt) -> str:
    """Canonical UTC ISO-8601 for hashing (spec Sec 21.4): naive datetimes are
    treated as UTC (sqlite returns rows naive that were written aware), always
    rendered with microseconds and a literal 'Z', so a write-time hash and a
    re-read recomputation agree byte for byte."""
    from datetime import timezone

    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def case_hash(
    *,
    case_id: str,
    project_id: str,
    status: str,
    submitted_by: str | None,
    reviewer: str | None,
    decided_by: str | None,
    decided_at,
    locked_audit_hash: str,
) -> str:
    """Spec Sec 21.4 -- the lender case's own hash, chained onto the audit
    hash rather than extending it: audit_hash's Sec 13.2 formula "gains no
    new parts", and a case transition happens without an appraisal re-save,
    so folding case state into audit_hash would silently invalidate stored
    hashes. Every component is printed on the provenance panel; absent parts
    are the empty string; decided_at is canonical UTC ISO-8601 (_utc_iso).
    `locked_audit_hash` is what binds the case to the exact document the
    lender reviewed."""
    parts = [
        case_id,
        project_id,
        status,
        submitted_by or "",
        reviewer or "",
        decided_by or "",
        _utc_iso(decided_at),
        locked_audit_hash,
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()
