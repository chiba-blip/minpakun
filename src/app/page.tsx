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

  useEffect(() => {
    fetchStats();
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

  async function triggerJob(job: 'simulate' | 'notify') {
    setTriggering(job);
    try {
      const res = await fetch(`/api/jobs/${job}`, {
        method: 'POST',
      });
      const result = await res.json();
      
      if (result.message) {
        alert(result.message);
      }
      
      await fetchStats();
    } catch (error) {
      console.error(`Failed to trigger ${job}:`, error);
      alert(`${job}の実行に失敗しました`);
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

  async function scrapeBulk(siteKey: string, siteName: string) {
    setTriggering(`bulk-${siteKey}`);
    try {
      const res = await fetch(`/.netlify/functions/scrape-background?site=${siteKey}`, {
        method: 'POST',
      });
      
      const result = await res.json();
      if (result.success || result.inserted !== undefined) {
        alert(`${siteName}: ${result.inserted || 0}件取得、${result.skipped || 0}件スキップ\n\n全データ取得には複数回実行してください。`);
      } else {
        alert(`${siteName}の取得に失敗: ${result.error || '不明なエラー'}`);
      }
      
      await fetchStats();
    } catch (error) {
      console.error(`Failed to bulk scrape ${siteKey}:`, error);
      alert(`${siteName}の取得に失敗しました`);
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
            バッチスクレイピング
          </CardTitle>
          <CardDescription>
            1回で10件ずつ取得。全データ取得には複数回クリックしてください
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SCRAPE_SITES.map((site) => (
              <Button
                key={`bulk-${site.key}`}
                onClick={() => scrapeBulk(site.key, site.name)}
                disabled={!!triggering}
                variant="default"
                size="sm"
              >
                {triggering === `bulk-${site.key}` ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                {site.name}
              </Button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            ※ Netlify無料プランのため1回10件制限。何度もクリックして全件取得してください
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
