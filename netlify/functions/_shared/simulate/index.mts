/**
 * シミュレーション実行エントリポイント
 * AirROI → AirDNA → Heuristics の順でフォールバック
 */
import type { PropertyInput, SimulationResult, SimulationAssumptions } from './types';
import { runHeuristicsSimulation } from './heuristics';
// import { runAirroiSimulation } from './airoi';
// import { runAirdnaSimulation } from './airdna';
import { logInfo, logWarn } from '../log';

/**
 * シミュレーションを実行
 */
export async function runSimulation(
  property: PropertyInput,
  costConfig?: SimulationAssumptions['cost_config']
): Promise<SimulationResult[]> {
  const hasLatLng = property.lat && property.lng;
  
  // 1. AirROI APIを試す（実装時にコメント解除）
  /*
  if (process.env.AIRROI_API_KEY && hasLatLng) {
    try {
      logInfo('Attempting AirROI simulation');
      const results = await runAirroiSimulation(property, costConfig);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logWarn('AirROI failed, falling back', { error: String(error) });
    }
  }
  */

  // 2. AirDNA APIを試す（実装時にコメント解除）
  /*
  if (process.env.AIRDNA_API_KEY && hasLatLng) {
    try {
      logInfo('Attempting AirDNA simulation');
      const results = await runAirdnaSimulation(property, costConfig);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logWarn('AirDNA failed, falling back', { error: String(error) });
    }
  }
  */

  // 3. Heuristics（フォールバック）
  logInfo('Using heuristics simulation', { city: property.city });
  return runHeuristicsSimulation(property, costConfig);
}

export { runHeuristicsSimulation } from './heuristics';
export type { PropertyInput, SimulationResult, MonthlyData, Scenario, SimulationAssumptions } from './types';
