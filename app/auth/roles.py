"""The five roles (spec Sec 10.1). The transition matrix that consumes them
lives in app/financial_model/provenance.py (ROLE_TRANSITIONS), not here."""

ROLES: tuple[str, ...] = (
    "developer",
    "broker",
    "underwriter",
    "credit_approver",
    "administrator",
)

ADMINISTRATOR = "administrator"
