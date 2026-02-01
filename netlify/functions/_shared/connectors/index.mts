/**
 * Connector管理
 * 有効なサイトのConnectorを動的にロード
 */
import type { Connector } from './types.mts';
import { KenbiyaConnector } from './kenbiya.mts';
import { RakumachiConnector } from './rakumachi.mts';
import { SuumoConnector } from './suumo.mts';
import { AthomeConnector } from './athome.mts';
import { HomesConnector } from './homes.mts';
import { HokkaidoRengotaiConnector } from './hokkaido-rengotai.mts';
import { HousedoConnector } from './housedo.mts';

/**
 * 利用可能なConnector一覧
 */
const CONNECTORS: Record<string, Connector> = {
  kenbiya: new KenbiyaConnector(),
  rakumachi: new RakumachiConnector(),
  suumo: new SuumoConnector(),
  athome: new AthomeConnector(),
  homes: new HomesConnector(),
  'hokkaido-rengotai': new HokkaidoRengotaiConnector(),
  housedo: new HousedoConnector(),
};

/**
 * 指定されたキーのConnectorを取得
 */
export function getConnector(key: string): Connector | null {
  return CONNECTORS[key] || null;
}

/**
 * 有効なサイトキーに対応するConnectorリストを取得
 */
export function getConnectors(enabledKeys: string[]): Connector[] {
  return enabledKeys
    .map(key => CONNECTORS[key])
    .filter((c): c is Connector => c !== undefined);
}

/**
 * 全Connectorキー一覧
 */
export function getAllConnectorKeys(): string[] {
  return Object.keys(CONNECTORS);
}
