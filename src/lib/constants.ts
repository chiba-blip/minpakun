/**
 * 定数定義
 */

// 北海道の市区町村（主要エリア）
export const HOKKAIDO_AREAS = [
  // 札幌市
  { value: '札幌市', label: '札幌市全体' },
  { value: '札幌市中央区', label: '札幌市中央区' },
  { value: '札幌市北区', label: '札幌市北区' },
  { value: '札幌市東区', label: '札幌市東区' },
  { value: '札幌市白石区', label: '札幌市白石区' },
  { value: '札幌市豊平区', label: '札幌市豊平区' },
  { value: '札幌市南区', label: '札幌市南区' },
  { value: '札幌市西区', label: '札幌市西区' },
  { value: '札幌市厚別区', label: '札幌市厚別区' },
  { value: '札幌市手稲区', label: '札幌市手稲区' },
  { value: '札幌市清田区', label: '札幌市清田区' },
  // 主要都市
  { value: '小樽市', label: '小樽市' },
  { value: '旭川市', label: '旭川市' },
  { value: '函館市', label: '函館市' },
  { value: '釧路市', label: '釧路市' },
  { value: '帯広市', label: '帯広市' },
  { value: '北見市', label: '北見市' },
  { value: '苫小牧市', label: '苫小牧市' },
  { value: '千歳市', label: '千歳市' },
  { value: '江別市', label: '江別市' },
  { value: '室蘭市', label: '室蘭市' },
  { value: '岩見沢市', label: '岩見沢市' },
  { value: '恵庭市', label: '恵庭市' },
  { value: '北広島市', label: '北広島市' },
  { value: '石狩市', label: '石狩市' },
  { value: '登別市', label: '登別市' },
  { value: '網走市', label: '網走市' },
  { value: '稚内市', label: '稚内市' },
  { value: '紋別市', label: '紋別市' },
  { value: '名寄市', label: '名寄市' },
  { value: '根室市', label: '根室市' },
  { value: '滝川市', label: '滝川市' },
  { value: '砂川市', label: '砂川市' },
  { value: '深川市', label: '深川市' },
  { value: '富良野市', label: '富良野市' },
  { value: '留萌市', label: '留萌市' },
  { value: '美唄市', label: '美唄市' },
  { value: '芦別市', label: '芦別市' },
  { value: '赤平市', label: '赤平市' },
  { value: '三笠市', label: '三笠市' },
  { value: '夕張市', label: '夕張市' },
  { value: '伊達市', label: '伊達市' },
  // リゾート・観光地
  { value: 'ニセコ町', label: 'ニセコ町' },
  { value: '倶知安町', label: '倶知安町' },
  { value: '余市町', label: '余市町' },
  { value: '洞爺湖町', label: '洞爺湖町' },
  { value: '留寿都村', label: '留寿都村' },
  { value: '真狩村', label: '真狩村' },
  { value: '京極町', label: '京極町' },
  { value: '喜茂別町', label: '喜茂別町' },
  { value: '蘭越町', label: '蘭越町' },
  { value: '共和町', label: '共和町' },
  { value: '岩内町', label: '岩内町' },
  { value: '仁木町', label: '仁木町' },
  { value: '積丹町', label: '積丹町' },
  { value: '古平町', label: '古平町' },
  { value: '赤井川村', label: '赤井川村' },
  { value: '南幌町', label: '南幌町' },
  { value: '奈井江町', label: '奈井江町' },
  { value: '上砂川町', label: '上砂川町' },
  { value: '由仁町', label: '由仁町' },
  { value: '長沼町', label: '長沼町' },
  { value: '栗山町', label: '栗山町' },
  { value: '当別町', label: '当別町' },
  { value: '新篠津村', label: '新篠津村' },
  // 十勝エリア
  { value: '音更町', label: '音更町' },
  { value: '士幌町', label: '士幌町' },
  { value: '上士幌町', label: '上士幌町' },
  { value: '鹿追町', label: '鹿追町' },
  { value: '新得町', label: '新得町' },
  { value: '清水町', label: '清水町' },
  { value: '芽室町', label: '芽室町' },
  { value: '中札内村', label: '中札内村' },
  { value: '更別村', label: '更別村' },
  { value: '大樹町', label: '大樹町' },
  { value: '広尾町', label: '広尾町' },
  { value: '幕別町', label: '幕別町' },
  { value: '池田町', label: '池田町' },
  { value: '豊頃町', label: '豊頃町' },
  { value: '本別町', label: '本別町' },
  { value: '足寄町', label: '足寄町' },
  { value: '陸別町', label: '陸別町' },
  { value: '浦幌町', label: '浦幌町' },
] as const;

// 物件タイプ
export const PROPERTY_TYPES = [
  { value: '中古戸建て', label: '中古戸建て' },
  { value: '一棟集合住宅', label: '一棟アパート・マンション' },
  { value: '区分マンション', label: '区分マンション' },
  { value: '土地', label: '土地' },
  { value: '店舗・事務所', label: '店舗・事務所' },
  { value: 'その他', label: 'その他' },
] as const;

// 価格帯の選択肢
export const PRICE_OPTIONS = [
  { value: '', label: '指定なし' },
  { value: '1000000', label: '100万円' },
  { value: '3000000', label: '300万円' },
  { value: '5000000', label: '500万円' },
  { value: '10000000', label: '1,000万円' },
  { value: '20000000', label: '2,000万円' },
  { value: '30000000', label: '3,000万円' },
  { value: '50000000', label: '5,000万円' },
  { value: '100000000', label: '1億円' },
  { value: '200000000', label: '2億円' },
  { value: '500000000', label: '5億円' },
] as const;

// 駅徒歩の選択肢
export const WALK_MINUTES_OPTIONS = [
  { value: '', label: '指定なし' },
  { value: '5', label: '5分以内' },
  { value: '10', label: '10分以内' },
  { value: '15', label: '15分以内' },
  { value: '20', label: '20分以内' },
  { value: '30', label: '30分以内' },
] as const;

// 築年数の選択肢
export const BUILT_YEAR_OPTIONS = [
  { value: '', label: '指定なし' },
  { value: '2020', label: '5年以内' },
  { value: '2015', label: '10年以内' },
  { value: '2005', label: '20年以内' },
  { value: '1995', label: '30年以内' },
  { value: '1985', label: '40年以内' },
  { value: '1975', label: '50年以内' },
] as const;

// 建物面積の選択肢
export const BUILDING_AREA_OPTIONS = [
  { value: '', label: '指定なし' },
  { value: '50', label: '50㎡' },
  { value: '80', label: '80㎡' },
  { value: '100', label: '100㎡' },
  { value: '150', label: '150㎡' },
  { value: '200', label: '200㎡' },
  { value: '300', label: '300㎡' },
  { value: '500', label: '500㎡' },
] as const;

// 型定義
export type HokkaidoArea = typeof HOKKAIDO_AREAS[number]['value'];
export type PropertyType = typeof PROPERTY_TYPES[number]['value'];
