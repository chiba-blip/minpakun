/**
 * 管理者用手動トリガー
 * ?job=scrape|simulate|notify で任意のジョブを実行
 */
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { handler as scrapeHandler } from './jobs-scrape';
import { handler as simulateHandler } from './jobs-simulate';
import { handler as notifyHandler } from './jobs-notify';
import { logInfo, logError } from './_shared/log.mts';

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const params = event.queryStringParameters || {};
  const job = params.job;

  logInfo('admin-trigger called', { job });

  // 簡易認証（本番では適切な認証を実装）
  const authHeader = event.headers.authorization;
  const expectedToken = process.env.ADMIN_TRIGGER_TOKEN;

  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  if (!job) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Missing job parameter',
        usage: '?job=scrape|simulate|notify',
      }),
    };
  }

  try {
    let result;

    switch (job) {
      case 'scrape':
        result = await scrapeHandler(event, context);
        break;
      case 'simulate':
        result = await simulateHandler(event, context);
        break;
      case 'notify':
        result = await notifyHandler(event, context);
        break;
      default:
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Unknown job: ${job}`,
            available: ['scrape', 'simulate', 'notify'],
          }),
        };
    }

    return result;
  } catch (error) {
    logError('admin-trigger failed', { job, error: String(error) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(error) }),
    };
  }
};
