import type {
  EquitySource, FacilityTerms, LedgerMonth, ModelFlag, MonthlyModel, Schedule,
} from './finance-types';

/** R11 ruling R20. "Does this deal have a facility?" — the single derivation of
 *  that fact, owned by the module that spends it. The ledger gates the
 *  arrangement and ancillary fees on it; `computeVat` (vat.ts) gates the
 *  `lender_ancillary` VAT base on it, because VAT must not be charged on a fee
 *  no one pays. Both call THIS function: derived twice, the two would drift the
 *  moment the gate gained a condition, and no total would move to say so.
 *  Pinned by vat.test.ts's "derives the facility gate ONCE" test, which asserts
 *  the VAT base and the ledger's ancillary fees in one assertion. */
export function hasFacility(finance: FacilityTerms): boolean {
  return finance.funding_source !== 'cash' && (finance.committed_net_facility_pence ?? 0) > 0;
}

/** Exported for breakeven.ts's caller (metrics.ts): the exit fee due on redeeming a given
 * balance is a pure function of the facility's basis terms — it never depends on the
 * hypothetical sale price used by the senior break-even solver (spec §5.11). */
export function exitFeeAmount(
  finance: FacilityTerms, grossFacility: number, peakDebt: number, redemptionBalance: number,
): number {
  const base =
    finance.exit_fee_basis === 'peak_debt' ? peakDebt :
    finance.exit_fee_basis === 'redemption_balance' ? redemptionBalance :
    grossFacility;
  return Math.round((base * finance.exit_fee_pct) / 100);
}

// Spec §4.2(c): draws are also capped by gross facility headroom after projected interest,
// so the closing balance this month cannot exceed the committed gross facility. Rolled-up
// interest compounds on the drawn balance, so the cap is solved backwards through the
// month's own interest accrual; serviced interest leaves the balance flat, so no such
// back-solve is needed.
function grossHeadroomCap(
  grossFacility: number, monthlyRate: number, rolledUp: boolean, opening: number, capFees: number,
): number {
  if (grossFacility <= 0) return Number.MAX_SAFE_INTEGER;
  return rolledUp
    ? Math.max(0, Math.floor(grossFacility / (1 + monthlyRate)) - opening - capFees)
    : Math.max(0, grossFacility - opening - capFees);
}

export function runLedger(
  schedule: Schedule, finance: FacilityTerms, equitySources: EquitySource[],
): MonthlyModel {
  const term = schedule.term_months;
  const isCash = finance.funding_source === 'cash';
  const netFacility = isCash ? 0 : (finance.committed_net_facility_pence ?? 0);
  const interestReserve = finance.interest_reserve_pence;
  const grossFacility = isCash ? 0
    : (finance.committed_gross_facility_pence ?? netFacility + (interestReserve ?? 0));
  const monthlyRate = finance.annual_interest_rate_pct / 100 / 12;
  const rolledUp = finance.interest_type === 'rolled_up';
  const fundAsRequired = finance.equity_draw_rule === 'fund_as_required';
  // Spec §2: committed equity available to the funding waterfall is cash sources
  // only — land/uplift/vendor/deferred equity is recorded but not yet modelled as
  // funding (Release 2; see validation.ts's non-cash-equity warning).
  const committedEquity = equitySources
    .filter((s) => s.classification === 'cash' && s.evidence_status !== 'rejected')
    .reduce((sum, s) => sum + s.amount_pence, 0);
  const facilityExists = hasFacility(finance);   // R20: derived once, above.

  // Arrangement fee: charged on commitment, capitalised in month 0 (spec §3.9).
  const arrangementBase =
    finance.arrangement_fee_basis === 'committed_gross_facility' ? grossFacility : netFacility;
  const arrangementFee = facilityExists
    ? Math.round((arrangementBase * finance.arrangement_fee_pct) / 100) : 0;
  const ancillaryFees = facilityExists
    ? finance.broker_fee_pence + finance.lender_legal_fee_pence
      + finance.valuation_fee_pence + finance.monitoring_surveyor_fee_pence
    : 0;

  const flags: ModelFlag[] = [];
  const months: LedgerMonth[] = [];
  const equityCashflows: number[] = [];

  let opening = 0;
  let cumNetUsed = 0;
  let equityUsed = 0;
  let cumCapitalisedInterest = 0;
  let peakDebt = 0;
  let peakDebtMonth: number | null = null;
  let dayOneAdvance = 0;
  let totalInterest = 0;
  let totalExitFee = 0;
  let totalDraws = 0;
  let totalCapFees = 0;
  let totalEquity = 0;
  let totalAdditionalEquity = 0;
  // Spec §4.5/§7: additional equity injected specifically by the refinance event's
  // shortfall or negative-net-proceeds branches — a subset of totalAdditionalEquity that
  // reconcile() (validation.ts) must exclude from sources, because it funds a facility
  // redemption (financing-side), not a project cost (see the field's own doc comment on
  // MonthlyModel.totals in finance-types.ts).
  let totalRefinanceShortfallEquity = 0;
  let totalGap = 0;
  let totalDistributions = 0;
  let totalRepayments = 0;
  // R11 spec §17.6: the gross VAT cycle, disclosed on totals. Neither is a finance
  // cost and neither enters §7's identity (see reconcile() in validation.ts).
  let totalVat = 0;
  let totalVatReclaim = 0;
  let reserveExhaustedFlagged = false;
  let facilityExceededFlagged = false;
  // Spec §5.11: the disposal month's senior balance immediately before sale receipts are
  // applied — captured before the repayment block below mutates `balance`. Stays null for
  // cash deals (no senior facility to redeem) and for schedules with no disposal at all
  // (e.g. exit_strategy.route === 'retain_all', where no month ever has gross_sale_pence > 0).
  let redemptionBalanceAtDisposal: number | null = null;
  // Spec §4.4.1: the exit fee is charged once, at the first full redemption; a later draw
  // that re-opens a balance does not re-trigger it.
  let facilityRedeemed = false;
  let facilityRedrawnFlagged = false;
  // Spec §4.4.1 declining redemption schedule: one entry per disposal month.
  const redemptionSchedule: Array<{ month: number; balance_pence: number }> = [];

  for (let m = 0; m < term; m++) {
    const u = schedule.uses[m];
    // R11 spec §17.6: VAT is a real cash outflow in the month it is incurred, so it
    // joins the month's cash uses alongside acquisition, construction, professional
    // and statutory — and is funded by the same waterfall below. It returns later as
    // `receipts[m].vat_reclaim_pence`, which repays rather than funds.
    const cashUses =
      u.acquisition_pence + u.construction_pence + u.professional_pence + u.statutory_pence
      + u.vat_pence + (m === 0 ? ancillaryFees : 0);

    let draw = 0;
    let capFees = 0;
    let equityContribution = 0;
    let additionalEquity = 0;
    let fundingGap = 0;

    const equityAvailable = () => (fundAsRequired
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, committedEquity - equityUsed - equityContribution));

    if (m === 0) {
      if (facilityExists) {
        capFees = arrangementFee;
        cumNetUsed += capFees;
        if (finance.day_one_advance_pence != null) {
          const headroomCap = grossHeadroomCap(grossFacility, monthlyRate, rolledUp, opening, capFees);
          draw = Math.max(0, Math.min(
            finance.day_one_advance_pence, netFacility - cumNetUsed, cashUses, headroomCap));
          cumNetUsed += draw;
        }
      }
      dayOneAdvance = draw;
      const needed = cashUses - draw;
      const fromEquity = Math.min(needed, equityAvailable());
      equityContribution += fromEquity;
      fundingGap += needed - fromEquity;
    } else {
      const fromEquity = Math.min(cashUses, equityAvailable());
      equityContribution += fromEquity;
      let remainder = cashUses - fromEquity;
      if (remainder > 0 && facilityExists) {
        // R11 spec §17.6: `u.vat_pence` is DELIBERATELY absent from this base and its
        // absence is load-bearing. Lenders do not advance against reclaimable VAT on
        // the same terms as against build cost, so VAT falls to equity or to gross
        // headroom and, where neither can meet it, to a visible `vat_funding_gap`.
        // Adding u.vat_pence here raises the cap and silently funds the VAT from the
        // facility — monthly-engine.test.ts's "funds the build but never advances
        // against the VAT" is the guard, and it has been watched failing.
        const eligible = u.construction_pence + u.professional_pence + u.statutory_pence;
        const advanceCap = Math.round((eligible * finance.development_cost_advance_pct) / 100);
        const undrawnNet = Math.max(0, netFacility - cumNetUsed);
        const headroomCap = grossHeadroomCap(grossFacility, monthlyRate, rolledUp, opening, capFees);
        draw = Math.max(0, Math.min(remainder, advanceCap, undrawnNet, headroomCap));
        cumNetUsed += draw;
        remainder -= draw;
      }
      fundingGap += remainder;
    }

    if (draw > 0 && facilityRedeemed && !facilityRedrawnFlagged) {
      facilityRedrawnFlagged = true;
      flags.push({
        code: 'facility_redrawn_after_redemption', severity: 'amber', month: m, amount_pence: draw,
        message: `Facility drawn again in month ${m} after full redemption — the exit fee was charged at first redemption and is not re-charged.`,
      });
    }

    const interestAccrued = isCash ? 0
      : Math.round((opening + draw + capFees) * monthlyRate);
    totalInterest += interestAccrued;
    let interestCapitalised = 0;
    let interestServiced = 0;
    if (rolledUp) {
      interestCapitalised = interestAccrued;
      cumCapitalisedInterest += interestCapitalised;
    } else if (interestAccrued > 0) {
      interestServiced = interestAccrued;
      // Serviced interest: committed equity first, then flagged additional equity (§4.3).
      const fromEquity = Math.min(interestServiced, equityAvailable());
      equityContribution += fromEquity;
      additionalEquity += interestServiced - fromEquity;
    }

    let balance = opening + draw + capFees + interestCapitalised;
    if (balance > peakDebt) { peakDebt = balance; peakDebtMonth = m; }

    const r = schedule.receipts[m];
    // Declared here, ahead of the VAT reclaim, so the reclaim, the sales sweep and the
    // §4.5 refinance all accumulate into the same three figures rather than shadowing
    // or overwriting one another.
    let repayment = 0;
    let exitFee = 0;
    let distribution = 0;
    let refinanceProceeds = 0;

    // R11 spec §17.6. A reclaim returns a specific advance, so it is applied whole
    // (ignoring sales_sweep_pct) and it is applied FIRST — it reduces the balance the
    // sale and the refinance then have to clear, and so the balance recorded as this
    // month's redemption balance below.
    //
    // A reclaim that fully clears the balance REDEEMS, on the same terms as any other
    // full redemption. The intuitive rule — "a reclaim is not a realisation, so it
    // never redeems" — silently loses the exit fee: the sale below charges it inside
    // `if (balance > 0 && !isCash)`, and a balance already zeroed by a reclaim takes
    // neither branch. The accepted consequence is that a later draw re-opening the
    // balance raises `facility_redrawn_after_redemption`, which is honest.
    const vatReclaim = r.vat_reclaim_pence;
    if (vatReclaim > 0) {
      if (balance > 0 && !isCash) {
        const fee = facilityRedeemed ? 0 : exitFeeAmount(finance, grossFacility, peakDebt, balance);
        if (vatReclaim >= balance + fee) {
          repayment += balance;
          exitFee += fee;
          totalExitFee += fee;
          facilityRedeemed = true;
          distribution += vatReclaim - balance - fee;
          balance = 0;
        } else {
          // A partial reclaim behaves exactly like a partial sales sweep, including
          // the §4.4 clamp: a reclaim landing in [balance, balance + fee) must not
          // zero the balance, or the fee is never charged and never carried.
          let applied = Math.min(vatReclaim, balance);
          if (applied === balance) applied = Math.max(0, vatReclaim - fee);
          repayment += applied;
          balance -= applied;
          distribution += vatReclaim - applied;
        }
      } else {
        // No facility left to repay (redeemed, or a cash deal): the reclaim flows to
        // the developer, exactly as sale receipts already do.
        distribution += vatReclaim;
      }
    }

    if (!isCash && r.gross_sale_pence > 0) {
      redemptionBalanceAtDisposal = balance;
      redemptionSchedule.push({ month: m, balance_pence: balance });
    }
    const netReceipts = r.gross_sale_pence - r.agent_fee_pence - r.selling_legal_pence;
    if (netReceipts > 0) {
      const sweepAvailable = Math.round((netReceipts * finance.sales_sweep_pct) / 100);
      // Sale-attributable only: `repayment`/`exitFee` may already carry a VAT reclaim,
      // and the clamp below compares against the balance this sweep alone can clear.
      let saleRepayment = 0;
      let saleExitFee = 0;
      if (balance > 0 && !isCash) {
        const fee = facilityRedeemed ? 0 : exitFeeAmount(finance, grossFacility, peakDebt, balance);
        if (sweepAvailable >= balance + fee) {
          saleRepayment = balance;
          saleExitFee = fee;
          totalExitFee += fee;
          facilityRedeemed = true;
          balance = 0;
        } else {
          // Spec §4.4: receipts insufficient to cover principal plus exit fee do not
          // discharge the facility; the balance carries. Without this clamp, a sweep
          // in [balance, balance + fee) would zero the balance via Math.min below
          // while the fee silently vanishes (never charged, never carried) — the
          // exit fee must not be payable from a repayment that fully clears principal.
          saleRepayment = Math.min(sweepAvailable, balance);
          if (saleRepayment === balance) saleRepayment = Math.max(0, sweepAvailable - fee);
          balance -= saleRepayment;
        }
      }
      repayment += saleRepayment;
      exitFee += saleExitFee;
      distribution += netReceipts - saleRepayment - saleExitFee;
    }

    // spec §4.5 refinance event — fixed order: the sales sweep above ran first.
    const refi = schedule.refinance;
    if (refi != null && refi.month === m) {
      let refiNet = refi.net_proceeds_pence;
      if (refiNet < 0) {
        additionalEquity += -refiNet;   // fees exceed the advance — equity funds the difference
        totalRefinanceShortfallEquity += -refiNet;
        refiNet = 0;
      }
      refinanceProceeds = refiNet;
      if (!isCash && balance > 0) {
        const fee = facilityRedeemed ? 0 : exitFeeAmount(finance, grossFacility, peakDebt, balance);
        const required = balance + fee;
        repayment += balance;
        exitFee += fee;
        totalExitFee += fee;
        facilityRedeemed = true;
        if (refiNet >= required) {
          distribution += refiNet - required;
        } else {
          additionalEquity += required - refiNet;   // §4.3 mechanics; additional_equity_required fires below
          totalRefinanceShortfallEquity += required - refiNet;
        }
        balance = 0;
      } else {
        distribution += refiNet;   // already redeemed, or a cash deal: proceeds distribute whole
      }
    }

    equityUsed += equityContribution;
    totalDraws += draw;
    totalCapFees += capFees;
    totalEquity += equityContribution;
    totalAdditionalEquity += additionalEquity;
    totalGap += fundingGap;
    totalDistributions += distribution;
    totalRepayments += repayment + exitFee;
    totalVat += u.vat_pence;
    totalVatReclaim += vatReclaim;

    if (fundingGap > 0 && !flags.some((f) => f.code === 'funding_gap')) {
      flags.push({
        code: 'funding_gap', severity: 'red', month: m, amount_pence: fundingGap,
        message: `Funding gap from month ${m}: committed equity and facility cannot fund all costs. Overruns do not create facility.`,
      });
    }
    // R11 spec §17.6: VAT is ineligible for the development-cost advance, so a gap can
    // open in a month whose build is fully advanced. Named separately from the generic
    // flag above (both fire) because the cause and the remedy are different: this is
    // working capital for the VAT carry, not an overrun. The VAT-attributable slice is
    // the smaller of the residual gap and the month's VAT.
    if (fundingGap > 0 && u.vat_pence > 0 && !flags.some((f) => f.code === 'vat_funding_gap')) {
      flags.push({
        code: 'vat_funding_gap', severity: 'red', month: m,
        amount_pence: Math.min(fundingGap, u.vat_pence),
        message: `VAT funding gap from month ${m}: ${Math.min(fundingGap, u.vat_pence)} pence of VAT is unfunded. VAT is not eligible for the development-cost advance, so it must come from equity or gross facility headroom.`,
      });
    }
    if (interestReserve != null && !reserveExhaustedFlagged
      && cumCapitalisedInterest > interestReserve) {
      reserveExhaustedFlagged = true;
      flags.push({
        code: 'interest_reserve_exhausted', severity: 'amber', month: m,
        amount_pence: cumCapitalisedInterest - interestReserve,
        message: `Interest reserve exhausted in month ${m}.`,
      });
    }
    if (grossFacility > 0 && balance > grossFacility && !facilityExceededFlagged) {
      facilityExceededFlagged = true;
      flags.push({
        code: 'facility_exceeded', severity: 'red', month: m,
        amount_pence: balance - grossFacility,
        message: `Closing balance exceeds committed gross facility in month ${m}.`,
      });
    }

    months.push({
      month: m,
      uses_total_pence: cashUses,
      opening_balance_pence: opening,
      draw_pence: draw,
      capitalised_fees_pence: capFees,
      interest_accrued_pence: interestAccrued,
      interest_capitalised_pence: interestCapitalised,
      interest_serviced_pence: interestServiced,
      exit_fee_pence: exitFee,
      repayment_pence: repayment,
      closing_balance_pence: balance,
      undrawn_net_facility_pence: facilityExists ? netFacility - cumNetUsed : null,
      facility_headroom_pence: grossFacility > 0 ? grossFacility - balance : null,
      interest_reserve_remaining_pence:
        interestReserve != null ? interestReserve - cumCapitalisedInterest : null,
      equity_contribution_pence: equityContribution,
      additional_equity_pence: additionalEquity,
      funding_gap_pence: fundingGap,
      gross_receipts_pence: r.gross_sale_pence,
      net_receipts_pence: netReceipts,
      vat_reclaim_pence: vatReclaim,
      refinance_proceeds_pence: refinanceProceeds,
      distribution_pence: distribution,
    });
    equityCashflows.push(-(equityContribution + additionalEquity) + distribution);
    opening = balance;
  }

  if (totalAdditionalEquity > 0) {
    flags.push({
      code: 'additional_equity_required', severity: 'red', month: null,
      amount_pence: totalAdditionalEquity,
      message: `Additional uncommitted equity of ${totalAdditionalEquity} pence required (e.g. to service interest).`,
    });
  }
  if (opening > 0) {
    flags.push({
      code: 'senior_outstanding_at_maturity', severity: 'red', month: term - 1,
      amount_pence: opening,
      message: 'Senior debt outstanding at maturity — repayment source (sale/refinance) not modelled.',
    });
    flags.push({
      code: 'exit_fee_not_charged', severity: 'info', month: term - 1, amount_pence: null,
      message: 'Exit fee excluded: the facility is not redeemed within the modelled term.',
    });
  }
  if (finance.requires_confirmation) {
    flags.push({
      code: 'requires_confirmation', severity: 'amber', month: null, amount_pence: null,
      message: 'Facility terms migrated from a legacy appraisal — confirm before lender use.',
    });
  }

  return {
    months,
    totals: {
      interest_pence: totalInterest,
      arrangement_fee_pence: arrangementFee,
      exit_fee_pence: totalExitFee,
      ancillary_fees_pence: ancillaryFees,
      finance_costs_pence: totalInterest + arrangementFee + totalExitFee + ancillaryFees,
      draws_pence: totalDraws,
      capitalised_fees_pence: totalCapFees,
      equity_contributed_pence: totalEquity,
      additional_equity_pence: totalAdditionalEquity,
      refinance_shortfall_equity_pence: totalRefinanceShortfallEquity,
      funding_gap_pence: totalGap,
      distributions_pence: totalDistributions,
      repayments_pence: totalRepayments,
      vat_pence: totalVat,
      vat_reclaim_pence: totalVatReclaim,
    },
    peak_debt_pence: peakDebt,
    peak_debt_month: peakDebt > 0 ? peakDebtMonth : null,
    day_one_advance_pence: dayOneAdvance,
    committed_net_facility_pence: netFacility,
    committed_gross_facility_pence: grossFacility,
    senior_outstanding_at_maturity_pence: opening,
    redemption_balance_at_disposal_pence: redemptionBalanceAtDisposal,
    redemption_schedule: redemptionSchedule,
    flags,
    equity_cashflows_pence: equityCashflows,
  };
}
