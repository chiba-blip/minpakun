'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  MapPin,
  Train,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Property, CostProfile, Estimate, MonthlyEstimate, AnnualEstimate } from '@/types/property';

interface PropertyDetail extends Property {
  cost_profiles: CostProfile[];
  latest_estimate: Estimate | null;
}

const MONTH_NAMES = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

export default function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<'conservative' | 'standard' | 'optimistic'>('standard');

  useEffect(() => {
    fetchProperty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.id]);

  async function fetchProperty() {
    try {
      const res = await fetch(`/api/properties/${resolvedParams.id}`);
      const data = await res.json();
      if (data.success) {
        setProperty(data.data);
      } else {
        setError(data.error || '物件の取得に失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch property:', err);
      setError('物件の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  async function runEstimate() {
    if (!property) return;

    setEstimating(true);
    setError(null);

    try {
      const costProfile = property.cost_profiles[0];
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: property.id,
          address: property.address_text,
          capacity: property.capacity,
          layoutText: property.layout_text,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          cost: costProfile ? {
            otaFeeRate: costProfile.ota_fee_rate,
            cleaningCostPerTurnover: costProfile.cleaning_cost_per_turnover,
            linenCostPerTurnover: costProfile.linen_cost_per_turnover,
            consumablesCostPerNight: costProfile.consumables_cost_per_night,
            utilitiesCostPerMonth: costProfile.utilities_cost_per_month,
            managementFeeRate: costProfile.management_fee_rate,
            avgStayNights: costProfile.avg_stay_nights,
            otherFixedCostPerMonth: costProfile.other_fixed_cost_per_month,
          } : {
            otaFeeRate: 0.15,
            cleaningCostPerTurnover: 12000,
            linenCostPerTurnover: 2500,
            consumablesCostPerNight: 300,
            utilitiesCostPerMonth: 8000,
            managementFeeRate: 0,
            avgStayNights: 2.0,
            otherFixedCostPerMonth: 0,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        await fetchProperty();
      } else {
        setError(data.error || '見積もりに失敗しました');
      }
    } catch (err) {
      console.error('Estimate failed:', err);
      setError('見積もりの実行に失敗しました');
    } finally {
      setEstimating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="gradient-header snow-pattern text-white">
          <div className="container mx-auto px-4 py-6">
            <Skeleton className="h-4 w-24 bg-white/20 mb-4" />
            <Skeleton className="h-8 w-64 bg-white/20" />
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <div className="grid gap-6 md:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </main>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">物件が見つかりません</h2>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Link href="/">
              <Button>物件一覧に戻る</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const estimate = property.latest_estimate;
  const computed = estimate?.computed as {
    conservative: { monthly: MonthlyEstimate[]; annual: AnnualEstimate };
    standard: { monthly: MonthlyEstimate[]; annual: AnnualEstimate };
    optimistic: { monthly: MonthlyEstimate[]; annual: AnnualEstimate };
  } | null;
  const nearestStation = estimate?.nearest_station as { name: string; distance_m: number } | null;

  const currentRange = computed?.[selectedRange];

  return (
    <div className="min-h-screen bg-background">
      {/* ヘッダー */}
      <header className="gradient-header snow-pattern text-white">
        <div className="container mx-auto px-4 py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white text-sm mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            物件一覧に戻る
          </Link>
          <div className="flex items-center gap-3">
            <Building2 className="h-7 w-7" />
            <h1 className="text-xl font-bold">{property.name}</h1>
          </div>
          <div className="flex items-center gap-2 mt-2 text-white/80 text-sm">
            <MapPin className="h-4 w-4" />
            <span>{property.address_text}</span>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* エラー表示 */}
        {error && (
          <Card className="border-destructive bg-destructive/5 mb-6">
            <CardContent className="py-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* 物件サマリー */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">間取り</p>
              <p className="text-xl font-semibold">{property.layout_text}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">定員</p>
              <p className="text-xl font-semibold">{property.capacity}名</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">緯度経度</p>
              <p className="text-lg font-medium">
                {property.lat && property.lng
                  ? `${property.lat.toFixed(4)}, ${property.lng.toFixed(4)}`
                  : '未取得'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Train className="h-4 w-4" />
                <span>最寄駅</span>
              </div>
              <p className="text-lg font-medium">
                {nearestStation
                  ? `${nearestStation.name} (${formatDistance(nearestStation.distance_m)})`
                  : '未取得'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 見積もり結果 */}
        {!estimate || estimate.status !== 'ok' ? (
          <Card>
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">見積もり結果がありません</h3>
              <p className="text-sm text-muted-foreground mb-4">
                売上見積もりを実行して収益シミュレーションを確認しましょう
              </p>
              <Button onClick={runEstimate} disabled={estimating} className="gap-2">
                {estimating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    見積もり中...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    見積もりを実行
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* レンジ選択 */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold">売上見積もり結果</h2>
                <p className="text-sm text-muted-foreground">
                  AirDNA Rentalizerベースの年間収益シミュレーション
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runEstimate}
                  disabled={estimating}
                  className="gap-1"
                >
                  {estimating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  再計算
                </Button>
              </div>
            </div>

            <Tabs value={selectedRange} onValueChange={(v) => setSelectedRange(v as typeof selectedRange)}>
              <TabsList className="mb-6">
                <TabsTrigger value="conservative" className="gap-1">
                  <TrendingDown className="h-3 w-3" />
                  保守的
                </TabsTrigger>
                <TabsTrigger value="standard">標準</TabsTrigger>
                <TabsTrigger value="optimistic" className="gap-1">
                  <TrendingUp className="h-3 w-3" />
                  強気
                </TabsTrigger>
              </TabsList>

              <TabsContent value={selectedRange}>
                {currentRange && (
                  <>
                    {/* 年次サマリー */}
                    <div className="grid gap-4 md:grid-cols-4 mb-8">
                      <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="py-4">
                          <p className="text-sm text-muted-foreground">年間総売上</p>
                          <p className="text-2xl font-bold text-primary">
                            {formatCurrency(currentRange.annual.gross_revenue)}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-destructive/5 border-destructive/20">
                        <CardContent className="py-4">
                          <p className="text-sm text-muted-foreground">年間総費用</p>
                          <p className="text-2xl font-bold text-destructive">
                            {formatCurrency(currentRange.annual.total_cost)}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-green-50 border-green-200">
                        <CardContent className="py-4">
                          <p className="text-sm text-muted-foreground">年間ネット収益</p>
                          <p className="text-2xl font-bold text-green-600">
                            {formatCurrency(currentRange.annual.net_revenue)}
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="py-4">
                          <p className="text-sm text-muted-foreground">平均稼働率</p>
                          <p className="text-2xl font-bold">
                            {formatPercent(currentRange.annual.avg_occupancy)}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* 月次テーブル */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">月次明細</CardTitle>
                        <CardDescription>
                          月ごとの売上・費用・ネット収益の内訳
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>月</TableHead>
                                <TableHead className="text-right">総売上</TableHead>
                                <TableHead className="text-right">ADR</TableHead>
                                <TableHead className="text-right">稼働率</TableHead>
                                <TableHead className="text-right">稼働日数</TableHead>
                                <TableHead className="text-right">ターンオーバー</TableHead>
                                <TableHead className="text-right">OTA手数料</TableHead>
                                <TableHead className="text-right">清掃＋リネン</TableHead>
                                <TableHead className="text-right">その他費用</TableHead>
                                <TableHead className="text-right font-semibold">ネット収益</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {currentRange.monthly.map((m) => (
                                <TableRow key={m.month}>
                                  <TableCell className="font-medium">
                                    {MONTH_NAMES[m.month - 1]}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(m.gross_revenue)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(m.adr)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatPercent(m.occupancy_rate)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.occupied_nights.toFixed(1)}日
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.turnovers.toFixed(1)}回
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {formatCurrency(m.ota_fee + m.management_fee)}
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {formatCurrency(m.cleaning_cost + m.linen_cost)}
                                  </TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {formatCurrency(m.consumables_cost + m.fixed_cost)}
                                  </TableCell>
                                  <TableCell className={`text-right font-semibold ${m.net_revenue >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                                    {formatCurrency(m.net_revenue)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}

        {/* 費用パラメータ表示 */}
        <Separator className="my-8" />
        
        <Card>
          <CardHeader>
            <CardTitle className="text-base">費用パラメータ設定</CardTitle>
            <CardDescription>
              この物件に設定されている費用パラメータ
            </CardDescription>
          </CardHeader>
          <CardContent>
            {property.cost_profiles[0] ? (
              <div className="grid gap-4 md:grid-cols-4 text-sm">
                <div>
                  <p className="text-muted-foreground">OTA手数料率</p>
                  <p className="font-medium">{(property.cost_profiles[0].ota_fee_rate * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">清掃費/回</p>
                  <p className="font-medium">{formatCurrency(property.cost_profiles[0].cleaning_cost_per_turnover)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">リネン費/回</p>
                  <p className="font-medium">{formatCurrency(property.cost_profiles[0].linen_cost_per_turnover)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">平均連泊数</p>
                  <p className="font-medium">{property.cost_profiles[0].avg_stay_nights}日</p>
                </div>
                <div>
                  <p className="text-muted-foreground">運営代行率</p>
                  <p className="font-medium">{(property.cost_profiles[0].management_fee_rate * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">消耗品費/泊</p>
                  <p className="font-medium">{formatCurrency(property.cost_profiles[0].consumables_cost_per_night)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">光熱通信費/月</p>
                  <p className="font-medium">{formatCurrency(property.cost_profiles[0].utilities_cost_per_month)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">その他固定費/月</p>
                  <p className="font-medium">{formatCurrency(property.cost_profiles[0].other_fixed_cost_per_month)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">費用パラメータが設定されていません</p>
            )}
          </CardContent>
        </Card>
      </main>

      {/* フッター */}
      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-6">
          <p className="text-sm text-muted-foreground text-center">
            © 2024 北海道民泊売上見積ツール - AirDNA Rentalizer連携
          </p>
        </div>
      </footer>
    </div>
  );
}

