'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw,
  Plus,
  Upload,
  CheckCircle2,
  AlertCircle,
  Clock,
  Landmark,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn, formatBRL, formatDate } from '@/lib/utils';
import dynamic from 'next/dynamic';

const PluggyConnect = dynamic(() => import('react-pluggy-connect').then(m => m.PluggyConnect), { ssr: false });

type DBAccount = {
  id: string;
  name: string;
  type: string;
  balance: string;
  pluggyItemId: string | null;
  pluggyAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const typeColors: Record<string, string> = {
  banco: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  carteira: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

export default function AccountsClient({ initialAccounts }: { initialAccounts: DBAccount[] }) {
  const router = useRouter();
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [isTokenLoading, setIsTokenLoading] = useState(false);

  const totalBalance = initialAccounts.reduce((s, a) => s + Number(a.balance), 0);

  async function handleSync(itemId: string | null) {
    if (!itemId) return;
    setSyncingIds((prev) => new Set(prev).add(itemId));
    try {
      const res = await fetch('/api/pluggy/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function handleAddAccount() {
    setIsTokenLoading(true);
    try {
      const res = await fetch('/api/pluggy/token');
      const data = await res.json();
      if (data.accessToken) {
        setConnectToken(data.accessToken);
      } else {
        alert('Erro ao carregar token do Pluggy. Verifique suas credenciais.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao conectar com o serviço.');
    } finally {
      setIsTokenLoading(false);
    }
  }

  return (
    <div className="space-y-6 relative">
      {connectToken && (
        <PluggyConnect
          connectToken={connectToken}
          includeSandbox={true}
          onSuccess={async (itemData: any) => {
            setConnectToken(null);
            // Sincronizar dados imediatamente
            await handleSync(itemData.item.id);
          }}
          onError={() => setConnectToken(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 sm:text-3xl">Contas</h1>
          <p className="mt-1 text-sm text-slate-400">Gerencie suas contas bancárias vinculadas</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm">
            <Upload className="w-4 h-4 mr-2" />
            Importar OFX
          </Button>
          <Button size="sm" onClick={handleAddAccount} disabled={isTokenLoading}>
            {isTokenLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Vincular Banco (Pluggy)
          </Button>
        </div>
      </div>

      {/* Total Balance */}
      <Card
        className="animate-fade-in-up overflow-hidden relative"
        style={{ animationDelay: '100ms', animationFillMode: 'both' }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-teal-500/5" />
        <CardContent className="p-6 relative">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
              <Landmark className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Saldo Total</p>
              <p className="text-3xl font-bold text-slate-50 tracking-tight">{formatBRL(totalBalance)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {initialAccounts.length === 0 ? (
          <div className="col-span-full py-12 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">
            Nenhuma conta vinculada ainda. Clique em "Vincular Banco" para conectar sua conta via Pluggy.
          </div>
        ) : initialAccounts.map((account, i) => (
          <Card
            key={account.id}
            className="hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-500/5 animate-fade-in-up group"
            style={{ animationDelay: `${(i + 2) * 100}ms`, animationFillMode: 'both' }}
          >
            <CardContent className="p-6 space-y-4">
              {/* Bank Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-slate-800/80 flex items-center justify-center text-xl">
                    🏦
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-50 truncate max-w-[150px]">{account.name}</h3>
                  </div>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                    typeColors[account.type] || 'bg-slate-800 text-slate-400 border-slate-700',
                  )}
                >
                  {account.type}
                </span>
              </div>

              {/* Balance */}
              <div>
                <p className="text-xs text-slate-400 mb-1">Saldo disponível</p>
                <p className="text-2xl font-bold text-slate-50 tracking-tight">{formatBRL(Number(account.balance))}</p>
              </div>

              {/* Sync Status */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-700/30">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <div className="text-xs">
                    <span className="text-emerald-400">Ativa</span>
                    <span className="text-slate-500 ml-1 block mt-0.5">Última att: {formatDate(account.updatedAt.toISOString())}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleSync(account.pluggyItemId)}
                  disabled={syncingIds.has(account.pluggyItemId || '') || !account.pluggyItemId}
                  title="Sincronizar"
                >
                  <RefreshCw
                    className={cn(
                      'w-4 h-4 text-slate-400',
                      syncingIds.has(account.pluggyItemId || '') && 'animate-spin-slow text-emerald-400',
                    )}
                  />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
