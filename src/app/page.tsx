'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, MapPin, TrendingUp, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface Property {
  id: string;
  name: string;
  address_text: string;
  capacity: number;
  layout_text: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export default function HomePage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProperties();
  }, []);

  async function fetchProperties() {
    try {
      const res = await fetch('/api/properties');
      const data = await res.json();
      if (data.success) {
        setProperties(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch properties:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      {/* ヘッダー */}
      <header className="gradient-header snow-pattern text-white">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="h-8 w-8" />
            <h1 className="text-2xl font-bold tracking-tight">
              北海道民泊売上見積ツール
            </h1>
          </div>
          <p className="text-white/80 text-sm">
            AirDNA連携で北海道全域の民泊収益をシミュレーション
          </p>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="container mx-auto px-4 py-8">
        {/* アクションバー */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-semibold text-foreground">物件一覧</h2>
            <p className="text-sm text-muted-foreground mt-1">
              登録済みの物件から売上見積もりを確認できます
            </p>
          </div>
          <Link href="/properties/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              新規物件を登録
            </Button>
          </Link>
        </div>

        {/* 物件リスト */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : properties.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">
                まだ物件が登録されていません
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                新規物件を登録して売上見積もりを始めましょう
              </p>
              <Link href="/properties/new">
                <Button variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" />
                  最初の物件を登録
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {properties.map((property) => (
              <Link key={property.id} href={`/properties/${property.id}`}>
                <Card className="group hover:shadow-lg transition-all duration-200 hover:border-primary/30 cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg group-hover:text-primary transition-colors">
                        {property.name}
                      </CardTitle>
                      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{property.address_text}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">{property.layout_text}</Badge>
                      <Badge variant="outline">定員{property.capacity}名</Badge>
                      {property.lat && property.lng && (
                        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                          <TrendingUp className="h-3 w-3 mr-1" />
                          見積済
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* フッター */}
      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-6">
          <p className="text-sm text-muted-foreground text-center">
            © 2024 北海道民泊売上見積ツール - AirDNA Rentalizer連携
          </p>
        </div>
      </footer>
    </div>
  );
}
