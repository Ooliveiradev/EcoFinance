'use client';

import React, { useState, useEffect } from 'react';
import {
  Sun,
  Moon,
  Laptop,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Server,
  Bell,
  MapPin,
  Tag,
  LayoutDashboard,
  Shield,
  RefreshCw,
} from 'lucide-react';
import {
  DASHBOARD_CARD_LABELS,
  TRANSACTION_CATEGORY_OPTIONS,
  type ThemePreference,
} from '@ecofinance/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePreferences } from '@/lib/preferences-context';

export function SettingsClient() {
  const {
    preferences,
    resolvedTheme,
    setTheme,
    setFavoriteCategory,
    toggleCardVisibility,
    moveCard,
    resetPreferences,
  } = usePreferences();

  // Real backend connection test state (no fake timeouts)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle');
  const [connectionDetails, setConnectionDetails] = useState<{
    latencyMs?: number;
    version?: string;
    timestamp?: string;
    errorMsg?: string;
  } | null>(null);

  // Browser permissions state
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  const [locationPermission, setLocationPermission] = useState<string>('prompt');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
    if (typeof navigator !== 'undefined' && navigator.permissions) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((perm) => {
          setLocationPermission(perm.state);
          perm.onchange = () => setLocationPermission(perm.state);
        })
        .catch(() => {
          // Permissions API might not support geolocation in some browsers
        });
    }
  }, []);

  const handleRequestNotification = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const result = await Notification.requestPermission();
        setNotificationPermission(result);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleRequestLocation = () => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => setLocationPermission('granted'),
        () => setLocationPermission('denied'),
      );
    }
  };

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setConnectionDetails(null);
    const startTime = performance.now();

    try {
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
      });

      const latencyMs = Math.round(performance.now() - startTime);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      setConnectionStatus('success');
      setConnectionDetails({
        latencyMs,
        version: data.version ?? '1.0.0',
        timestamp: data.timestamp ?? new Date().toISOString(),
      });
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startTime);
      setConnectionStatus('error');
      setConnectionDetails({
        latencyMs,
        errorMsg: err instanceof Error ? err.message : 'Falha na resposta do servidor',
      });
    }
  };

  const themeOptions: Array<{ id: ThemePreference; label: string; icon: React.ElementType }> = [
    { id: 'system', label: 'Automático (Sistema)', icon: Laptop },
    { id: 'light', label: 'Claro', icon: Sun },
    { id: 'dark', label: 'Escuro', icon: Moon },
  ];

  return (
    <div className="space-y-8 max-w-4xl mx-auto animate-fade-in pb-12">
      {/* Header */}
      <header className="pb-2 border-b border-border">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          Configurações
        </h1>
        <p className="mt-1 text-sm text-muted">
          Personalize aparência, organização dos cartões e preferências do sistema
        </p>
      </header>

      {/* 1. Appearance / Theme */}
      <section aria-labelledby="theme-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <Sun className="w-5 h-5 text-primary" />
          <h2 id="theme-heading" className="text-lg font-bold text-foreground">
            Aparência e Tema
          </h2>
        </div>

        <Card>
          <CardContent className="p-6">
            <p className="text-xs text-muted mb-4">
              Escolha o esquema de cores da aplicação. No modo automático, o tema acompanha as
              preferências do seu sistema operacional.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {themeOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = preferences.theme === opt.id;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    className={cn(
                      'p-4 rounded-xl border flex flex-col items-center gap-2 text-center transition-all cursor-pointer touch-target',
                      isSelected
                        ? 'border-primary bg-primary/10 text-foreground font-semibold shadow-xs ring-2 ring-primary/30'
                        : 'border-border bg-surface text-muted hover:border-primary/40 hover:text-foreground',
                    )}
                    aria-pressed={isSelected}
                  >
                    <Icon className={cn('w-5 h-5', isSelected ? 'text-primary' : 'text-muted')} />
                    <span className="text-sm">{opt.label}</span>
                    {isSelected && (
                      <Badge variant="outline" className="text-[10px] mt-1 bg-primary/20 text-primary border-primary/30">
                        Ativo {opt.id === 'system' ? `(${resolvedTheme})` : ''}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 2. Dashboard Cards Order & Visibility */}
      <section aria-labelledby="dashboard-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-primary" />
            <h2 id="dashboard-heading" className="text-lg font-bold text-foreground">
              Cartões do Dashboard (Meu mês)
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetPreferences}
            className="text-xs text-muted hover:text-foreground self-start sm:self-auto touch-target"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Restaurar ordem padrão
          </Button>
        </div>

        <Card>
          <CardContent className="p-6">
            <p className="text-xs text-muted mb-4">
              Defina a ordem e a visibilidade dos blocos na tela inicial. Use as setas para subir
              ou descer cartões e o ícone de visibilidade para ocultar o que não desejar ver.
            </p>

            <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
              {preferences.dashboardCards.map((card, idx) => {
                const label = DASHBOARD_CARD_LABELS[card.id] ?? card.id;
                const isFirst = idx === 0;
                const isLast = idx === preferences.dashboardCards.length - 1;

                return (
                  <div
                    key={card.id}
                    className={cn(
                      'p-4 flex items-center justify-between gap-4 transition-colors',
                      card.visible ? 'bg-surface' : 'bg-surface-muted/50 opacity-60',
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono text-muted w-5 text-center">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{label}</p>
                        <p className="text-xs text-muted">
                          {card.visible ? 'Visível no painel' : 'Oculto'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Move Up */}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Mover ${label} para cima`}
                        disabled={isFirst}
                        onClick={() => moveCard(card.id, 'up')}
                        className="h-8 w-8 text-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </Button>

                      {/* Move Down */}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Mover ${label} para baixo`}
                        disabled={isLast}
                        onClick={() => moveCard(card.id, 'down')}
                        className="h-8 w-8 text-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </Button>

                      {/* Toggle Visibility */}
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={card.visible ? `Ocultar ${label}` : `Exibir ${label}`}
                        onClick={() => toggleCardVisibility(card.id)}
                        className={cn(
                          'h-8 px-2.5 text-xs ml-1',
                          card.visible
                            ? 'text-foreground border-border hover:bg-surface-muted'
                            : 'text-muted border-border hover:bg-surface-raised',
                        )}
                      >
                        {card.visible ? (
                          <>
                            <Eye className="w-3.5 h-3.5 mr-1.5 text-success" />
                            Exibido
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3.5 h-3.5 mr-1.5 text-muted" />
                            Oculto
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 3. Favorite Category */}
      <section aria-labelledby="fav-cat-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-primary" />
          <h2 id="fav-cat-heading" className="text-lg font-bold text-foreground">
            Categoria Favorita
          </h2>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
            <p className="text-xs text-muted">
              Selecione uma categoria padrão para pré-seleção ao registrar novos gastos rapidamente.
            </p>

            <div className="max-w-md">
              <select
                id="favorite-category"
                value={preferences.favoriteCategory ?? ''}
                onChange={(e) => setFavoriteCategory(e.target.value ? e.target.value : null)}
                className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-sm text-foreground focus-visible:outline-none cursor-pointer"
              >
                <option value="">Nenhuma (padrão geral)</option>
                {TRANSACTION_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 4. Real Backend Health & Diagnostics */}
      <section aria-labelledby="backend-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          <h2 id="backend-heading" className="text-lg font-bold text-foreground">
            Diagnóstico e Conectividade
          </h2>
        </div>

        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-base font-bold text-foreground">
              Comunicação com o Servidor
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <p className="text-xs text-muted">
              Execute um teste de conectividade em tempo real para verificar a integridade da API,
              tempo de resposta e versão do backend.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
              <Button
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing'}
                size="default"
                className="touch-target"
              >
                {connectionStatus === 'testing' ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Consultando /api/health...
                  </>
                ) : (
                  <>
                    <Server className="w-4 h-4 mr-2" />
                    Testar Conexão Real
                  </>
                )}
              </Button>

              {connectionStatus === 'success' && connectionDetails && (
                <div className="flex items-center gap-2 text-success bg-success-soft px-3 py-2 rounded-xl text-xs font-semibold animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Backend Online (v{connectionDetails.version} • {connectionDetails.latencyMs} ms)
                  </span>
                </div>
              )}

              {connectionStatus === 'error' && connectionDetails && (
                <div className="flex items-center gap-2 text-danger bg-danger-soft px-3 py-2 rounded-xl text-xs font-semibold animate-fade-in">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{connectionDetails.errorMsg}</span>
                </div>
              )}
            </div>

            {connectionDetails?.timestamp && (
              <p className="text-[11px] font-mono text-muted">
                Última checagem: {new Date(connectionDetails.timestamp).toLocaleTimeString('pt-BR')}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 5. Browser Permissions */}
      <section aria-labelledby="permissions-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h2 id="permissions-heading" className="text-lg font-bold text-foreground">
            Permissões do Dispositivo
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Notifications */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-foreground">Notificações</h3>
                  <p className="text-xs text-muted mt-1 mb-3 leading-relaxed">
                    Alertas de novos lançamentos e lembretes de vencimento de contas.
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Status:</span>
                    {notificationPermission === 'granted' ? (
                      <Badge variant="outline" className="bg-success-soft text-success border-success/30">
                        Concedido ✓
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRequestNotification}
                        className="h-8 text-xs touch-target"
                      >
                        Solicitar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Location */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-info-soft text-info flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-foreground">Localização</h3>
                  <p className="text-xs text-muted mt-1 mb-3 leading-relaxed">
                    Associação de estabelecimentos e locais aos gastos no mapa.
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Status:</span>
                    {locationPermission === 'granted' ? (
                      <Badge variant="outline" className="bg-success-soft text-success border-success/30">
                        Concedido ✓
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRequestLocation}
                        className="h-8 text-xs touch-target"
                      >
                        Solicitar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
