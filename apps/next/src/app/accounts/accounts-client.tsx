'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  RefreshCw,
  Plus,
  Upload,
  CheckCircle2,
  Landmark,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
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
  banco: 'bg-info-soft text-info border-info/30',
  carteira: 'bg-success-soft text-success border-success/30',
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
      if (!res.ok) throw new Error('Falha ao iniciar conexão bancária');
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
    <div className="space-y-6 relative animate-fade-in">
      {connectToken && (
        <PluggyConnect
          connectToken={connectToken}
          includeSandbox={true}
          onSuccess={async (itemData) => {
            setConnectToken(null);
            await handleSync(itemData.item.id);
          }}
          onError={() => setConnectToken(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl tracking-tight">
            Contas e cartões
          </h1>
          <p className="mt-1 text-sm text-muted">
            Gerencie suas contas bancárias vinculadas, cartões e saldos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/imports"
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'touch-target')}
          >
            <Upload className="w-4 h-4 mr-2" />
            Importar OFX/CSV
          </Link>
          <Button
            size="sm"
            onClick={handleAddAccount}
            disabled={isTokenLoading}
            className="touch-target"
          >
            {isTokenLoading ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Vincular Banco (Pluggy)
          </Button>
        </div>
      </div>

      {/* Total Balance */}
      <Card className="overflow-hidden relative">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Saldo Total Consolidado
              </p>
              <p className="text-3xl font-bold text-foreground tracking-tight">
                {formatBRL(totalBalance)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {initialAccounts.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted bg-surface-muted rounded-2xl border border-border">
            Nenhuma conta vinculada ainda. Clique em "Vincular Banco" para conectar sua conta via Open Finance ou "Importar OFX/CSV" para carregar um extrato.
          </div>
        ) : initialAccounts.map((account, i) => (
          <Card
            key={account.id}
            className="hover:scale-[1.01] hover:shadow-md transition-[transform,box-shadow] group"
            style={{ animationDelay: `${(i + 2) * 80}ms`, animationFillMode: 'both' }}
          >
            <CardContent className="p-6 space-y-4">
              {/* Bank Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-muted flex items-center justify-center text-xl shrink-0">
                    🏦
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground truncate max-w-[150px]">
                      {account.name}
                    </h3>
                  </div>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase',
                    typeColors[account.type] || 'bg-surface-muted text-muted border-border',
                  )}
                >
                  {account.type}
                </span>
              </div>

              {/* Balance */}
              <div>
                <p className="text-xs text-muted mb-1">Saldo disponível</p>
                <p className="text-2xl font-bold text-foreground tracking-tight">
                  {formatBRL(Number(account.balance))}
                </p>
              </div>

              {/* Sync Status */}
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                  <div className="text-xs">
                    <span className="text-success font-semibold">Ativa</span>
                    <span className="text-muted ml-1 inline-block">
                      • {formatDate(account.updatedAt.toISOString())}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted hover:text-foreground"
                  onClick={() => handleSync(account.pluggyItemId)}
                  disabled={syncingIds.has(account.pluggyItemId || '') || !account.pluggyItemId}
                  aria-label={`Sincronizar ${account.name}`}
                >
                  <RefreshCw
                    className={cn(
                      'w-4 h-4',
                      syncingIds.has(account.pluggyItemId || '') && 'animate-spin text-primary',
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
