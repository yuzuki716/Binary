/**
 * Conservative EV estimate that accounts for backtesting overfitting.
 *
 * Two adjustments applied:
 *  1. Statistical: 90% confidence interval lower bound on win rate
 *     (corrects for small sample size)
 *  2. Overfitting decay: assumes 15-25% of backtest edge is curve-fitting
 *     (corrects for parameter selection bias across many combinations tested)
 *
 * Always computed at REFERENCE_PAYOUT so the value never changes when the
 * user updates their payout rate input.
 */

const REFERENCE_PAYOUT = 0.80   // fixed reference — do NOT use user's payout here

export function conservativeEvPerTrade(winRate: number, totalTrades: number): number | null {
  if (totalTrades < 10) return null

  // 90% CI lower bound (z = 1.282)
  const se = Math.sqrt(winRate * (1 - winRate) / totalTrades)
  const pStat = winRate - 1.282 * se

  // Overfitting decay: larger samples are more reliable
  const decay = totalTrades >= 100 ? 0.85 : totalTrades >= 50 ? 0.80 : 0.75

  const pConservative = 0.5 + (pStat - 0.5) * decay
  return pConservative * REFERENCE_PAYOUT - (1 - pConservative)
}
