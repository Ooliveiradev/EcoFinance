'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Navigation, Info } from 'lucide-react';
import { formatCurrency } from '@ecofinance/shared';

// MOCK DATA for Map View
const MOCK_LOCATIONS = [
  {
    id: '1',
    description: 'Starbucks Paulista',
    amount: -35.5,
    date: '2026-06-24T08:30:00Z',
    category: 'comida',
    latitude: -23.5614,
    longitude: -46.6559,
    source: 'notification'
  },
  {
    id: '2',
    description: 'Posto Ipiranga',
    amount: -150.0,
    date: '2026-06-23T18:45:00Z',
    category: 'transporte',
    latitude: -23.5822,
    longitude: -46.6836,
    source: 'notification'
  },
  {
    id: '3',
    description: 'Pão de Açúcar',
    amount: -245.9,
    date: '2026-06-22T14:20:00Z',
    category: 'moradia',
    latitude: -23.5701,
    longitude: -46.6432,
    source: 'notification'
  },
  {
    id: '4',
    description: 'Restaurante Madero',
    amount: -120.0,
    date: '2026-06-21T20:10:00Z',
    category: 'lazer',
    latitude: -23.5855,
    longitude: -46.6791,
    source: 'notification'
  }
];

export default function MapPage() {
  const [distance, setDistance] = useState(5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-50 tracking-tight">Mapa de Gastos</h1>
          <p className="text-slate-400 mt-1">Visualize onde você está gastando seu dinheiro</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 min-h-[500px] flex flex-col overflow-hidden">
          <CardHeader className="bg-slate-900/40 border-b border-slate-800">
            <CardTitle className="flex items-center gap-2 text-slate-100">
              <MapPin className="h-5 w-5 text-emerald-500" />
              Mapa Geográfico
            </CardTitle>
            <CardDescription>Transações capturadas com geolocalização via GPS</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 p-0 relative bg-slate-950 flex flex-col">
            <div className="flex-1 relative border-4 border-slate-900/50 m-4 rounded-xl overflow-hidden bg-slate-800 flex items-center justify-center">
              <div className="text-center p-6 space-y-4 max-w-md">
                <Navigation className="h-12 w-12 text-slate-500 mx-auto opacity-50" />
                <h3 className="text-xl font-medium text-slate-300">Integração do Mapa</h3>
                <p className="text-slate-400 text-sm">
                  Em produção, este espaço conterá o Leaflet.js para renderização do mapa interativo. 
                  Para este preview, listamos as coordenadas no painel lateral.
                </p>
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-start gap-3 text-left">
                  <Info className="h-5 w-5 shrink-0 mt-0.5" />
                  <p>O App Android captura automaticamente a localização via GPS no momento que a notificação do banco chega.</p>
                </div>
              </div>
            </div>
            
            {/* Mock map pins overlaid on a grid background */}
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              opacity: 0.2
            }} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-slate-100">Filtros</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-slate-300">Raio de Busca</label>
                  <span className="text-sm text-emerald-400 font-medium">{distance} km</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="20" 
                  value={distance} 
                  onChange={(e) => setDistance(parseInt(e.target.value))}
                  className="w-full accent-emerald-500" 
                />
              </div>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="text-slate-100">Locais Recentes</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-800">
                {MOCK_LOCATIONS.map((loc) => (
                  <div key={loc.id} className="p-4 hover:bg-slate-800/50 transition-colors cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-medium text-slate-200 group-hover:text-emerald-400 transition-colors">
                        {loc.description}
                      </div>
                      <div className="text-slate-100 font-medium bg-slate-900 px-2 py-1 rounded">
                        {formatCurrency(loc.amount)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-700">
                        {loc.category}
                      </Badge>
                      <span className="text-slate-500 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
