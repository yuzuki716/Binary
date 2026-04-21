/**
 * Conservative EV adjustment for backtest overfitting.
 *
 * computeFixedDiscount() returns a FIXED penalty (in EV units) that represents
 * the expected performance decay from backtest to live trading.
 * It is computed purely from win_rate and total_trades — never from payout rate.
 *
 * Usage:
 *   fixedDiscount = computeFixedDiscount(win_rate, total_trades)
 *   consEv = evPerTrade(payout) - fixedDiscount
 *
 * When payout changes: evPerTrade changes, fixedDiscount stays the same.
 *
 * Method:
 *  1. Statistical: 75% CI lower bound on win rate (corrects for small sample)
 *  2. Overfitting decay 80-90% by sample size (corrects for parameter selection)
 *  3. Penalty = EV loss at 80% reference payout (payout-independent fixed value)
 */

const REFERENCE_PAYOUT = 0.80
const Z = 0.674  // 75% one-tailed CI

export function computeFixedDiscount(winRate: number, totalTrades: number): number | null {
  if (totalTrades < 10) return null

  const se = Math.sqrt(winRate * (1 - winRate) / totalTrades)
  const pStat = winRate - Z * se

  const decay = totalTrades >= 100 ? 0.90 : totalTrades >= 50 ? 0.85 : 0.80
  const pConservative = 0.5 + (pStat - 0.5) * decay

  const evRaw  = winRate      * REFERENCE_PAYOUT - (1 - winRate)
  const evCons = pConservative * REFERENCE_PAYOUT - (1 - pConservative)

  return Math.max(0, evRaw - evCons)
}
