'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Loader2, 
  Plus, 
  Trash2, 
  Search,
  Bell,
  Edit,
  ChevronDown,
  ChevronUp,
  DollarSign,
} from 'lucide-react';
import type { SavedSearch } from '@/types/database';
import {
  HOKKAIDO_AREAS,
  PROPERTY_TYPES,
  PRICE_OPTIONS,
  WALK_MINUTES_OPTIONS,
  BUILT_YEAR_OPTIONS,
  BUILDING_AREA_OPTIONS,
} from '@/lib/constants';

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchSearches();
  }, []);

  async function fetchSearches() {
    try {
      const res = await fetch('/api/saved-searches');
      const data = await res.json();
      setSearches(data);
    } catch (error) {
      console.error('Failed to fetch searches:', error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleEnabled(search: SavedSearch) {
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: search.id, enabled: !search.enabled }),
      });

      if (res.ok) {
        setSearches(prev => 
          prev.map(s => s.id === search.id ? { ...s, enabled: !s.enabled } : s)
        );
      }
    } catch (error) {
      console.error('Failed to toggle search:', error);
    }
  }

  async function deleteSearch(id: string) {
    if (!confirm('この検索条件を削除しますか？')) return;

    try {
      const res = await fetch(`/api/saved-searches?id=${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setSearches(prev => prev.filter(s => s.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete search:', error);
    }
  }

  function formatPrice(value: number | null): string {
    if (!value) return '-';
    if (value >= 100000000) return `${(value / 100000000).toFixed(1)}億円`;
    return `${(value / 10000).toLocaleString()}万円`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">保存した検索条件</h1>
        <p className="text-gray-600 mt-1">
          条件に合う新着物件をSlackに通知します
        </p>
      </div>

      {/* 保存検索一覧 */}
      {searches.length > 0 ? (
        <div className="space-y-4">
          {searches.map((search) => {
            const isExpanded = expandedId === search.id;
            
            return (
              <Card key={search.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Search className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-lg">{search.name}</span>
                        {search.enabled && (
                          <Badge className="bg-green-100 text-green-800">
                            <Bell className="w-3 h-3 mr-1" />
                            通知ON
                          </Badge>
                        )}
                      </div>
                      
                      {/* 概要 */}
                      <div className="text-sm text-gray-600 space-y-1">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <span>倍率: <strong>{search.multiple}倍以下</strong></span>
                          {search.areas && search.areas.length > 0 && (
                            <span>エリア: {search.areas.slice(0, 3).join(', ')}{search.areas.length > 3 ? ` 他${search.areas.length - 3}件` : ''}</span>
                          )}
                          {search.property_types && search.property_types.length > 0 && (
                            <span>タイプ: {search.property_types.join(', ')}</span>
                          )}
                        </div>
                      </div>

                      {/* 詳細表示 */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : search.id)}
                        className="flex items-center gap-1 text-sm text-blue-600 hover:underline mt-2"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        詳細を{isExpanded ? '閉じる' : '見る'}
                      </button>

                      {isExpanded && (
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            <div>
                              <span className="text-gray-500">倍率:</span>{' '}
                              <span className="font-medium">{search.multiple}倍以下</span>
                            </div>
                            <div>
                              <span className="text-gray-500">価格:</span>{' '}
                              <span className="font-medium">
                                {search.price_min || search.price_max 
                                  ? `${formatPrice(search.price_min)} 〜 ${formatPrice(search.price_max)}`
                                  : '指定なし'
                                }
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">駅徒歩:</span>{' '}
                              <span className="font-medium">
                                {search.walk_minutes_max ? `${search.walk_minutes_max}分以内` : '指定なし'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">築年数:</span>{' '}
                              <span className="font-medium">
                                {search.built_year_min ? `${new Date().getFullYear() - search.built_year_min}年以内` : '指定なし'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">建物面積:</span>{' '}
                              <span className="font-medium">
                                {search.building_area_min || search.building_area_max
                                  ? `${search.building_area_min || '-'}㎡ 〜 ${search.building_area_max || '-'}㎡`
                                  : '指定なし'
                                }
                              </span>
                            </div>
                          </div>

                          {search.areas && search.areas.length > 0 && (
                            <div>
                              <span className="text-sm text-gray-500">対象エリア:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {search.areas.map((area) => (
                                  <Badge key={area} variant="secondary" className="text-xs">
                                    {area}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {search.property_types && search.property_types.length > 0 && (
                            <div>
                              <span className="text-sm text-gray-500">物件タイプ:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {search.property_types.map((type) => (
                                  <Badge key={type} variant="secondary" className="text-xs">
                                    {type}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-2 border-t">
                            <div className="flex items-center gap-1 text-sm text-gray-500 mb-2">
                              <DollarSign className="w-4 h-4" />
                              コスト設定
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                              <div>清掃費: {search.cleaning_fee_per_reservation?.toLocaleString() || 10000}円/回</div>
                              <div>OTA手数料: {search.ota_fee_rate || 15}%</div>
                              <div>運営代行: {search.management_fee_rate || 20}%</div>
                              <div>その他: {search.other_cost_rate || 5}%</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 ml-4">
                      <Switch
                        checked={search.enabled}
                        onCheckedChange={() => toggleEnabled(search)}
                      />
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => deleteSearch(search.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>保存した検索条件がありません</p>
            <p className="text-sm mt-2">
              物件一覧画面で「この条件を保存する」ボタンから検索条件を保存してください
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-medium text-blue-800 mb-2">検索条件の保存方法</h3>
        <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
          <li>物件一覧画面で検索条件を設定</li>
          <li>「この条件を保存する」ボタンをクリック</li>
          <li>検索条件名を入力して保存</li>
          <li>通知ONにすると条件に合う新着物件がSlackに通知されます</li>
        </ol>
      </div>
    </div>
  );
}
