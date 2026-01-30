'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Bell, Send, CheckCircle, XCircle } from 'lucide-react';
import type { SlackConfig } from '@/types/database';

export default function SlackSettingsPage() {
  const [config, setConfig] = useState<SlackConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const res = await fetch('/api/settings/slack');
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
      const res = await fetch('/api/settings/slack', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      
      if (res.ok) {
        const updated = await res.json();
        setConfig(updated);
      }
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  }

  async function testWebhook() {
    if (!config?.webhook_url) return;
    
    setTesting(true);
    setTestResult(null);
    
    try {
      const res = await fetch('/api/settings/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: config.webhook_url }),
      });
      
      if (res.ok) {
        setTestResult('success');
      } else {
        setTestResult('error');
      }
    } catch (error) {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const webhookUrl = config?.webhook_url || '';
  const enabled = config?.enabled || false;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Slack通知設定</h1>
        <p className="text-gray-600 mt-1">
          条件に合致する新着物件をSlackに通知します
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              通知設定
            </CardTitle>
            <CardDescription>
              Slack Incoming Webhookを使用して通知を送信します
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Slack通知を有効にする</div>
                <div className="text-sm text-gray-500">
                  保存検索の条件に合う物件が見つかったら通知
                </div>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) =>
                  setConfig(prev => prev ? { ...prev, enabled: checked } : null)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook">Webhook URL</Label>
              <Input
                id="webhook"
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                value={webhookUrl}
                onChange={(e) =>
                  setConfig(prev => prev 
                    ? { ...prev, webhook_url: e.target.value } 
                    : { id: '', enabled: true, webhook_url: e.target.value, created_at: '' }
                  )
                }
              />
              <p className="text-sm text-gray-500">
                Slackのアプリ設定からIncoming Webhookを作成してください
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={testWebhook}
                variant="outline"
                disabled={!webhookUrl || testing}
              >
                {testing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    テスト中...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    テスト送信
                  </>
                )}
              </Button>

              {testResult === 'success' && (
                <div className="flex items-center text-green-600">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  送信成功
                </div>
              )}
              {testResult === 'error' && (
                <div className="flex items-center text-red-600">
                  <XCircle className="w-4 h-4 mr-1" />
                  送信失敗
                </div>
              )}
            </div>
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
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-medium text-blue-800 mb-2">Webhook URLの取得方法</h3>
        <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
          <li>Slack Appを作成（または既存のアプリを使用）</li>
          <li>Incoming Webhooksを有効化</li>
          <li>通知先チャンネルを選択してWebhook URLを生成</li>
          <li>上記フィールドにURLを貼り付け</li>
        </ol>
      </div>
    </div>
  );
}
