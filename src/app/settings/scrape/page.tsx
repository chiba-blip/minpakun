'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { Loader2, Filter } from 'lucide-react';
import type { ScrapeConfig } from '@/types/database';
import { HOKKAIDO_AREAS, PROPERTY_TYPES } from '@/lib/constants';

export default function ScrapeSettingsPage() {
  const [config, setConfig] = useState<ScrapeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const res = await fetch('/api/settings/scrape');
      const data = await res.json();
      setConfig(data);
    } catch (error) {
      console.error('Failed to fetch config:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!config) return;
    
    setSaving(true);
    try {
      console.log('Saving config:', config);
      const res = await fetch('/api/settings/scrape', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      
      const result = await res.json();
      console.log('Save response:', result);
      
      if (res.ok && !result.error) {
        setConfig(result);
        alert('設定を保存しました');
      } else {
        alert(`保存に失敗しました: ${result.error || '不明なエラー'}`);
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      alert(`保存に失敗しました: ${error}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!config) {
    return <div>設定を読み込めませんでした</div>;
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">スクレイプ条件設定</h1>
        <p className="text-gray-600 mt-1">
          物件を検索・取得する条件を設定します
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              スクレイプ有効/無効
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">スクレイプを有効にする</div>
                <div className="text-sm text-gray-500">
                  無効にすると定期取得が停止します
                </div>
              </div>
              <Switch
                checked={config.enabled}
                onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>対象エリア</CardTitle>
            <CardDescription>
              検索対象の市区町村を選択します
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MultiSelect
              options={HOKKAIDO_AREAS}
              selected={config.areas || []}
              onChange={(areas) => setConfig({ ...config, areas })}
              placeholder="エリアを選択"
            />
            <p className="text-sm text-gray-500 mt-2">
              現在 {config.areas?.length || 0} エリアが選択されています
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>物件タイプ</CardTitle>
            <CardDescription>
              検索対象の物件タイプを選択します
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MultiSelect
              options={PROPERTY_TYPES}
              selected={config.property_types || []}
              onChange={(types) => setConfig({ ...config, property_types: types })}
              placeholder="物件タイプを選択"
            />
            <p className="text-sm text-gray-500 mt-2">
              現在 {config.property_types?.length || 0} タイプが選択されています
            </p>
          </CardContent>
        </Card>

        <Button onClick={saveConfig} disabled={saving} className="w-full">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              保存中...
            </>
          ) : (
            '設定を保存'
          )}
        </Button>

        <div className="mt-8 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800 mb-2">
            設定が正しく保存されない場合は、下のボタンで重複レコードを削除してください。
          </p>
          <Button 
            variant="destructive" 
            size="sm"
            onClick={async () => {
              if (!confirm('重複した設定レコードを削除しますか？')) return;
              const res = await fetch('/api/debug/scrape-configs', { method: 'DELETE' });
              const result = await res.json();
              alert(`削除完了: ${result.deleted}件\n\nページを再読み込みしてください。`);
              window.location.reload();
            }}
          >
            重複レコードを削除
          </Button>
        </div>
      </div>
    </div>
  );
}
