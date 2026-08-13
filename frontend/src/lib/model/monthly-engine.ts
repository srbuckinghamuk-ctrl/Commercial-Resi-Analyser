import type {
  EquitySource, FacilityTerms, LedgerMonth, ModelFlag, MonthlyModel, Schedule,
} from './finance-types';

function exitFeeAmount(
  finance: FacilityTerms, grossFacility: number, peakDebt: number, redemptionBalance: number,
): number {
  const base =
    finance.exit_fee_basis === 'peak_debt' ? peakDebt :
    finance.exit_fee_basis === 'redemption_balance' ? redemptionBalance :
    grossFacility;
  return Math.round((base * finance.exit_fee_pct) / 100);
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
  const committedEquity = equitySources
    .filter((s) => s.evidence_status !== 'rejected')
    .reduce((sum, s) => sum + s.amount_pence, 0);
  const hasFacility = !isCash && netFacility > 0;

  // Arrangement fee: charged on commitment, capitalised in month 0 (spec §3.9).
  const arrangementBase =
    finance.arrangement_fee_basis === 'committed_gross_facility' ? grossFacility : netFacility;
  const arrangementFee = hasFacility
    ? Math.round((arrangementBase * finance.arrangement_fee_pct) / 100) : 0;
  const ancillaryFees = hasFacility
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
  let totalGap = 0;
  let totalDistributions = 0;
  let totalRepayments = 0;
  let reserveExhaustedFlagged = false;
  let facilityExceededFlagged = false;

  for (let m = 0; m < term; m++) {
    const u = schedule.uses[m];
    const cashUses =
      u.acquisition_pence + u.construction_pence + u.professional_pence + u.statutory_pence
      + (m === 0 ? ancillaryFees : 0);

    let draw = 0;
    let capFees = 0;
    let equityContribution = 0;
    let additionalEquity = 0;
    let fundingGap = 0;

    const equityAvailable = () => (fundAsRequired
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, committedEquity - equityUsed - equityContribution));

    if (m === 0) {
      if (hasFacility) {
        capFees = arrangementFee;
        cumNetUsed += capFees;
        if (finance.day_one_advance_pence != null) {
          draw = Math.max(0, Math.min(
            finance.day_one_advance_pence, netFacility - cumNetUsed, cashUses));
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
      if (remainder > 0 && hasFacility) {
        const eligible = u.construction_pence + u.professional_pence + u.statutory_pence;
        const advanceCap = Math.round((eligible * finance.development_cost_advance_pct) / 100);
        const undrawnNet = Math.max(0, netFacility - cumNetUsed);
        draw = Math.max(0, Math.min(remainder, advanceCap, undrawnNet));
        cumNetUsed += draw;
        remainder -= draw;
      }
      fundingGap += remainder;
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
    const netReceipts = r.gross_sale_pence - r.agent_fee_pence - r.selling_legal_pence;
    let repayment = 0;
    let exitFee = 0;
    let distribution = 0;
    if (netReceipts > 0) {
      const sweepAvailable = Math.round((netReceipts * finance.sales_sweep_pct) / 100);
      if (balance > 0 && !isCash) {
        const fee = exitFeeAmount(finance, grossFacility, peakDebt, balance);
        if (sweepAvailable >= balance + fee) {
          repayment = balance;
          exitFee = fee;
          totalExitFee += fee;
          balance = 0;
        } else {
          repayment = Math.min(sweepAvailable, balance);
          balance -= repayment;
        }
      }
      distribution = netReceipts - repayment - exitFee;
    }

    equityUsed += equityContribution;
    totalDraws += draw;
    totalCapFees += capFees;
    totalEquity += equityContribution;
    totalAdditionalEquity += additionalEquity;
    totalGap += fundingGap;
    totalDistributions += distribution;
    totalRepayments += repayment + exitFee;

    if (fundingGap > 0 && !flags.some((f) => f.code === 'funding_gap')) {
      flags.push({
        code: 'funding_gap', severity: 'red', month: m, amount_pence: fundingGap,
        message: `Funding gap from month ${m}: committed equity and facility cannot fund all costs. Overruns do not create facility.`,
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
      undrawn_net_facility_pence: hasFacility ? netFacility - cumNetUsed : null,
      facility_headroom_pence: grossFacility > 0 ? grossFacility - balance : null,
      interest_reserve_remaining_pence:
        interestReserve != null ? interestReserve - cumCapitalisedInterest : null,
      equity_contribution_pence: equityContribution,
      additional_equity_pence: additionalEquity,
      funding_gap_pence: fundingGap,
      gross_receipts_pence: r.gross_sale_pence,
      net_receipts_pence: netReceipts,
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
      funding_gap_pence: totalGap,
      distributions_pence: totalDistributions,
      repayments_pence: totalRepayments,
    },
    peak_debt_pence: peakDebt,
    peak_debt_month: peakDebt > 0 ? peakDebtMonth : null,
    day_one_advance_pence: dayOneAdvance,
    committed_net_facility_pence: netFacility,
    committed_gross_facility_pence: grossFacility,
    senior_outstanding_at_maturity_pence: opening,
    flags,
    equity_cashflows_pence: equityCashflows,
  };
}
