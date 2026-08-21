"""R11 spec §17. Python mirror of frontend/src/lib/model/vat.test.ts.

Same five resolver cases, same four chargeability cases, same two
default-shape cases -- against resolve_vat_treatment, is_purchase_vat_chargeable,
DEFAULT_VAT, default_vat_treatments and VAT_CHARGE_CATEGORIES imported from
app.financial_model.vat. VatInputs is a pydantic model, so variants are built
with model_copy(update=...) rather than object spread."""
from app.financial_model.types import PurchaseVatInputs, VatOverride
from app.financial_model.vat import (
    DEFAULT_VAT,
    VAT_CHARGE_CATEGORIES,
    default_vat_treatments,
    is_purchase_vat_chargeable,
    resolve_vat_treatment,
)


def _registered_vat():
    treatments = default_vat_treatments()
    updated = []
    for t in treatments:
        if t.category == "construction":
            updated.append(t.model_copy(update={
                "rate_pct": 5, "recoverable_pct": 100, "recovery_basis": "zero_rated_sale",
            }))
        else:
            updated.append(t)
    return DEFAULT_VAT.model_copy(update={"registered": True, "treatments": updated})


def test_falls_back_to_the_category_row_when_the_charge_has_no_override():
    vat = _registered_vat()
    r = resolve_vat_treatment(vat, "construction", None)
    assert r.rate_pct == 5
    assert r.recoverable_pct == 100
    assert r.source == "category"


def test_prefers_a_line_override_over_the_category_row():
    vat = _registered_vat()
    override = VatOverride(rate_pct=20, recoverable_pct=60, recovery_basis="partial_exemption")
    r = resolve_vat_treatment(vat, "construction", override)
    assert r.rate_pct == 20
    assert r.recoverable_pct == 60
    assert r.recovery_basis == "partial_exemption"
    assert r.source == "override"


def test_carries_the_category_row_evidence_status_onto_an_overridden_charge():
    # An override states rate and recovery. It does not state evidence -- the
    # adviser confirmation still belongs to the category. If this ever returns
    # 'confirmed' for an unconfirmed category, the Sec 17.10 draft gate goes blind.
    vat = _registered_vat()
    override = VatOverride(rate_pct=20, recoverable_pct=60, recovery_basis="partial_exemption")
    r = resolve_vat_treatment(vat, "construction", override)
    assert r.evidence_status == "unconfirmed"


def test_yields_a_zero_rate_resolution_for_every_category_when_not_registered():
    off = _registered_vat().model_copy(update={"registered": False})
    for category in VAT_CHARGE_CATEGORIES:
        assert resolve_vat_treatment(off, category, None).rate_pct == 0


def test_ignores_an_override_when_not_registered():
    off = _registered_vat().model_copy(update={"registered": False})
    override = VatOverride(rate_pct=20, recoverable_pct=100, recovery_basis="zero_rated_sale")
    r = resolve_vat_treatment(off, "construction", override)
    assert r.rate_pct == 0


def _purchase(opted: bool, togc: str) -> PurchaseVatInputs:
    return PurchaseVatInputs(
        vendor_opted_to_tax=opted, togc_treatment=togc,  # type: ignore[arg-type]
        evidence_status="unconfirmed", notes="",
    )


def test_charges_where_the_vendor_has_opted_and_togc_does_not_apply():
    assert is_purchase_vat_chargeable(_purchase(True, "does_not_apply")) is True


def test_charges_where_the_vendor_has_opted_and_togc_is_unconfirmed_the_prudent_case():
    assert is_purchase_vat_chargeable(_purchase(True, "unconfirmed")) is True


def test_does_not_charge_where_togc_applies_whatever_the_option_to_tax():
    assert is_purchase_vat_chargeable(_purchase(True, "applies")) is False
    assert is_purchase_vat_chargeable(_purchase(False, "applies")) is False


def test_does_not_charge_where_the_vendor_has_not_opted_to_tax():
    assert is_purchase_vat_chargeable(_purchase(False, "does_not_apply")) is False
    assert is_purchase_vat_chargeable(_purchase(False, "unconfirmed")) is False


def test_default_vat_holds_exactly_the_six_categories_in_declared_order():
    assert [t.category for t in DEFAULT_VAT.treatments] == list(VAT_CHARGE_CATEGORIES)


def test_ships_inert_not_registered_every_rate_and_recovery_zero_every_status_unconfirmed():
    assert DEFAULT_VAT.registered is False
    for t in DEFAULT_VAT.treatments:
        assert t.rate_pct == 0
        assert t.recoverable_pct == 0
        assert t.recovery_basis == "unconfirmed"
        assert t.evidence_status == "unconfirmed"
    assert DEFAULT_VAT.purchase.vendor_opted_to_tax is False
    assert DEFAULT_VAT.purchase.togc_treatment == "unconfirmed"
