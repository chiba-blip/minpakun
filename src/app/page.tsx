'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Building2, 
  TrendingUp, 
  Clock, 
  Loader2,
  Play,
  Trash2,
  Zap,
} from 'lucide-react';

interface DashboardStats {
  totalProperties: number;
  totalListings: number;
  simulatedCount: number;
  matchingCount: number;
  lastScrapeAt: string | null;
}

interface ScrapeProgress {
  id: string;
  site_key: string;
  area_key: string;
  area_name: string;
  current_page: number;
  total_pages: number | null;
  processed_count: number;
  inserted_count: number;
  status: string;
  mode: string;
}

// スクレイプ対象サイト
const SCRAPE_SITES = [
  { key: 'athome', name: 'アットホーム' },
  { key: 'suumo', name: 'SUUMO' },
  { key: 'homes', name: "HOME'S" },
  { key: 'kenbiya', name: '健美家' },
  { key: 'rakumachi', name: '楽待' },
  { key: 'rengotai', name: '北海道不動産連合隊' },
  { key: 'housedo', name: 'ハウスドゥ' },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress[]>([]);

  useEffect(() => {
    fetchStats();
    fetchScrapeProgress();
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch('/api/dashboard/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchScrapeProgress() {
    try {
      const res = await fetch('/api/scrape-progress');
      if (res.ok) {
        const data = await res.json();
        setScrapeProgress(data.progress || []);
      }
    } catch (error) {
      console.error('Failed to fetch scrape progress:', error);
    }
  }

  async function triggerJob(job: 'simulate' | 'notify') {
    setTriggering(job);
    try {
      if (job === 'simulate') {
        // 大量処理前提: サーバレス制限のためページングしつつ複数回叩く
        let offset = 0;
        let totalSimulated = 0;
        let loops = 0;
        while (loops < 200) {
          loops++;
          const res = await fetch(`/api/jobs/simulate?offset=${offset}`, { method: 'POST' });
          const contentType = res.headers.get('content-type') || '';
          const rawText = await res.text();
          const parsed =
            contentType.includes('application/json')
              ? (() => {
                  try {
                    return JSON.parse(rawText) as Record<string, unknown>;
                  } catch {
                    return null;
                  }
                })()
              : null;

          if (!res.ok || !parsed) {
            const errorDetail =
              (parsed?.error as string | undefined) ||
              `${res.status} ${res.statusText} / ${rawText.slice(0, 200)}`;
            alert(`simulateの実行に失敗しました: ${errorDetail}`);
            break;
          }

          totalSimulated += (parsed.simulated as number | undefined) || 0;
          const hasMore = (parsed.has_more as boolean | undefined) || false;
          offset = (parsed.next_offset as number | undefined) ?? (offset + 200);

          if (!hasMore) {
            alert(`simulate完了: ${totalSimulated}件`);
            break;
          }
        }
      } else {
        const res = await fetch(`/api/jobs/${job}`, {
          method: 'POST',
        });
        const contentType = res.headers.get('content-type') || '';
        const rawText = await res.text();
        const parsed =
          contentType.includes('application/json')
            ? (() => {
                try {
                  return JSON.parse(rawText) as Record<string, unknown>;
                } catch {
                  return null;
                }
              })()
            : null;

        if (!res.ok) {
          const errorDetail =
            (parsed?.error as string | undefined) ||
            (parsed?.message as string | undefined) ||
            `${res.status} ${res.statusText} / ${rawText.slice(0, 200)}`;
          alert(`${job}の実行に失敗しました: ${errorDetail}`);
        } else {
          const message = (parsed?.message as string | undefined) || '';
          if (message) alert(message);
        }
      }

      await fetchStats();
    } catch (error) {
      console.error(`Failed to trigger ${job}:`, error);
      alert(`${job}の実行に失敗しました: ${error}`);
    } finally {
      setTriggering(null);
    }
  }

  async function scrapeFromSite(siteKey: string, siteName: string) {
    setTriggering(`scrape-${siteKey}`);
    try {
      const res = await fetch(`/api/jobs/scrape?site=${siteKey}`, {
        method: 'POST',
      });
      const result = await res.json();
      
      if (result.message) {
        alert(result.message);
      } else if (result.error) {
        alert(`${siteName}の取得に失敗: ${result.error}`);
      }
      
      await fetchStats();
    } catch (error) {
      console.error(`Failed to scrape ${siteKey}:`, error);
      alert(`${siteName}の取得に失敗しました`);
    } finally {
      setTriggering(null);
    }
  }

  async function deleteAllData() {
    if (!confirm('本当に全ての物件データを削除しますか？この操作は取り消せません。')) {
      return;
    }
    
    setTriggering('delete');
    try {
      const res = await fetch('/api/jobs/delete-all', {
        method: 'POST',
      });
      const result = await res.json();
      
      if (result.success) {
        alert('全物件データを削除しました');
      } else {
        alert('削除に失敗しました: ' + (result.error || '不明なエラー'));
      }
      
      await fetchStats();
    } catch (error) {
      console.error('Failed to delete all:', error);
      alert('削除に失敗しました');
    } finally {
      setTriggering(null);
    }
  }

  async function deleteAllSimulations() {
    if (!confirm('全てのシミュレーション結果を削除しますか？物件データは残ります。')) {
      return;
    }
    
    setTriggering('delete-sim');
    try {
      const res = await fetch('/api/jobs/delete-simulations', {
        method: 'POST',
      });
      const result = await res.json();
      
      if (result.success) {
        alert(`${result.deleted}件のシミュレーションを削除しました`);
      } else {
        alert('削除に失敗しました: ' + (result.error || '不明なエラー'));
      }
      
      await fetchStats();
    } catch (error) {
      console.error('Failed to delete simulations:', error);
      alert('削除に失敗しました');
    } finally {
      setTriggering(null);
    }
  }

  async function scrapeBatch(siteKey: string, siteName: string, mode: 'initial' | 'incremental' = 'initial', reset: boolean = false) {
    setTriggering(`batch-${siteKey}`);
    try {
      const params = new URLSearchParams({ site: siteKey, mode });
      if (reset) params.set('reset', 'true');
      
      const res = await fetch(`/api/jobs/scrape-batch?${params.toString()}`, {
        method: 'POST',
      });
      
      const result = await res.json();
      if (result.error) {
        alert(`${siteName}の取得に失敗: ${result.error}`);
      } else {
        const status = result.completed ? '（全エリア完了）' : '（継続中）';
        alert(`${siteName}: ${result.total_inserted || 0}件取得、${result.total_skipped || 0}件スキップ ${status}\n\n処理エリア: ${result.areas_processed?.join(', ') || 'なし'}`);
      }
      
      await fetchStats();
      await fetchScrapeProgress();
    } catch (error) {
      console.error(`Failed to batch scrape ${siteKey}:`, error);
      alert(`${siteName}の取得に失敗しました`);
    } finally {
      setTriggering(null);
    }
  }

  async function resetScrapeProgress(siteKey: string) {
    if (!confirm(`${siteKey}のスクレイプ進捗をリセットしますか？最初から取得し直します。`)) {
      return;
    }
    await scrapeBatch(siteKey, 'アットホーム', 'initial', true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">ダッシュボード</h1>
        <p className="text-gray-600 mt-1">
          民泊投資物件分析の概要
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              総物件数
            </CardTitle>
            <Building2 className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalProperties ?? 0}
            </div>
            <p className="text-xs text-gray-500">
              {stats?.totalListings ?? 0} 件の掲載情報
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              シミュレーション済み
            </CardTitle>
            <TrendingUp className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.simulatedCount ?? 0}
            </div>
            <p className="text-xs text-gray-500">
              3シナリオ計算完了
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">
              最終取得
            </CardTitle>
            <Clock className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {stats?.lastScrapeAt 
                ? new Date(stats.lastScrapeAt).toLocaleString('ja-JP')
                : '未実行'
              }
            </div>
          </CardContent>
        </Card>
      </div>

      {/* バッチスクレイピング */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-600" />
            バッチスクレイピング（自動実行中）
          </CardTitle>
          <CardDescription>
            毎時自動実行。手動でも実行可能です。全エリア完了後は週1回の差分更新に切り替わります。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 進捗表示 */}
          {scrapeProgress.length > 0 && (
            <div className="bg-white rounded-lg p-3 border">
              <h4 className="text-sm font-medium mb-2">アットホーム進捗</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {scrapeProgress.map((p) => (
                  <div 
                    key={p.id} 
                    className={`p-2 rounded ${
                      p.status === 'completed' ? 'bg-green-50 text-green-700' :
                      p.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                      p.status === 'error' ? 'bg-red-50 text-red-700' :
                      'bg-gray-50 text-gray-700'
                    }`}
                  >
                    <div className="font-medium">{p.area_name}</div>
                    <div>
                      {p.status === 'completed' ? '✓ 完了' :
                       p.status === 'in_progress' ? `📄 ${p.current_page}ページ目` :
                       p.status === 'error' ? '❌ エラー' :
                       '⏳ 待機中'}
                    </div>
                    <div className="text-gray-500">{p.inserted_count}件取得</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-gray-500">
                合計: {scrapeProgress.reduce((sum, p) => sum + p.inserted_count, 0)}件取得済み
              </div>
            </div>
          )}

          {/* 手動実行ボタン */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => scrapeBatch('athome', 'アットホーム', 'initial')}
              disabled={!!triggering}
              variant="default"
              size="sm"
            >
              {triggering === 'batch-athome' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              アットホーム（続きから）
            </Button>
            <Button
              onClick={() => scrapeBatch('athome', 'アットホーム', 'incremental')}
              disabled={!!triggering}
              variant="outline"
              size="sm"
            >
              {triggering === 'batch-athome' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              新着のみ取得
            </Button>
            <Button
              onClick={() => resetScrapeProgress('athome')}
              disabled={!!triggering}
              variant="outline"
              size="sm"
              className="text-orange-600 border-orange-300 hover:bg-orange-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              進捗リセット
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            ※ 「続きから」: 前回の続きからスクレイプ。「新着のみ」: 既存物件が連続したら終了。「進捗リセット」: 最初からやり直し。
          </p>
        </CardContent>
      </Card>

      {/* スクレイプ（サイト別・少量） */}
      <Card>
        <CardHeader>
          <CardTitle>クイックスクレイプ</CardTitle>
          <CardDescription>
            各サイトから5件ずつ物件を取得（テスト用）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SCRAPE_SITES.map((site) => (
              <Button
                key={site.key}
                onClick={() => scrapeFromSite(site.key, site.name)}
                disabled={!!triggering}
                variant="outline"
                size="sm"
              >
                {triggering === `scrape-${site.key}` ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {site.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* その他の操作 */}
      <Card>
        <CardHeader>
          <CardTitle>その他の操作</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={() => triggerJob('simulate')}
              disabled={!!triggering}
              variant="outline"
            >
              {triggering === 'simulate' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              シミュレーション実行
            </Button>

            <Button
              onClick={() => triggerJob('notify')}
              disabled={!!triggering}
              variant="outline"
            >
              {triggering === 'notify' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              通知チェック実行
            </Button>

            <Button
              onClick={deleteAllSimulations}
              disabled={!!triggering}
              variant="outline"
              className="text-orange-600 border-orange-300 hover:bg-orange-50"
            >
              {triggering === 'delete-sim' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              シミュレーション削除
            </Button>

            <Button
              onClick={deleteAllData}
              disabled={!!triggering}
              variant="destructive"
            >
              {triggering === 'delete' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              全件削除
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
