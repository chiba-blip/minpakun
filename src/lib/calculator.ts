/**
 * ネット売上・粗利計算ロジック
 */

import { CostInput, MonthlyEstimate, AnnualEstimate, EstimateRange } from '@/types/property';
import { RentalizerMonthly } from './airdna';

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * 単月の費用控除・ネット売上を計算
 */
export function calculateMonthly(
  month: number, // 1-12
  grossRevenue: number,
  adr: number,
  occupancyRate: number,
  cost: CostInput
): MonthlyEstimate {
  const daysInMonth = DAYS_IN_MONTH[month - 1];
  
  // 稼働日数
  const occupiedNights = daysInMonth * occupancyRate;
  
  // ターンオーバー回数（宿泊日数で割る）
  const turnovers = Math.min(
    Math.max(occupiedNights / cost.avgStayNights, 0),
    daysInMonth // 最大でも日数を超えない
  );
  
  // 各費用計算
  const otaFee = grossRevenue * cost.otaFeeRate;
  const managementFee = grossRevenue * cost.managementFeeRate;
  const cleaningCost = turnovers * cost.cleaningCostPerTurnover;
  const linenCost = turnovers * cost.linenCostPerTurnover;
  const consumablesCost = occupiedNights * cost.consumablesCostPerNight;
  const fixedCost = cost.utilitiesCostPerMonth + cost.otherFixedCostPerMonth;
  
  const totalCost = otaFee + managementFee + cleaningCost + linenCost + consumablesCost + fixedCost;
  const netRevenue = grossRevenue - totalCost;
  
  return {
    month,
    days_in_month: daysInMonth,
    gross_revenue: Math.round(grossRevenue),
    adr: Math.round(adr),
    occupancy_rate: Math.round(occupancyRate * 100) / 100,
    occupied_nights: Math.round(occupiedNights * 10) / 10,
    turnovers: Math.round(turnovers * 10) / 10,
    ota_fee: Math.round(otaFee),
    management_fee: Math.round(managementFee),
    cleaning_cost: Math.round(cleaningCost),
    linen_cost: Math.round(linenCost),
    consumables_cost: Math.round(consumablesCost),
    fixed_cost: Math.round(fixedCost),
    total_cost: Math.round(totalCost),
    net_revenue: Math.round(netRevenue),
  };
}

/**
 * 年次集計
 */
export function calculateAnnual(monthly: MonthlyEstimate[]): AnnualEstimate {
  const grossRevenue = monthly.reduce((sum, m) => sum + m.gross_revenue, 0);
  const totalCost = monthly.reduce((sum, m) => sum + m.total_cost, 0);
  const netRevenue = monthly.reduce((sum, m) => sum + m.net_revenue, 0);
  const avgOccupancy = monthly.reduce((sum, m) => sum + m.occupancy_rate, 0) / 12;
  const avgAdr = monthly.reduce((sum, m) => sum + m.adr, 0) / 12;
  
  return {
    gross_revenue: Math.round(grossRevenue),
    total_cost: Math.round(totalCost),
    net_revenue: Math.round(netRevenue),
    avg_occupancy: Math.round(avgOccupancy * 100) / 100,
    avg_adr: Math.round(avgAdr),
  };
}

/**
 * 3レンジ（保守/標準/強気）の計算
 */
export function calculateRanges(
  airdnaMonthly: RentalizerMonthly[],
  cost: CostInput
): EstimateRange {
  // レンジ係数
  const factors = {
    conservative: { revenue: 0.85, occupancy: -0.05 },
    standard: { revenue: 1.0, occupancy: 0 },
    optimistic: { revenue: 1.15, occupancy: 0.05 },
  };
  
  const calculateRange = (factor: { revenue: number; occupancy: number }) => {
    const monthly = airdnaMonthly.map((m) => {
      const adjustedOccupancy = Math.min(
        Math.max(m.occupancy + factor.occupancy, 0),
        0.95 // 最大95%
      );
      const adjustedRevenue = m.revenue * factor.revenue;
      
      return calculateMonthly(
        m.month,
        adjustedRevenue,
        m.adr,
        adjustedOccupancy,
        cost
      );
    });
    
    return {
      monthly,
      annual: calculateAnnual(monthly),
    };
  };
  
  return {
    conservative: calculateRange(factors.conservative),
    standard: calculateRange(factors.standard),
    optimistic: calculateRange(factors.optimistic),
  };
}

