'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { 
  Building2, 
  TrendingUp, 
  Clock, 
  Loader2,
  Play,
  Trash2,
  Zap,
  RefreshCw,
  RotateCcw,
  Info,
} from 'lucide-react';

interface DashboardStats {
  totalProperties: number;
  totalListings: number;
  simulatedCount: number;
  matchingCount: number;
  lastScrapeAt: string | null;
}

interface PortalSiteStat {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  listingsCount: number;
  simulatedCount: number;
  lastScrapedAt: string | null;
}

interface ScrapeProgress {
  site_key: string;
  area_name: string;
  current_page: number;
  processed_count: number;
  inserted_count: number;
  status: string;
  mode: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [portalStats, setPortalStats] = useState<PortalSiteStat[]>([]);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    await Promise.all([fetchStats(), fetchPortalStats(), fetchScrapeProgress()]);
    setLoading(false);
  }

  async function fetchStats() {
    try {
      const res = await fetch('/api/dashboard/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }

  async function fetchPortalStats() {
    try {
      const res = await fetch('/api/portal-sites/stats');
      if (res.ok) {
        const data = await res.json();
        setPortalStats(data.sites || []);
      }
    } catch (error) {
      console.error('Failed to fetch portal stats:', error);
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

  async function toggleSite(siteKey: string, enabled: boolean) {
    try {
      await fetch(`/api/portal-sites/${siteKey}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await fetchPortalStats();
    } catch (error) {
      console.error('Failed to toggle site:', error);
    }
  }

  // バッチスクレイピング（Background Function - 最大15分実行）
  async function scrapeBatch(siteKey: string, siteName: string) {
    setTriggering(`scrape-${siteKey}`);
    
    try {
      // Background Functionを呼び出し（即座に202が返る）
      const res = await fetch(`/.netlify/functions/scrape-background?site=${siteKey}&mode=initial`, { 
        method: 'POST' 
      });
      
      console.log('Background function response:', res.status, res.statusText);
      
      if (!res.ok && res.status !== 202) {
        let errorDetail = `Status: ${res.status} ${res.statusText}`;
        try {
          const text = await res.text();
          errorDetail += `\n${text.substring(0, 500)}`;
        } catch {
          // ignore
        }
        alert(`${siteName}の開始に失敗:\n${errorDetail}`);
        setTriggering(null);
        return;
      }
      
      alert(`${siteName}のバックグラウンド取得を開始しました。\n\n最大15分間実行されます。\n進捗は画面に自動表示されます。`);
      
      // 進捗をポーリングで監視（最大15分 + バッファ）
      const maxPolls = 180; // 5秒 × 180 = 15分
      let polls = 0;
      let lastInserted = 0;
      
      while (polls < maxPolls) {
        polls++;
        await new Promise(r => setTimeout(r, 5000)); // 5秒待機
        
        await fetchScrapeProgress();
        await fetchPortalStats();
        
        // 進捗を確認
        const progress = scrapeProgress.filter(p => p.site_key === siteKey);
        const allCompleted = progress.length > 0 && progress.every(p => p.status === 'completed');
        const totalInserted = progress.reduce((sum, p) => sum + p.inserted_count, 0);
        
        // 完了チェック
        if (allCompleted) {
          alert(`${siteName} 全エリア完了！\n\n取得: ${totalInserted}件`);
          break;
        }
        
        // 進捗が5分間変わらなければ終了（スタックしている可能性）
        if (polls % 60 === 0 && totalInserted === lastInserted) {
          alert(`${siteName} 処理が停止している可能性があります。\n\n現在の取得: ${totalInserted}件`);
          break;
        }
        lastInserted = totalInserted;
      }
      
      await fetchAll();
    } catch (error) {
      console.error(`Failed to scrape ${siteKey}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert(`${siteName}の取得に失敗: ${errorMsg}`);
    } finally {
      setTriggering(null);
    }
  }

  // テストスクレイピング（5件のみ）
  async function scrapeTest(siteKey: string, siteName: string) {
    setTriggering(`scrape-test-${siteKey}`);
    try {
      const res = await fetch(`/api/jobs/scrape?site=${siteKey}`, { method: 'POST' });
      
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        alert(`${siteName}の取得に失敗: サーバーエラー`);
        return;
      }
      
      const result = await res.json();
      
      if (result.error) {
        const errorMsg = typeof result.error === 'object' 
          ? JSON.stringify(result.error) 
          : String(result.error);
        alert(`${siteName}の取得に失敗: ${errorMsg}`);
      } else {
        alert(`${siteName}: ${result.inserted || 0}件取得、${result.skipped || 0}件スキップ`);
      }
      
      await fetchAll();
    } catch (error) {
      console.error(`Failed to scrape ${siteKey}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert(`${siteName}の取得に失敗: ${errorMsg}`);
    } finally {
      setTriggering(null);
    }
  }

  // 進捗リセット
  async function resetProgress(siteKey: string, siteName: string) {
    if (!confirm(`${siteName}の取得進捗をリセットしますか？次回は最初から取得します。`)) {
      return;
    }
    
    setTriggering(`reset-${siteKey}`);
    try {
      // Background Functionでリセット
      await fetch(`/.netlify/functions/scrape-background?site=${siteKey}&reset=true`, { method: 'POST' });
      alert(`${siteName}の進捗をリセットしました`);
      await fetchAll();
    } catch (error) {
      console.error('Failed to reset progress:', error);
      alert('リセットに失敗しました');
    } finally {
      setTriggering(null);
    }
  }

  async function deleteListings(siteKey: string, siteName: string) {
    if (!confirm(`${siteName}の物件を全て削除しますか？この操作は取り消せません。`)) {
      return;
    }
    
    setTriggering(`delete-${siteKey}`);
    try {
      const res = await fetch(`/api/portal-sites/${siteKey}/delete-listings`, {
        method: 'POST',
      });
      const result = await res.json();
      
      if (result.success) {
        alert(`${siteName}: ${result.deleted}件の物件を削除しました`);
      } else {
        alert(`削除に失敗: ${result.error}`);
      }
      
      await fetchAll();
    } catch (error) {
      console.error('Failed to delete listings:', error);
      alert('削除に失敗しました');
    } finally {
      setTriggering(null);
    }
  }

  async function deleteSimulations(siteKey: string, siteName: string) {
    if (!confirm(`${siteName}のシミュレーションを全て削除しますか？`)) {
      return;
    }
    
    setTriggering(`delete-sim-${siteKey}`);
    try {
      const res = await fetch(`/api/portal-sites/${siteKey}/delete-simulations`, {
        method: 'POST',
      });
      const result = await res.json();
      
      if (result.success) {
        alert(`${siteName}: ${result.deleted}件のシミュレーションを削除しました`);
      } else {
        alert(`削除に失敗: ${result.error}`);
      }
      
      await fetchAll();
    } catch (error) {
      console.error('Failed to delete simulations:', error);
      alert('削除に失敗しました');
    } finally {
      setTriggering(null);
    }
  }

  async function runSimulation() {
    setTriggering('simulate-all');
    try {
      let offset = 0;
      let totalSimulated = 0;
      let loops = 0;
      
      while (loops < 200) {
        loops++;
        const res = await fetch(`/api/jobs/simulate?offset=${offset}`, { method: 'POST' });
        const result = await res.json();
        
        if (!res.ok || result.error) {
          alert(`シミュレーション失敗: ${result.error || 'エラー'}`);
          break;
        }
        
        totalSimulated += result.simulated || 0;
        
        if (!result.has_more) {
          alert(`シミュレーション完了: ${totalSimulated}件`);
          break;
        }
        
        offset = result.next_offset || (offset + 200);
      }
      
      await fetchAll();
    } catch (error) {
      console.error('Failed to run simulation:', error);
      alert('シミュレーションに失敗しました');
    } finally {
      setTriggering(null);
    }
  }

  // 特定サイトの進捗を取得
  function getSiteProgress(siteKey: string) {
    return scrapeProgress.filter(p => p.site_key === siteKey);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ダッシュボード</h1>
          <p className="text-gray-600 mt-1">民泊投資物件分析の概要</p>
        </div>
        <Button variant="outline" onClick={fetchAll} disabled={!!triggering}>
          <RefreshCw className={`w-4 h-4 mr-2 ${triggering ? 'animate-spin' : ''}`} />
          更新
        </Button>
      </div>

      {/* 自動取得の説明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-medium">バックグラウンド取得について</p>
          <p className="mt-1">
            「スクレイピング」ボタンを押すと、最大15分間バックグラウンドで物件を取得します。
            進捗は自動更新されます。毎時0分に自動実行、完了後は毎週日曜0時に差分取得します。
          </p>
        </div>
      </div>

      {/* 統計カード（各ポータルの合計） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">総物件数</CardTitle>
            <Building2 className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portalStats.reduce((sum, s) => sum + s.listingsCount, 0)}
            </div>
            <p className="text-xs text-gray-500">全ポータルの合計</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">シミュレーション済み</CardTitle>
            <TrendingUp className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portalStats.reduce((sum, s) => sum + s.simulatedCount, 0)}
            </div>
            <p className="text-xs text-gray-500">3シナリオ計算完了</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">最終取得</CardTitle>
            <Clock className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {stats?.lastScrapeAt 
                ? new Date(stats.lastScrapeAt).toLocaleString('ja-JP')
                : '未実行'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 全体操作 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">全体操作</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={runSimulation}
              disabled={!!triggering}
            >
              {triggering === 'simulate-all' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              全体シミュレーション実行
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ポータルサイト管理 */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold">ポータルサイト管理</h2>
        
        {portalStats.map((site) => {
          const progress = getSiteProgress(site.key);
          const completedAreas = progress.filter(p => p.status === 'completed').length;
          const totalAreas = progress.length;
          const inProgress = progress.some(p => p.status === 'in_progress');
          
          return (
            <Card key={site.id} className={!site.enabled ? 'opacity-60' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-3">
                    {site.name}
                    <Switch
                      checked={site.enabled}
                      onCheckedChange={(checked) => toggleSite(site.key, checked)}
                    />
                    <span className="text-sm font-normal text-gray-500">
                      {site.enabled ? 'ON' : 'OFF'}
                    </span>
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 統計情報 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <div className="text-gray-500">物件数</div>
                    <div className="text-xl font-bold">{site.listingsCount}</div>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <div className="text-gray-500">シミュレーション済</div>
                    <div className="text-xl font-bold">{site.simulatedCount}</div>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg col-span-2">
                    <div className="text-gray-500">最終取得</div>
                    <div className="font-medium">
                      {site.lastScrapedAt 
                        ? new Date(site.lastScrapedAt).toLocaleString('ja-JP')
                        : '未取得'}
                    </div>
                  </div>
                </div>

                {/* 進捗表示 */}
                {totalAreas > 0 && (
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">取得進捗</span>
                      <span className="text-sm font-medium">
                        {completedAreas}/{totalAreas} エリア完了
                        {inProgress && <span className="text-blue-600 ml-2">（処理中）</span>}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${totalAreas > 0 ? (completedAreas / totalAreas) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      総取得: {progress.reduce((sum, p) => sum + p.inserted_count, 0)}件
                    </div>
                  </div>
                )}

                {/* 操作ボタン */}
                <div className="flex flex-wrap gap-2">
                  {/* スクレイピングボタン */}
                  <Button
                    onClick={() => scrapeBatch(site.key, site.name)}
                    disabled={!!triggering || !site.enabled}
                    size="sm"
                  >
                    {triggering === `scrape-${site.key}` ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4 mr-1" />
                    )}
                    {totalAreas > 0 && completedAreas < totalAreas ? '続きを取得' : 'スクレイピング'}
                  </Button>

                  <Button
                    onClick={() => scrapeTest(site.key, site.name)}
                    disabled={!!triggering || !site.enabled}
                    variant="outline"
                    size="sm"
                  >
                    {triggering === `scrape-test-${site.key}` ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-1" />
                    )}
                    テスト（5件）
                  </Button>

                  {totalAreas > 0 && (
                    <Button
                      onClick={() => resetProgress(site.key, site.name)}
                      disabled={!!triggering}
                      variant="outline"
                      size="sm"
                    >
                      {triggering === `reset-${site.key}` ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4 mr-1" />
                      )}
                      進捗リセット
                    </Button>
                  )}

                  <Button
                    onClick={() => deleteListings(site.key, site.name)}
                    disabled={!!triggering || site.listingsCount === 0}
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    {triggering === `delete-${site.key}` ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-1" />
                    )}
                    物件削除
                  </Button>

                  <div className="w-px bg-gray-200 mx-1" />

                  {/* シミュレーションボタン */}
                  <Button
                    onClick={() => deleteSimulations(site.key, site.name)}
                    disabled={!!triggering || site.simulatedCount === 0}
                    variant="outline"
                    size="sm"
                    className="text-orange-600 border-orange-200 hover:bg-orange-50"
                  >
                    {triggering === `delete-sim-${site.key}` ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-1" />
                    )}
                    シミュ削除
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
