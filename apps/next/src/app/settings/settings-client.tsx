'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, MapPin, Server, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SettingsClient() {
  const [notificationStatus, setNotificationStatus] = useState<'granted' | 'pending'>('granted');
  const [locationStatus, setLocationStatus] = useState<'granted' | 'pending'>('pending');
  const [apiUrl, setApiUrl] = useState('https://sua-api.com');
  const [apiSecret, setApiSecret] = useState('*******************');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const handleTestConnection = () => {
    setConnectionStatus('testing');
    setTimeout(() => {
      setConnectionStatus('success');
    }, 1500);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-slate-50 sm:text-3xl">Opções</h1>
        <p className="mt-1 text-sm text-slate-400">Gerencie permissões e configurações do sistema</p>
      </div>

      <div className="space-y-8 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        {/* Permissões Section */}
        <div>
          <h2 className="text-lg font-semibold text-slate-200 mb-4 px-1">Permissões (Navegador)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Notificações */}
            <Card className="hover:shadow-xl transition-all duration-300">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                    <Bell className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-200">Notificações</h3>
                    <p className="text-xs text-slate-400 mt-1 mb-3 leading-relaxed">
                      Receba alertas de novas transações e lembretes de contas a pagar.
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs font-medium text-slate-500">Status:</span>
                      {notificationStatus === 'granted' ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                          Concedido ✓
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/20">
                          Pendente
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Localização */}
            <Card className="hover:shadow-xl transition-all duration-300">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-sky-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-200">Localização</h3>
                    <p className="text-xs text-slate-400 mt-1 mb-3 leading-relaxed">
                      Associar compras à sua localização atual para o mapa interativo.
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs font-medium text-slate-500">Status:</span>
                      {locationStatus === 'granted' ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                          Concedido ✓
                        </Badge>
                      ) : (
                        <button
                          onClick={() => setLocationStatus('granted')}
                          className="text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Solicitar Permissão
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Integrações / API Section */}
        <div>
          <h2 className="text-lg font-semibold text-slate-200 mb-4 px-1">Configuração da API</h2>
          <Card className="hover:shadow-xl transition-all duration-300">
            <CardHeader className="pb-3 border-b border-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Server className="w-4 h-4 text-emerald-400" />
                </div>
                <CardTitle className="text-base">Conexão Backend</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">URL da API</label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-shadow"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Chave Secreta</label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/50 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-shadow"
                />
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  onClick={handleTestConnection}
                  disabled={connectionStatus === 'testing'}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connectionStatus === 'testing' ? 'Testando Conexão...' : 'Testar Conexão'}
                </button>
                
                {connectionStatus === 'success' && (
                  <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg animate-fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-semibold">Backend Conectado</span>
                  </div>
                )}

                {connectionStatus === 'error' && (
                  <div className="flex items-center gap-2 text-rose-400 bg-rose-500/10 px-3 py-1.5 rounded-lg animate-fade-in">
                    <XCircle className="w-4 h-4" />
                    <span className="text-xs font-semibold">Falha na Conexão</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
