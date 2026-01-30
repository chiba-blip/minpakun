'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { 
  Loader2, 
  ExternalLink, 
  TrendingUp, 
  Building2,
  Search,
  Save,
  ChevronDown,
  ChevronUp,
  Download,
} from 'lucide-react';
import {
  HOKKAIDO_AREAS,
  PROPERTY_TYPES,
  PRICE_OPTIONS,
  WALK_MINUTES_OPTIONS,
  BUILT_YEAR_OPTIONS,
  BUILDING_AREA_OPTIONS,
} from '@/lib/constants';

interface PropertyItem {
  id: string;
  url: string;
  title: string;
  price: number;
  priceMan: number;
  address: string;
  city: string | null;
  building_area: number | null;
  property_type: string | null;
  annual_revenue: number;
  annual_revenue_man: number;
  annual_profit: number;      // 利益（売上-コスト）
  annual_profit_man: number;
  actual_multiple: number;
  renovation_budget_man: number;
  meets_condition: boolean;
  portal_site: { name: string; key: string };
}

interface PropertyResponse {
  items: PropertyItem[];
  total: number;
  multiple: number;
}

interface SearchCondition {
  multiple: number;
  areas: string[];
  propertyTypes: string[];
  priceMin: string;
  priceMax: string;
  walkMinutesMax: string;
  builtYearMin: string;
  buildingAreaMin: string;
  buildingAreaMax: string;
}

interface CostSettings {
  cleaningFee: number;
  otaFeeRate: number;
  managementFeeRate: number;
  otherCostRate: number;
}

interface ScrapeConfig {
  areas: string[];
  property_types: string[];
}

export default function PropertiesPage() {
  const [data, setData] = useState<PropertyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  // スクレイプ条件（選択肢の制限用）
  const [scrapeConfig, setScrapeConfig] = useState<ScrapeConfig>({
    areas: [],
    property_types: [],
  });

  // 検索条件
  const [condition, setCondition] = useState<SearchCondition>({
    multiple: 7,
    areas: [],
    propertyTypes: [],
    priceMin: '',
    priceMax: '',
    walkMinutesMax: '',
    builtYearMin: '',
    buildingAreaMin: '',
    buildingAreaMax: '',
  });

  // コスト設定
  const [costSettings, setCostSettings] = useState<CostSettings>({
    cleaningFee: 10000,
    otaFeeRate: 15,
    managementFeeRate: 20,
    otherCostRate: 5,
  });

  useEffect(() => {
    fetchScrapeConfig();
  }, []);

  useEffect(() => {
    if (scrapeConfig.areas.length > 0 || scrapeConfig.property_types.length > 0) {
      fetchProperties();
    }
  }, [scrapeConfig]);

  async function fetchScrapeConfig() {
    try {
      const res = await fetch('/api/settings/scrape');
      if (res.ok) {
        const data = await res.json();
        setScrapeConfig({
          areas: data.areas || [],
          property_types: data.property_types || [],
        });
      }
    } catch (error) {
      console.error('Failed to fetch scrape config:', error);
    }
  }

  // スクレイプ条件に基づいてフィルタされた選択肢
  const availableAreas = HOKKAIDO_AREAS.filter(area => 
    scrapeConfig.areas.some(scrapeArea => {
      // 「札幌市」がスクレイプ条件にある場合、札幌市の区も選択可能
      if (scrapeArea === '札幌市' && area.value.startsWith('札幌市')) return true;
      // スクレイプ条件に完全一致
      if (area.value === scrapeArea) return true;
      // 区レベルがスクレイプ条件にある場合、その区を選択可能
      return false;
    })
  );

  const availablePropertyTypes = PROPERTY_TYPES.filter(type =>
    scrapeConfig.property_types.includes(type.value)
  );

  async function fetchProperties() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        multiple: String(condition.multiple),
      });
      if (condition.areas.length > 0) {
        params.set('areas', condition.areas.join(','));
      }
      if (condition.propertyTypes.length > 0) {
        params.set('types', condition.propertyTypes.join(','));
      }
      if (condition.priceMin) params.set('price_min', condition.priceMin);
      if (condition.priceMax) params.set('price_max', condition.priceMax);
      if (condition.walkMinutesMax) params.set('walk_max', condition.walkMinutesMax);
      if (condition.builtYearMin) params.set('built_year_min', condition.builtYearMin);
      if (condition.buildingAreaMin) params.set('area_min', condition.buildingAreaMin);
      if (condition.buildingAreaMax) params.set('area_max', condition.buildingAreaMax);

      const res = await fetch(`/api/properties?${params.toString()}`);
      const result = await res.json();
      setData(result);
    } catch (error) {
      console.error('Failed to fetch properties:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    fetchProperties();
  }

  function downloadCsv() {
    const params = new URLSearchParams({
      multiple: String(condition.multiple),
    });
    if (condition.areas.length > 0) {
      params.set('areas', condition.areas.join(','));
    }
    if (condition.propertyTypes.length > 0) {
      params.set('types', condition.propertyTypes.join(','));
    }
    window.open(`/api/properties/csv?${params.toString()}`, '_blank');
  }

  async function saveSearchCondition() {
    if (!saveName.trim()) return;

    setSaving(true);
    try {
      const body = {
        name: saveName,
        multiple: condition.multiple,
        areas: condition.areas.length > 0 ? condition.areas : null,
        property_types: condition.propertyTypes.length > 0 ? condition.propertyTypes : null,
        price_min: condition.priceMin ? parseInt(condition.priceMin) : null,
        price_max: condition.priceMax ? parseInt(condition.priceMax) : null,
        walk_minutes_max: condition.walkMinutesMax ? parseInt(condition.walkMinutesMax) : null,
        built_year_min: condition.builtYearMin ? parseInt(condition.builtYearMin) : null,
        building_area_min: condition.buildingAreaMin ? parseFloat(condition.buildingAreaMin) : null,
        building_area_max: condition.buildingAreaMax ? parseFloat(condition.buildingAreaMax) : null,
        // コスト設定
        cleaning_fee_per_reservation: costSettings.cleaningFee,
        ota_fee_rate: costSettings.otaFeeRate,
        management_fee_rate: costSettings.managementFeeRate,
        other_cost_rate: costSettings.otherCostRate,
      };

      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setShowSaveModal(false);
        setSaveName('');
        alert('検索条件を保存しました');
      }
    } catch (error) {
      console.error('Failed to save search:', error);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">物件一覧</h1>
        <p className="text-gray-600 mt-1">
          条件に合致する投資物件を表示します
        </p>
      </div>

      {/* 検索条件 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="w-5 h-5" />
            検索条件
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 基本条件 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>倍率（販売価格 ÷ 年間収益）</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.5"
                  min="1"
                  value={condition.multiple}
                  onChange={(e) => setCondition({ ...condition, multiple: parseFloat(e.target.value) || 7 })}
                  className="w-24"
                />
                <span className="text-gray-500">倍以下</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>対象エリア</Label>
              <MultiSelect
                options={availableAreas}
                selected={condition.areas}
                onChange={(areas) => setCondition({ ...condition, areas })}
                placeholder={availableAreas.length > 0 ? "エリアを選択（スクレイプ条件内）" : "スクレイプ条件を先に設定してください"}
              />
              {availableAreas.length === 0 && (
                <p className="text-xs text-orange-600">設定 → スクレイプ条件でエリアを設定してください</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>物件タイプ</Label>
              <MultiSelect
                options={availablePropertyTypes}
                selected={condition.propertyTypes}
                onChange={(types) => setCondition({ ...condition, propertyTypes: types })}
                placeholder={availablePropertyTypes.length > 0 ? "タイプを選択（スクレイプ条件内）" : "スクレイプ条件を先に設定してください"}
              />
              {availablePropertyTypes.length === 0 && (
                <p className="text-xs text-orange-600">設定 → スクレイプ条件で物件タイプを設定してください</p>
              )}
            </div>
          </div>

          {/* 詳細条件トグル */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            詳細条件を{showAdvanced ? '閉じる' : '開く'}
          </button>

          {/* 詳細条件 */}
          {showAdvanced && (
            <div className="space-y-4 pt-4 border-t">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>販売価格（下限）</Label>
                  <Select
                    value={condition.priceMin}
                    onValueChange={(v) => setCondition({ ...condition, priceMin: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="指定なし" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRICE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value || 'none'} value={opt.value || 'none'}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>販売価格（上限）</Label>
                  <Select
                    value={condition.priceMax}
                    onValueChange={(v) => setCondition({ ...condition, priceMax: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="指定なし" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRICE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value || 'none-max'} value={opt.value || 'none'}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>駅徒歩</Label>
                  <Select
                    value={condition.walkMinutesMax}
                    onValueChange={(v) => setCondition({ ...condition, walkMinutesMax: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="指定なし" />
                    </SelectTrigger>
                    <SelectContent>
                      {WALK_MINUTES_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value || 'none-walk'} value={opt.value || 'none'}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>築年数</Label>
                  <Select
                    value={condition.builtYearMin}
                    onValueChange={(v) => setCondition({ ...condition, builtYearMin: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="指定なし" />
                    </SelectTrigger>
                    <SelectContent>
                      {BUILT_YEAR_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value || 'none-built'} value={opt.value || 'none'}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>建物面積（下限）</Label>
                  <Select
                    value={condition.buildingAreaMin}
                    onValueChange={(v) => setCondition({ ...condition, buildingAreaMin: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="指定なし" />
                    </SelectTrigger>
                    <SelectContent>
                      {BUILDING_AREA_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value || 'none-area-min'} value={opt.value || 'none'}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>建物面積（上限）</Label>
                  <Select
                    value={condition.buildingAreaMax}
                    onValueChange={(v) => setCondition({ ...condition, buildingAreaMax: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="指定なし" />
                    </SelectTrigger>
                    <SelectContent>
                      {BUILDING_AREA_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value || 'none-area-max'} value={opt.value || 'none'}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* コスト設定 */}
              <div className="pt-4 border-t">
                <h4 className="font-medium mb-3">コスト設定（シミュレーション用）</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <Label className="text-sm">清掃費/回</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={costSettings.cleaningFee}
                        onChange={(e) => setCostSettings({ ...costSettings, cleaningFee: parseInt(e.target.value) || 0 })}
                        className="w-24"
                      />
                      <span className="text-sm text-gray-500">円</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm">OTA手数料</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.1"
                        value={costSettings.otaFeeRate}
                        onChange={(e) => setCostSettings({ ...costSettings, otaFeeRate: parseFloat(e.target.value) || 0 })}
                        className="w-20"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm">運営代行</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.1"
                        value={costSettings.managementFeeRate}
                        onChange={(e) => setCostSettings({ ...costSettings, managementFeeRate: parseFloat(e.target.value) || 0 })}
                        className="w-20"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm">その他経費</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.1"
                        value={costSettings.otherCostRate}
                        onChange={(e) => setCostSettings({ ...costSettings, otherCostRate: parseFloat(e.target.value) || 0 })}
                        className="w-20"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ボタン */}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSearch}>
              <Search className="w-4 h-4 mr-2" />
              検索
            </Button>
            <Button variant="outline" onClick={() => setShowSaveModal(true)}>
              <Save className="w-4 h-4 mr-2" />
              この条件を保存する
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 条件保存モーダル */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>新規で保存する検索条件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>検索条件名</Label>
                <Input
                  placeholder="例: ニセコ高利回り"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                <p>以下の条件が保存されます:</p>
                <ul className="list-disc list-inside text-xs space-y-0.5">
                  <li>倍率: {condition.multiple}倍以下</li>
                  {condition.areas.length > 0 && <li>エリア: {condition.areas.join(', ')}</li>}
                  {condition.propertyTypes.length > 0 && <li>タイプ: {condition.propertyTypes.join(', ')}</li>}
                  {condition.priceMin && <li>価格下限: {parseInt(condition.priceMin).toLocaleString()}円</li>}
                  {condition.priceMax && <li>価格上限: {parseInt(condition.priceMax).toLocaleString()}円</li>}
                  <li>コスト設定: 清掃費{costSettings.cleaningFee.toLocaleString()}円, OTA{costSettings.otaFeeRate}%, 運営{costSettings.managementFeeRate}%, その他{costSettings.otherCostRate}%</li>
                </ul>
              </div>
              <div className="flex gap-2">
                <Button onClick={saveSearchCondition} disabled={saving || !saveName.trim()}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  保存
                </Button>
                <Button variant="outline" onClick={() => setShowSaveModal(false)}>
                  キャンセル
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 結果 */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : data?.items && data.items.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              検索結果: {data.total}件
            </CardTitle>
            <Button variant="outline" onClick={downloadCsv}>
              <Download className="w-4 h-4 mr-2" />
              CSV出力
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>物件名</TableHead>
                  <TableHead className="text-right">販売価格</TableHead>
                  <TableHead className="text-right">想定売上</TableHead>
                  <TableHead className="text-right">想定利益</TableHead>
                  <TableHead className="text-right">倍率</TableHead>
                  <TableHead className="text-right">リノベ予算</TableHead>
                  <TableHead>所在地</TableHead>
                  <TableHead>面積</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="font-medium max-w-xs truncate">
                          {item.title || '物件名不明'}
                        </div>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                          <ExternalLink className="w-3.5 h-3.5 text-gray-400 hover:text-blue-600" />
                        </a>
                      </div>
                      <Badge variant="outline" className="mt-1">
                        {item.portal_site?.name || '不明'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {item.priceMan.toLocaleString()}万円
                    </TableCell>
                    <TableCell className="text-right text-gray-600">
                      {item.annual_revenue_man.toLocaleString()}万円
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {item.annual_profit_man.toLocaleString()}万円
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge 
                        variant={item.actual_multiple <= 5 ? 'default' : 'secondary'}
                        className={item.actual_multiple <= 5 ? 'bg-blue-600' : ''}
                      >
                        {item.actual_multiple.toFixed(1)}倍
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.renovation_budget_man > 0 ? (
                        <span className="text-blue-600">
                          {item.renovation_budget_man.toLocaleString()}万円
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {item.address || '-'}
                    </TableCell>
                    <TableCell>
                      {item.building_area ? `${item.building_area}㎡` : '-'}
                    </TableCell>
                    <TableCell>
                      <Link href={`/properties/${item.id}`}>
                        <Button variant="outline" size="sm">
                          <TrendingUp className="w-4 h-4 mr-1" />
                          詳細
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>条件に合致する物件がありません</p>
            <p className="text-sm mt-2">
              倍率の条件を緩めるか、スクレイプを実行してください
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
