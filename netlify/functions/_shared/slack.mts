/**
 * Slack通知ユーティリティ
 */
import { logError, logInfo } from './log.mts';

export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: {
    type: string;
    text: string;
  }[];
  accessory?: unknown;
}

/**
 * Slack Webhookにメッセージを送信
 */
export async function sendSlackMessage(
  webhookUrl: string,
  message: SlackMessage
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      logError('Slack send failed', { status: response.status });
      return false;
    }

    logInfo('Slack message sent');
    return true;
  } catch (error) {
    logError('Slack send error', { error: String(error) });
    return false;
  }
}

/**
 * 物件通知用のメッセージを構築
 */
export function buildPropertyNotification(params: {
  title: string;
  url: string;
  price: number;
  annualRevenue: number;
  multiple: number;
  address: string;
  buildingArea: number | null;
  renovationBudget: number;
}): SlackMessage {
  const {
    title,
    url,
    price,
    annualRevenue,
    multiple,
    address,
    buildingArea,
    renovationBudget,
  } = params;

  const priceMan = Math.round(price / 10000);
  const revenueMan = Math.round(annualRevenue / 10000);
  const budgetMan = Math.round(renovationBudget / 10000);
  const actualMultiple = (price / annualRevenue).toFixed(1);

  return {
    text: `新着物件: ${title}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🏠 条件適合物件を発見！',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${url}|${title}>*`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*販売価格:* ${priceMan.toLocaleString()}万円` },
          { type: 'mrkdwn', text: `*年間想定収益:* ${revenueMan.toLocaleString()}万円` },
          { type: 'mrkdwn', text: `*倍率:* ${actualMultiple}倍 (基準: ${multiple}倍)` },
          { type: 'mrkdwn', text: `*リノベ予算:* ${budgetMan.toLocaleString()}万円` },
          { type: 'mrkdwn', text: `*所在地:* ${address}` },
          { type: 'mrkdwn', text: `*建物面積:* ${buildingArea ? `${buildingArea}㎡` : '不明'}` },
        ],
      },
    ],
  };
}
