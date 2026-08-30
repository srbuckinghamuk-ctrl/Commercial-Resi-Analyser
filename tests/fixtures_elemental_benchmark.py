"""R17 spec Sec 27. Twin of frontend/src/lib/model/__fixtures__/elemental-benchmark-docs.ts.

`doc_ab()` loads fixture AB via migrate_inputs_to_v17 -- never a hand-authored
default. `doc_ab_without_benchmark()` is the advisory-proof twin (the block
nulled, the applied kitchens package kept). `doc_ab_with(mutate)` applies one
change to a deep copy of the raw benchmark block before parsing.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Callable

from app.financial_model.migrate import migrate_inputs_to_v17
from app.financial_model.types import CalculatorInputsV17

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def raw_ab() -> dict[str, Any]:
    return json.loads((FIXTURE_DIR / "ab-elemental-benchmark.json").read_text(encoding="utf-8"))["inputs"]


def doc_ab() -> CalculatorInputsV17:
    return migrate_inputs_to_v17(raw_ab())


def doc_ab_without_benchmark() -> CalculatorInputsV17:
    raw = raw_ab()
    raw["elemental_benchmark"] = None
    return migrate_inputs_to_v17(raw)


def doc_ab_with(mutate: Callable[[dict[str, Any]], None]) -> CalculatorInputsV17:
    raw = raw_ab()
    block = copy.deepcopy(raw["elemental_benchmark"])
    mutate(block)
    raw["elemental_benchmark"] = block
    return migrate_inputs_to_v17(raw)
