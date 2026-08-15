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
