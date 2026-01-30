'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Loader2, Globe, AlertCircle } from 'lucide-react';
import type { PortalSite } from '@/types/database';

export default function SitesSettingsPage() {
  const [sites, setSites] = useState<PortalSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSites();
  }, []);

  async function fetchSites() {
    try {
      const res = await fetch('/api/settings/sites');
      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error || 'Failed to fetch sites');
        return;
      }
      
      if (Array.isArray(data)) {
        setSites(data);
      } else {
        setError('Invalid response format');
      }
    } catch (error) {
      console.error('Failed to fetch sites:', error);
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function toggleSite(id: string, enabled: boolean) {
    setSaving(id);
    try {
      const res = await fetch('/api/settings/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
      });
      
      if (res.ok) {
        setSites(prev => prev.map(s => s.id === id ? { ...s, enabled } : s));
      }
    } catch (error) {
      console.error('Failed to update site:', error);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">ポータルサイト設定</h1>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">エラーが発生しました</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
            <p className="text-sm text-red-600 mt-2">
              Netlifyの環境変数（SUPABASE_SERVICE_ROLE_KEY）が設定されているか確認してください。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">ポータルサイト設定</h1>
        <p className="text-gray-600 mt-1">
          スクレイピング対象のポータルサイトを管理します
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            対象サイト
          </CardTitle>
          <CardDescription>
            有効にしたサイトから物件情報を取得します
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sites.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              ポータルサイトが登録されていません。<br />
              Supabaseでportal_sitesテーブルにデータを追加してください。
            </p>
          ) : (
            <div className="space-y-4">
              {sites.map((site) => (
                <div
                  key={site.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <div className="font-medium">{site.name}</div>
                    <div className="text-sm text-gray-500">{site.base_url}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {saving === site.id && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                    <Switch
                      checked={site.enabled}
                      onCheckedChange={(checked) => toggleSite(site.id, checked)}
                      disabled={saving === site.id}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">
          <strong>注意:</strong> スクレイピングはサイトの利用規約に従って行ってください。
          過度なアクセスはサーバーに負荷をかける可能性があります。
        </p>
      </div>
    </div>
  );
}
