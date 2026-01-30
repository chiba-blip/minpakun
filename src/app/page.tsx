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
} from 'lucide-react';

interface DashboardStats {
  totalProperties: number;
  totalListings: number;
  simulatedCount: number;
  matchingCount: number;
  lastScrapeAt: string | null;
}

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

  async function triggerJob(job: 'scrape' | 'simulate' | 'notify') {
    setTriggering(job);
    try {
      const res = await fetch(`/api/jobs/${job}`, {
        method: 'POST',
      });
      const result = await res.json();
      
      if (result.message) {
        alert(result.message);
      }
      
      // 完了後に統計を再取得
      await fetchStats();
    } catch (error) {
      console.error(`Failed to trigger ${job}:`, error);
      alert(`${job}の実行に失敗しました`);
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

      {/* 手動実行ボタン */}
      <Card>
        <CardHeader>
          <CardTitle>手動実行</CardTitle>
          <CardDescription>
            各ジョブを手動で実行します（通常は自動実行されます）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={() => triggerJob('scrape')}
              disabled={!!triggering}
              variant="outline"
            >
              {triggering === 'scrape' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              スクレイプ実行
            </Button>

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
