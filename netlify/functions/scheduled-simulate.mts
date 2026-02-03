import type { Handler } from '@netlify/functions';

/**
 * Scheduled Function: シミュレーション（無効化済み）
 * 
 * AirROI APIコスト管理のため、自動シミュレーションは無効化しています。
 * シミュレーションはダッシュボードから手動で実行してください。
 */
export const handler: Handler = async () => {
  console.log('[scheduled-simulate] Disabled - manual execution only');
  
  return {
    statusCode: 200,
    body: JSON.stringify({ 
      message: 'Automatic simulation is disabled. Please run manually from dashboard.',
      disabled: true,
    }),
  };
};
