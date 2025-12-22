'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, Calculator, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { CostInput } from '@/types/property';

interface FormData {
  name: string;
  address: string;
  capacity: string;
  layoutText: string;
  bedrooms: string;
  bathrooms: string;
  description: string;
  cost: {
    otaFeeRate: string;
    cleaningCostPerTurnover: string;
    linenCostPerTurnover: string;
    consumablesCostPerNight: string;
    utilitiesCostPerMonth: string;
    managementFeeRate: string;
    avgStayNights: string;
    otherFixedCostPerMonth: string;
  };
}

const initialFormData: FormData = {
  name: '',
  address: '',
  capacity: '4',
  layoutText: '',
  bedrooms: '1',
  bathrooms: '1',
  description: '',
  cost: {
    otaFeeRate: '15',
    cleaningCostPerTurnover: '12000',
    linenCostPerTurnover: '2500',
    consumablesCostPerNight: '300',
    utilitiesCostPerMonth: '8000',
    managementFeeRate: '0',
    avgStayNights: '2.0',
    otherFixedCostPerMonth: '0',
  },
};

export default function NewPropertyPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const updateCostField = (field: keyof FormData['cost'], value: string) => {
    setFormData((prev) => ({
      ...prev,
      cost: { ...prev.cost, [field]: value },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // バリデーション
      if (!formData.name.trim()) {
        throw new Error('物件名を入力してください');
      }
      if (!formData.address.trim()) {
        throw new Error('住所を入力してください');
      }
      if (!formData.layoutText.trim()) {
        throw new Error('間取りを入力してください');
      }

      // 費用パラメータを数値に変換
      const cost: CostInput = {
        otaFeeRate: parseFloat(formData.cost.otaFeeRate) / 100,
        cleaningCostPerTurnover: parseInt(formData.cost.cleaningCostPerTurnover) || 0,
        linenCostPerTurnover: parseInt(formData.cost.linenCostPerTurnover) || 0,
        consumablesCostPerNight: parseInt(formData.cost.consumablesCostPerNight) || 0,
        utilitiesCostPerMonth: parseInt(formData.cost.utilitiesCostPerMonth) || 0,
        managementFeeRate: parseFloat(formData.cost.managementFeeRate) / 100,
        avgStayNights: parseFloat(formData.cost.avgStayNights) || 2.0,
        otherFixedCostPerMonth: parseInt(formData.cost.otherFixedCostPerMonth) || 0,
      };

      // 1. 物件を作成
      const propertyRes = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          address: formData.address,
          capacity: parseInt(formData.capacity) || 4,
          layoutText: formData.layoutText,
          bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
          bathrooms: formData.bathrooms ? parseFloat(formData.bathrooms) : null,
          description: formData.description || null,
          cost,
        }),
      });

      const propertyData = await propertyRes.json();
      if (!propertyData.success) {
        throw new Error(propertyData.error || '物件の作成に失敗しました');
      }

      const propertyId = propertyData.propertyId;

      // 2. 見積もりを実行
      const estimateRes = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          address: formData.address,
          capacity: parseInt(formData.capacity) || 4,
          layoutText: formData.layoutText,
          bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
          bathrooms: formData.bathrooms ? parseFloat(formData.bathrooms) : null,
          cost,
        }),
      });

      const estimateData = await estimateRes.json();
      if (!estimateData.success) {
        // 見積もり失敗でも物件は作成されているので詳細ページへ
        console.warn('Estimate failed:', estimateData.error);
      }

      // 詳細ページへ遷移
      router.push(`/properties/${propertyId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ヘッダー */}
      <header className="gradient-header snow-pattern text-white">
        <div className="container mx-auto px-4 py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white text-sm mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            物件一覧に戻る
          </Link>
          <div className="flex items-center gap-3">
            <Building2 className="h-7 w-7" />
            <h1 className="text-xl font-bold">新規物件登録</h1>
          </div>
        </div>
      </header>

      {/* フォーム */}
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 基本情報 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">物件情報</CardTitle>
              <CardDescription>
                民泊物件の基本情報を入力してください
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    物件名 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="例：ニセコビュー1号館"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="layoutText">
                    間取り <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="layoutText"
                    value={formData.layoutText}
                    onChange={(e) => updateField('layoutText', e.target.value)}
                    placeholder="例：2LDK"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">
                  住所 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => updateField('address', e.target.value)}
                  placeholder="例：北海道虻田郡倶知安町字山田..."
                />
                <p className="text-xs text-muted-foreground">
                  住所から自動で緯度経度・最寄駅を取得します
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="capacity">
                    定員（名） <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="capacity"
                    type="number"
                    min="1"
                    value={formData.capacity}
                    onChange={(e) => updateField('capacity', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bedrooms">寝室数</Label>
                  <Input
                    id="bedrooms"
                    type="number"
                    min="0"
                    value={formData.bedrooms}
                    onChange={(e) => updateField('bedrooms', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bathrooms">浴室数</Label>
                  <Input
                    id="bathrooms"
                    type="number"
                    min="0"
                    step="0.5"
                    value={formData.bathrooms}
                    onChange={(e) => updateField('bathrooms', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">紹介文（任意）</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  placeholder="物件の特徴やアピールポイント"
                />
              </div>
            </CardContent>
          </Card>

          {/* 費用パラメータ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">費用パラメータ</CardTitle>
              <CardDescription>
                売上見積もりに使用する費用を設定してください
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 必須費用 */}
              <div>
                <h4 className="text-sm font-medium mb-3">OTA・運営費用</h4>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="otaFeeRate">
                      OTA手数料率（%） <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="otaFeeRate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.cost.otaFeeRate}
                      onChange={(e) => updateCostField('otaFeeRate', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Airbnb: 約3-5%、Booking: 約15%
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managementFeeRate">運営代行率（%）</Label>
                    <Input
                      id="managementFeeRate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={formData.cost.managementFeeRate}
                      onChange={(e) => updateCostField('managementFeeRate', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      自主運営なら0%
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* ターンオーバー費用 */}
              <div>
                <h4 className="text-sm font-medium mb-3">ターンオーバー費用（1回あたり）</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="cleaningCostPerTurnover">
                      清掃費（円） <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="cleaningCostPerTurnover"
                      type="number"
                      min="0"
                      step="100"
                      value={formData.cost.cleaningCostPerTurnover}
                      onChange={(e) => updateCostField('cleaningCostPerTurnover', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="linenCostPerTurnover">
                      リネン費（円） <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="linenCostPerTurnover"
                      type="number"
                      min="0"
                      step="100"
                      value={formData.cost.linenCostPerTurnover}
                      onChange={(e) => updateCostField('linenCostPerTurnover', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="avgStayNights">平均連泊数（日）</Label>
                    <Input
                      id="avgStayNights"
                      type="number"
                      min="1"
                      step="0.1"
                      value={formData.cost.avgStayNights}
                      onChange={(e) => updateCostField('avgStayNights', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      ターンオーバー回数の算出に使用
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* その他費用 */}
              <div>
                <h4 className="text-sm font-medium mb-3">その他費用</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="consumablesCostPerNight">消耗品費/泊（円）</Label>
                    <Input
                      id="consumablesCostPerNight"
                      type="number"
                      min="0"
                      step="100"
                      value={formData.cost.consumablesCostPerNight}
                      onChange={(e) => updateCostField('consumablesCostPerNight', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="utilitiesCostPerMonth">光熱通信費/月（円）</Label>
                    <Input
                      id="utilitiesCostPerMonth"
                      type="number"
                      min="0"
                      step="1000"
                      value={formData.cost.utilitiesCostPerMonth}
                      onChange={(e) => updateCostField('utilitiesCostPerMonth', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="otherFixedCostPerMonth">その他固定費/月（円）</Label>
                    <Input
                      id="otherFixedCostPerMonth"
                      type="number"
                      min="0"
                      step="1000"
                      value={formData.cost.otherFixedCostPerMonth}
                      onChange={(e) => updateCostField('otherFixedCostPerMonth', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* エラー表示 */}
          {error && (
            <Card className="border-destructive bg-destructive/5">
              <CardContent className="py-4">
                <p className="text-sm text-destructive">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* 送信ボタン */}
          <div className="flex justify-end gap-3">
            <Link href="/">
              <Button type="button" variant="outline">
                キャンセル
              </Button>
            </Link>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  見積もり中...
                </>
              ) : (
                <>
                  <Calculator className="h-4 w-4" />
                  見積もりを実行
                </>
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

