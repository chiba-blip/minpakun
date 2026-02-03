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

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [portalStats, setPortalStats] = useState<PortalSiteStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    await Promise.all([fetchStats(), fetchPortalStats()]);
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

  async function scrapeSite(siteKey: string, siteName: string, testMode: boolean = false) {
    const actionKey = testMode ? `scrape-test-${siteKey}` : `scrape-${siteKey}`;
    setTriggering(actionKey);
    try {
      const endpoint = testMode 
        ? `/api/jobs/scrape?site=${siteKey}` 
        : `/api/jobs/scrape-batch?site=${siteKey}&mode=initial`;
      
      const res = await fetch(endpoint, { method: 'POST' });
      const result = await res.json();
      
      if (result.error) {
        alert(`${siteName}の取得に失敗: ${result.error}`);
      } else if (testMode) {
        alert(`${siteName}: ${result.inserted || 0}件取得`);
      } else {
        const status = result.completed ? '（全エリア完了）' : '（継続中）';
        alert(`${siteName}: ${result.total_inserted || 0}件取得 ${status}`);
      }
      
      await fetchAll();
    } catch (error) {
      console.error(`Failed to scrape ${siteKey}:`, error);
      alert(`${siteName}の取得に失敗しました`);
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

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">総物件数</CardTitle>
            <Building2 className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalProperties ?? 0}</div>
            <p className="text-xs text-gray-500">{stats?.totalListings ?? 0} 件の掲載情報</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">シミュレーション済み</CardTitle>
            <TrendingUp className="w-4 h-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.simulatedCount ?? 0}</div>
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
        
        {portalStats.map((site) => (
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

              {/* 操作ボタン */}
              <div className="flex flex-wrap gap-2">
                {/* スクレイピングボタン */}
                <Button
                  onClick={() => scrapeSite(site.key, site.name, false)}
                  disabled={!!triggering || !site.enabled}
                  size="sm"
                >
                  {triggering === `scrape-${site.key}` ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 mr-1" />
                  )}
                  スクレイピング
                </Button>

                <Button
                  onClick={() => scrapeSite(site.key, site.name, true)}
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
        ))}
      </div>
    </div>
  );
}
