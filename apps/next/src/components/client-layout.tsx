'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  MapPin,
  Menu,
  X,
  Bot,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const mainNavItems = [
  { href: '/', label: 'Início', icon: LayoutDashboard },
  { href: '/accounts', label: 'Contas', icon: Wallet },
  { href: '/ai', label: 'Assistente', icon: Bot },
  { href: '/settings', label: 'Opções', icon: Settings },
];

const secondaryNavItems = [
  { href: '/transactions', label: 'Transações', icon: ArrowLeftRight },
  { href: '/map', label: 'Mapa', icon: MapPin },
];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Mobile overlay for sidebar (if needed) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-screen w-64 bg-slate-900/80 backdrop-blur-xl border-r border-slate-800/80 flex flex-col transition-transform duration-300 ease-in-out',
          'hidden lg:flex', // Only visible on desktop
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-slate-800/80">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/25 group-hover:shadow-emerald-500/40 transition-shadow">
              <span className="text-white font-bold text-sm">E</span>
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              EcoFinance
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-8 overflow-y-auto">
          <div>
            <div className="px-3 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Principal
            </div>
            <div className="space-y-1">
              {mainNavItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group',
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-400 shadow-sm shadow-emerald-500/5'
                        : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50',
                    )}
                  >
                    <item.icon
                      className={cn(
                        'w-5 h-5 transition-colors',
                        isActive
                          ? 'text-emerald-400'
                          : 'text-slate-500 group-hover:text-slate-300',
                      )}
                    />
                    {item.label}
                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          <div>
            <div className="px-3 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Explorar
            </div>
            <div className="space-y-1">
              {secondaryNavItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group',
                      isActive
                        ? 'bg-slate-800 text-slate-200'
                        : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50',
                    )}
                  >
                    <item.icon
                      className={cn(
                        'w-5 h-5 transition-colors',
                        isActive
                          ? 'text-slate-300'
                          : 'text-slate-500 group-hover:text-slate-300',
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800/80">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>v1.0.0 • Beta</span>
          </div>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 h-14 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/80 flex items-center px-4 justify-center">
        <span className="text-sm font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
          EcoFinance
        </span>
      </div>

      {/* Main content */}
      <main className="lg:pl-64 min-h-screen pb-20 lg:pb-0">
        <div className="p-4 sm:p-6 lg:p-8 pt-20 lg:pt-8">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Tabs */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-16 bg-slate-900/90 backdrop-blur-xl border-t border-slate-800/80 flex items-center justify-around px-2 pb-safe">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center w-16 h-full gap-1 transition-colors',
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-300'
              )}
            >
              <item.icon
                className={cn(
                  'w-6 h-6 transition-transform duration-200',
                  isActive ? 'scale-110' : 'scale-100'
                )}
              />
              <span className={cn(
                'text-[10px] font-medium',
                isActive ? 'font-semibold' : 'font-medium'
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
