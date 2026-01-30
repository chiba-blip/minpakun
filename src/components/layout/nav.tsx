'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Home,
  Building2,
  Search,
  Settings,
  Globe,
  Filter,
  Bell,
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'ダッシュボード', icon: Home },
  { href: '/properties', label: '物件一覧', icon: Building2 },
  { href: '/saved-searches', label: '保存した検索条件', icon: Search },
];

const settingsItems = [
  { href: '/settings/sites', label: 'ポータルサイト', icon: Globe },
  { href: '/settings/scrape', label: 'スクレイプ条件', icon: Filter },
  { href: '/settings/slack', label: 'Slack通知', icon: Bell },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="w-64 bg-gray-900 text-white min-h-screen p-4">
      <div className="mb-8">
        <h1 className="text-xl font-bold">みんぱくん</h1>
        <p className="text-gray-400 text-sm">民泊投資分析ツール</p>
      </div>

      <div className="space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-8">
        <div className="flex items-center gap-2 px-3 py-2 text-gray-400 text-sm uppercase">
          <Settings className="w-4 h-4" />
          設定
        </div>
        <div className="space-y-1 mt-2">
          {settingsItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
