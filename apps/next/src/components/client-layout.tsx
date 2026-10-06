'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  ArrowLeftRight,
  Target,
  WalletCards,
  FileSpreadsheet,
  Settings,
  Plus,
  Menu,
  X,
  Sun,
  Moon,
  Laptop,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreferences } from '@/lib/preferences-context';
import { Button } from '@/components/ui/button';
import { AddExpenseModal } from '@/components/add-expense-modal';
import { loadEntryReferences } from '@/lib/finance-client';
import type { EntryReference } from '@/components/entry-dialog';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

// Primary navigation as specified in Issue EF-04
const primaryNavItems: NavItem[] = [
  { href: '/', label: 'Meu mês', icon: CalendarDays, exact: true },
  { href: '/transactions', label: 'Lançamentos', icon: ArrowLeftRight },
  { href: '/planning', label: 'Planejamento', icon: Target },
  { href: '/accounts', label: 'Contas e cartões', icon: WalletCards },
  { href: '/imports', label: 'Importações', icon: FileSpreadsheet },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const { preferences, setTheme, resolvedTheme } = usePreferences();
  const quickRequest=useRef<AbortController|null>(null);
  const [quickData,setQuickData]=useState<{accounts:EntryReference[];categories:EntryReference[]}|null>(null),[quickError,setQuickError]=useState('');
  function closeQuickExpense() {quickRequest.current?.abort();setIsAddExpenseOpen(false);}
  async function openQuickExpense() {
    quickRequest.current?.abort();const controller=new AbortController();quickRequest.current=controller;
    setQuickData(null);setQuickError('');setIsAddExpenseOpen(true);
    try {const data=await loadEntryReferences(controller.signal);if(!controller.signal.aborted)setQuickData(data);}
    catch(error){if(!controller.signal.aborted)setQuickError(error instanceof Error?error.message:'Falha ao carregar.');}
  }

  const isLinkActive = (item: NavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + '/');
  };

  const cycleTheme = () => {
    if (preferences.theme === 'system') setTheme('light');
    else if (preferences.theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  if (pathname === '/login') return <main className="min-h-screen bg-slate-950">{children}</main>;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Accessible skip link for keyboard navigation */}
      <a
        href="#main-content"
        className="sr-only-focusable fixed top-2 left-2 z-50 px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg shadow-md"
      >
        Pular para o conteúdo principal
      </a>

      {/* Mobile Backdrop Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu de navegação"
          className="fixed inset-0 z-40 bg-overlay backdrop-blur-xs lg:hidden transition-opacity cursor-pointer"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside
        id="desktop-sidebar"
        className={cn(
          'fixed top-0 left-0 z-40 h-screen w-64 bg-surface border-r border-border flex flex-col transition-transform duration-200 ease-in-out',
          'hidden lg:flex',
        )}
      >
        {/* Brand / Logo */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-border">
          <Link
            href="/"
            className="flex items-center gap-2.5 group focus-visible:outline-none"
            aria-label="EcoFinance Início"
          >
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground font-black text-sm flex items-center justify-center shadow-xs">
              E
            </div>
            <span className="text-lg font-extrabold tracking-tight text-foreground">
              EcoFinance
            </span>
          </Link>

          {/* Theme Quick Switcher */}
          <Button
            variant="ghost"
            size="icon"
            onClick={cycleTheme}
            aria-label={`Alternar tema (atual: ${preferences.theme})`}
            title={`Tema: ${preferences.theme === 'system' ? 'Automático' : preferences.theme === 'light' ? 'Claro' : 'Escuro'}`}
            className="h-8 w-8 text-muted hover:text-foreground"
          >
            {preferences.theme === 'system' ? (
              <Laptop className="w-4 h-4" />
            ) : resolvedTheme === 'dark' ? (
              <Moon className="w-4 h-4" />
            ) : (
              <Sun className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* Quick Primary Action */}
        <div className="p-4 border-b border-border">
          <Button
            variant="default"
            className="w-full flex items-center justify-center gap-2 py-2.5 h-11 text-sm font-bold shadow-sm"
            onClick={(event) => { event.currentTarget.focus(); void openQuickExpense(); }}
          >
            <Plus className="w-4 h-4" />
            Adicionar gasto
          </Button>
        </div>

        {/* Navigation list */}
        <nav
          aria-label="Navegação Principal"
          className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto"
        >
          <div className="px-3 mb-2 text-[11px] font-bold text-muted uppercase tracking-wider">
            Menu
          </div>
          {primaryNavItems.map((item) => {
            const active = isLinkActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors duration-150',
                  active
                    ? 'bg-nav-active text-nav-active-foreground shadow-xs'
                    : 'text-muted hover:text-foreground hover:bg-surface-muted',
                )}
              >
                <item.icon
                  className={cn('w-4.5 h-4.5 shrink-0', active ? 'text-nav-active-foreground' : 'text-muted')}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer info */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between text-xs text-muted">
          <span>EcoFinance v1.0</span>
          <span className="px-1.5 py-0.5 rounded bg-surface-muted font-mono text-[10px]">
            {resolvedTheme}
          </span>
        </div>
      </aside>

      {/* Mobile Drawer (Accessible off-canvas menu) */}
      <aside
        id="mobile-drawer"
        aria-label="Menu móvel"
        inert={!sidebarOpen}
        aria-hidden={!sidebarOpen}
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 bg-surface border-r border-border flex flex-col transform transition-transform duration-200 ease-in-out lg:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-border">
          <Link
            href="/"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2.5"
          >
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground font-black text-sm flex items-center justify-center">
              E
            </div>
            <span className="text-lg font-extrabold tracking-tight text-foreground">
              EcoFinance
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fechar menu"
            className="h-8 w-8 text-muted"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-4 border-b border-border">
          <Button
            variant="default"
            className="w-full flex items-center justify-center gap-2 py-2.5 h-11 text-sm font-bold shadow-sm"
            onClick={() => {
              setSidebarOpen(false);
              void openQuickExpense();
            }}
          >
            <Plus className="w-4 h-4" />
            Adicionar gasto
          </Button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {primaryNavItems.map((item) => {
            const active = isLinkActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-colors',
                  active
                    ? 'bg-nav-active text-nav-active-foreground shadow-xs'
                    : 'text-muted hover:text-foreground hover:bg-surface-muted',
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted">Tema de exibição:</span>
          <Button
            variant="outline"
            size="sm"
            onClick={cycleTheme}
            className="h-8 text-xs font-semibold gap-1.5"
          >
            {resolvedTheme === 'dark' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            {preferences.theme === 'system' ? 'Auto' : resolvedTheme === 'dark' ? 'Escuro' : 'Claro'}
          </Button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="lg:hidden sticky top-0 z-30 h-14 bg-surface/90 backdrop-blur-md border-b border-border flex items-center justify-between px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(true)}
          aria-label="Abrir menu de navegação"
          className="h-10 w-10 text-foreground"
        >
          <Menu className="w-5 h-5" />
        </Button>

        <Link href="/" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary text-primary-foreground font-black text-xs flex items-center justify-center">
            E
          </div>
          <span className="text-base font-extrabold tracking-tight text-foreground">
            EcoFinance
          </span>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={(event) => { event.currentTarget.focus(); void openQuickExpense(); }}
          aria-label="Adicionar gasto rápido"
          className="h-10 w-10 text-primary"
        >
          <Plus className="w-5 h-5" />
        </Button>
      </header>

      {/* Main Content Area */}
      <main
        id="main-content"
        className="flex-1 lg:pl-64 min-h-screen pb-20 lg:pb-8 flex flex-col"
        tabIndex={-1}
      >
        <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </div>
      </main>

      <BottomNavigation isActive={isLinkActive}/>

      {/* Quick Add Expense Modal */}
      <AddExpenseModal
        isOpen={isAddExpenseOpen}
        onClose={closeQuickExpense}
        loading={!quickData && !quickError}
        error={quickError}
        accounts={quickData?.accounts}
        categories={quickData?.categories}
        onSuccess={() => {
          if (typeof window !== 'undefined') window.location.reload();
        }}
      />
    </div>
  );
}

function BottomNavigation({isActive}:{isActive:(item:NavItem)=>boolean}) {
  return (
      <nav
        aria-label="Navegação inferior mobile"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-surface/95 backdrop-blur-md border-t border-border flex items-center justify-around px-1"
      >
        {primaryNavItems.slice(0, 5).map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full py-1 text-center transition-colors touch-target',
                active ? 'text-primary' : 'text-muted hover:text-foreground',
              )}
            >
              <item.icon className="w-5 h-5 mb-0.5" />
              <span className={cn('text-[10px] truncate max-w-[64px]', active ? 'font-bold' : 'font-medium')}>
                {item.label === 'Contas e cartões' ? 'Contas' : item.label}
              </span>
            </Link>
          );
        })}
      </nav>
  );
}
