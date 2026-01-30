'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { 
  Loader2, 
  ExternalLink, 
  Download,
  ArrowLeft,
  Building2,
  MapPin,
  Calendar,
  Ruler,
  DoorOpen,
} from 'lucide-react';

interface MonthlyData {
  month: number;
  nightly_rate: number | null;
  occupancy_rate: number | null;
  booked_nights: number | null;
  reservations: number | null;
  avg_stay: number | null;
  revenue: number | null;
}

interface CostBreakdown {
  cleaning_fee_per_reservation: number;
  ota_fee_rate: number;
  management_fee_rate: number;
  other_cost_rate: number;
  cleaning_cost: number;
  ota_fee: number;
  management_fee: number;
  other_cost: number;
  total_cost: number;
}

interface Simulation {
  id: string;
  scenario: string;
  annual_revenue: number;
  annual_revenue_man: number;
  annual_profit: number | null;
  annual_profit_man: number | null;
  assumptions: {
    costs?: CostBreakdown;
    [key: string]: unknown;
  };
  monthlies: MonthlyData[];
}

interface PropertyDetail {
  id: string;
  url: string;
  title: string;
  price: number;
  priceMan: number;
  scraped_at: string;
  portal_site: { name: string; key: string; base_url: string };
  property: {
    id: string;
    address: string;
    city: string | null;
    building_area: number | null;
    land_area: number | null;
    built_year: number | null;
    rooms: number | null;
    property_type: string | null;
  };
  simulations: Simulation[];
  annual_revenue: number;
  annual_revenue_man: number;
  annual_profit: number;
  annual_profit_man: number;
  renovation_budget: number;
  renovation_budget_man: number;
  actual_multiple: string | null;
}

const SCENARIO_LABELS: Record<string, { label: string; color: string }> = {
  NEGATIVE: { label: 'ネガティブ', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  NEUTRAL: { label: 'ニュートラル', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  POSITIVE: { label: 'ポジティブ', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export default function PropertyDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchProperty();
    }
  }, [id]);

  async function fetchProperty() {
    try {
      const res = await fetch(`/api/properties/${id}`);
      const result = await res.json();
      setData(result);
    } catch (error) {
      console.error('Failed to fetch property:', error);
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv(scenario?: string) {
    const url = scenario 
      ? `/api/properties/${id}/csv?scenario=${scenario}`
      : `/api/properties/${id}/csv`;
    window.open(url, '_blank');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">物件が見つかりませんでした</p>
        <Link href="/properties">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            一覧に戻る
          </Button>
        </Link>
      </div>
    );
  }

  // NEUTRALシナリオのデータを取得
  const neutralSim = data.simulations?.find(s => s.scenario === 'NEUTRAL');
  const annualProfit = neutralSim?.annual_profit || data.annual_profit || 0;
  const annualProfitMan = Math.round(annualProfit / 10000);

  return (
    <div>
      {/* ヘッダー */}
      <div className="mb-6">
        <Link href="/properties" className="text-blue-600 hover:underline text-sm flex items-center gap-1 mb-2">
          <ArrowLeft className="w-4 h-4" />
          物件一覧に戻る
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{data.title || '物件名不明'}</h1>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline">{data.portal_site?.name}</Badge>
              <a 
                href={data.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm flex items-center gap-1"
              >
                元サイトで見る
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <Button onClick={() => downloadCsv()} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            CSV出力
          </Button>
        </div>
      </div>

      {/* 物件情報カード */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              価格情報
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm text-gray-500">販売価格</div>
              <div className="text-2xl font-bold">{data.priceMan.toLocaleString()}万円</div>
            </div>
            <Separator />
            <div>
              <div className="text-sm text-gray-500">年間想定利益（中立）</div>
              <div className="text-xl font-bold">
                {annualProfitMan.toLocaleString()}万円
              </div>
              <div className="text-xs text-gray-400">
                売上 {data.annual_revenue_man.toLocaleString()}万円 - コスト
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">倍率</div>
              <div className="text-lg font-medium">
                {data.actual_multiple}倍
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500">リノベ予算（10倍基準）</div>
              <div className="text-lg font-medium text-blue-600">
                {data.renovation_budget_man > 0 
                  ? `${data.renovation_budget_man.toLocaleString()}万円`
                  : '-'
                }
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">物件詳細</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-1 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">所在地</div>
                  <div>{data.property.address || '-'}</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Ruler className="w-4 h-4 mt-1 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">建物面積</div>
                  <div>{data.property.building_area ? `${data.property.building_area}㎡` : '-'}</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Ruler className="w-4 h-4 mt-1 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">土地面積</div>
                  <div>{data.property.land_area ? `${data.property.land_area}㎡` : '-'}</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 mt-1 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">築年</div>
                  <div>{data.property.built_year ? `${data.property.built_year}年` : '-'}</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <DoorOpen className="w-4 h-4 mt-1 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">部屋数/戸数</div>
                  <div>{data.property.rooms ?? '-'}</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Building2 className="w-4 h-4 mt-1 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-500">物件タイプ</div>
                  <div>{data.property.property_type || '-'}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* シミュレーション結果 */}
      <Card>
        <CardHeader>
          <CardTitle>利益シミュレーション（12ヶ月）</CardTitle>
          <CardDescription>
            3つのシナリオ（ネガティブ/ニュートラル/ポジティブ）で計算。売上からコストを差し引いた利益を算出。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.simulations && data.simulations.length > 0 ? (
            <Tabs defaultValue="NEUTRAL">
              <div className="flex items-center justify-between mb-4">
                <TabsList>
                  {data.simulations.map((sim) => (
                    <TabsTrigger key={sim.scenario} value={sim.scenario}>
                      <span className={`px-2 py-1 rounded text-sm border ${SCENARIO_LABELS[sim.scenario]?.color}`}>
                        {SCENARIO_LABELS[sim.scenario]?.label}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              {data.simulations.map((sim) => {
                const costs = sim.assumptions?.costs;
                const totalReservations = sim.monthlies?.reduce((s, m) => s + (m.reservations || 0), 0) || 0;
                
                return (
                  <TabsContent key={sim.scenario} value={sim.scenario}>
                    {/* サマリー - 3ブロック */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      {/* 売上ブロック */}
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="text-sm text-slate-500 mb-1">年間売上</div>
                        <div className="text-2xl font-bold text-slate-700">
                          {sim.annual_revenue_man.toLocaleString()}万円
                        </div>
                      </div>
                      
                      {/* コストブロック */}
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="text-sm text-slate-500 mb-1">年間コスト</div>
                        <div className="text-2xl font-bold text-slate-600">
                          -{costs ? Math.round(costs.total_cost / 10000).toLocaleString() : 0}万円
                        </div>
                        {costs && (
                          <div className="text-xs text-slate-400 mt-1">
                            清掃{Math.round(costs.cleaning_cost/10000)}万 / OTA{Math.round(costs.ota_fee/10000)}万 / 運営{Math.round(costs.management_fee/10000)}万 / 他{Math.round(costs.other_cost/10000)}万
                          </div>
                        )}
                      </div>
                      
                      {/* 利益ブロック */}
                      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="text-sm text-blue-600 mb-1">年間利益</div>
                        <div className="text-2xl font-bold text-blue-700">
                          {(sim.annual_profit_man || 0).toLocaleString()}万円
                        </div>
                      </div>
                    </div>

                    {/* コスト内訳 */}
                    {costs && (
                      <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="font-medium text-slate-700 mb-3">コスト内訳</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="p-3 bg-white rounded border">
                            <div className="text-slate-500">清掃費</div>
                            <div className="font-medium text-slate-700">
                              {Math.round(costs.cleaning_cost / 10000).toLocaleString()}万円
                            </div>
                            <div className="text-xs text-slate-400">
                              {costs.cleaning_fee_per_reservation.toLocaleString()}円 × {totalReservations}回
                            </div>
                          </div>
                          <div className="p-3 bg-white rounded border">
                            <div className="text-slate-500">OTA手数料</div>
                            <div className="font-medium text-slate-700">
                              {Math.round(costs.ota_fee / 10000).toLocaleString()}万円
                            </div>
                            <div className="text-xs text-slate-400">
                              売上の{costs.ota_fee_rate}%
                            </div>
                          </div>
                          <div className="p-3 bg-white rounded border">
                            <div className="text-slate-500">運営代行</div>
                            <div className="font-medium text-slate-700">
                              {Math.round(costs.management_fee / 10000).toLocaleString()}万円
                            </div>
                            <div className="text-xs text-slate-400">
                              売上の{costs.management_fee_rate}%
                            </div>
                          </div>
                          <div className="p-3 bg-white rounded border">
                            <div className="text-slate-500">その他経費</div>
                            <div className="font-medium text-slate-700">
                              {Math.round(costs.other_cost / 10000).toLocaleString()}万円
                            </div>
                            <div className="text-xs text-slate-400">
                              売上の{costs.other_cost_rate}%
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 月次テーブル（全項目1表） */}
                    <div className="overflow-x-auto border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="w-16">月</TableHead>
                            <TableHead className="text-right">宿泊単価</TableHead>
                            <TableHead className="text-right">稼働率</TableHead>
                            <TableHead className="text-right">稼働日数</TableHead>
                            <TableHead className="text-right">予約件数</TableHead>
                            <TableHead className="text-right">平均宿泊</TableHead>
                            <TableHead className="text-right">売上</TableHead>
                            <TableHead className="text-right text-slate-500">清掃費</TableHead>
                            <TableHead className="text-right text-slate-500">OTA</TableHead>
                            <TableHead className="text-right text-slate-500">運営</TableHead>
                            <TableHead className="text-right text-slate-500">他</TableHead>
                            <TableHead className="text-right text-slate-600">コスト計</TableHead>
                            <TableHead className="text-right text-blue-700 font-bold">利益</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sim.monthlies?.map((m) => {
                            const revenue = m.revenue || 0;
                            const reservations = m.reservations || 0;
                            const cleaningCost = costs ? reservations * costs.cleaning_fee_per_reservation : 0;
                            const otaFee = costs ? Math.round(revenue * (costs.ota_fee_rate / 100)) : 0;
                            const managementFee = costs ? Math.round(revenue * (costs.management_fee_rate / 100)) : 0;
                            const otherCost = costs ? Math.round(revenue * (costs.other_cost_rate / 100)) : 0;
                            const monthlyCost = cleaningCost + otaFee + managementFee + otherCost;
                            const monthlyProfit = revenue - monthlyCost;
                            
                            return (
                              <TableRow key={m.month}>
                                <TableCell className="font-medium">{MONTH_NAMES[m.month - 1]}</TableCell>
                                <TableCell className="text-right">
                                  {m.nightly_rate?.toLocaleString()}円
                                </TableCell>
                                <TableCell className="text-right">
                                  {m.occupancy_rate?.toFixed(1)}%
                                </TableCell>
                                <TableCell className="text-right">
                                  {m.booked_nights}日
                                </TableCell>
                                <TableCell className="text-right">
                                  {reservations}件
                                </TableCell>
                                <TableCell className="text-right">
                                  {m.avg_stay?.toFixed(1)}泊
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {(revenue / 10000).toFixed(1)}万円
                                </TableCell>
                                <TableCell className="text-right text-slate-500">
                                  {(cleaningCost / 10000).toFixed(1)}万
                                </TableCell>
                                <TableCell className="text-right text-slate-500">
                                  {(otaFee / 10000).toFixed(1)}万
                                </TableCell>
                                <TableCell className="text-right text-slate-500">
                                  {(managementFee / 10000).toFixed(1)}万
                                </TableCell>
                                <TableCell className="text-right text-slate-500">
                                  {(otherCost / 10000).toFixed(1)}万
                                </TableCell>
                                <TableCell className="text-right text-slate-600">
                                  {(monthlyCost / 10000).toFixed(1)}万円
                                </TableCell>
                                <TableCell className="text-right font-medium text-blue-700">
                                  {(monthlyProfit / 10000).toFixed(1)}万円
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow className="bg-slate-100 font-bold">
                            <TableCell>年間合計</TableCell>
                            <TableCell className="text-right">-</TableCell>
                            <TableCell className="text-right">-</TableCell>
                            <TableCell className="text-right">
                              {sim.monthlies?.reduce((s, m) => s + (m.booked_nights || 0), 0)}日
                            </TableCell>
                            <TableCell className="text-right">
                              {totalReservations}件
                            </TableCell>
                            <TableCell className="text-right">-</TableCell>
                            <TableCell className="text-right">
                              {sim.annual_revenue_man.toLocaleString()}万円
                            </TableCell>
                            <TableCell className="text-right text-slate-500">
                              {costs ? Math.round(costs.cleaning_cost / 10000) : 0}万
                            </TableCell>
                            <TableCell className="text-right text-slate-500">
                              {costs ? Math.round(costs.ota_fee / 10000) : 0}万
                            </TableCell>
                            <TableCell className="text-right text-slate-500">
                              {costs ? Math.round(costs.management_fee / 10000) : 0}万
                            </TableCell>
                            <TableCell className="text-right text-slate-500">
                              {costs ? Math.round(costs.other_cost / 10000) : 0}万
                            </TableCell>
                            <TableCell className="text-right text-slate-600">
                              {costs ? Math.round(costs.total_cost / 10000).toLocaleString() : 0}万円
                            </TableCell>
                            <TableCell className="text-right text-blue-700">
                              {(sim.annual_profit_man || 0).toLocaleString()}万円
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => downloadCsv(sim.scenario)}>
                        <Download className="w-4 h-4 mr-2" />
                        このシナリオをCSV出力
                      </Button>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          ) : (
            <div className="text-center py-8 text-gray-500">
              シミュレーションデータがありません
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
