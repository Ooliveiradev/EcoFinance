'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  HelpCircle,
  FileCheck,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatDate } from '@/lib/utils';

export interface ImportAccount {
  id: string;
  name: string;
  balance: number;
}

export interface ImportBatchItem {
  id: string;
  source: string;
  state: string;
  createdAt: string;
}

export interface ImportsClientProps {
  accounts: ImportAccount[];
  recentBatches: ImportBatchItem[];
  error?: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  accountName: string;
}

export default function ImportsClient({
  accounts,
  recentBatches,
  error: initialError,
}: ImportsClientProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedAccountName, setSelectedAccountName] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
      setResult(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ext = file.name.toLowerCase();
      if (!ext.endsWith('.ofx') && !ext.endsWith('.qfx') && !ext.endsWith('.csv')) {
        setError('Formato não suportado. Por favor, envie um arquivo .ofx, .qfx ou .csv.');
        return;
      }
      setSelectedFile(file);
      setError(null);
      setResult(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Selecione um arquivo para importar.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (selectedAccountName.trim()) {
        formData.append('accountName', selectedAccountName.trim());
      }

      const res = await fetch('/api/transactions/import-ofx', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Falha ao processar arquivo no servidor.');
      }

      setResult({
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        total: data.total ?? 0,
        accountName: data.accountName ?? 'Conta',
      });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na comunicação com o servidor.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            Importações
          </h1>
          <p className="mt-1 text-sm text-muted">
            Importe extratos bancários e arquivos nos formatos OFX, QFX e CSV
          </p>
        </div>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: 'outline', size: 'default' }), 'touch-target')}
        >
          Voltar ao Meu mês
        </Link>
      </header>

      {/* Upload Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold text-foreground">
              Carregar Novo Arquivo
            </CardTitle>
            <p className="text-xs text-muted">
              Selecione o arquivo exportado do seu banco para importar as movimentações
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="p-3 bg-danger-soft text-danger border border-danger/20 rounded-xl text-xs flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {result && (
                <div
                  role="status"
                  className="p-4 bg-success-soft text-success border border-success/20 rounded-xl space-y-2 animate-fade-in"
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span>Importação concluída com sucesso!</span>
                  </div>
                  <p className="text-xs text-foreground">
                    Foram importados <strong>{result.imported}</strong> novos lançamentos na conta{' '}
                    <strong>{result.accountName}</strong>. ({result.skipped} duplicados foram ignorados
                    de um total de {result.total}).
                  </p>
                  <div className="pt-2 flex items-center gap-3">
                    <Link
                      href="/transactions"
                      className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'touch-target')}
                    >
                      Ver Lançamentos
                      <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Link>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setResult(null)}
                      className="touch-target"
                    >
                      Importar outro arquivo
                    </Button>
                  </div>
                </div>
              )}

              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors',
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-surface-muted/50',
                  selectedFile && 'border-success bg-success-soft/30',
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ofx,.qfx,.csv"
                  onChange={handleFileChange}
                  className="sr-only"
                  aria-label="Selecionar arquivo OFX, QFX ou CSV"
                />

                <div className="w-12 h-12 rounded-2xl bg-surface-muted flex items-center justify-center text-primary mb-3">
                  {selectedFile ? (
                    <FileCheck className="w-6 h-6 text-success" />
                  ) : (
                    <Upload className="w-6 h-6" />
                  )}
                </div>

                {selectedFile ? (
                  <div>
                    <p className="text-sm font-bold text-foreground">{selectedFile.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {(selectedFile.size / 1024).toFixed(1)} KB — Clique ou arraste outro para trocar
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Clique para escolher ou arraste o arquivo aqui
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Suporta extratos bancários .OFX, .QFX ou planilhas .CSV
                    </p>
                  </div>
                )}
              </div>

              {/* Destination Account Selection */}
              <div className="space-y-1.5">
                <label
                  htmlFor="import-account"
                  className="text-xs font-semibold text-muted"
                >
                  Conta de destino (opcional)
                </label>
                {accounts.length > 0 ? (
                  <select
                    id="import-account"
                    value={selectedAccountName}
                    onChange={(e) => setSelectedAccountName(e.target.value)}
                    disabled={isUploading}
                    className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-sm text-foreground focus-visible:outline-none cursor-pointer"
                  >
                    <option value="">Detectar automaticamente pelo arquivo</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.name}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="import-account"
                    placeholder="Nome da conta (ex: Nubank, Itaú...)"
                    value={selectedAccountName}
                    onChange={(e) => setSelectedAccountName(e.target.value)}
                    disabled={isUploading}
                  />
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3">
                {selectedFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="default"
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    disabled={isUploading}
                  >
                    Limpar
                  </Button>
                )}
                <Button
                  type="submit"
                  size="default"
                  disabled={!selectedFile || isUploading}
                  className="touch-target"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Importando dados...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Iniciar Importação
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Instructions / Help */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-primary" />
                <CardTitle className="text-sm font-bold text-foreground">
                  Como exportar seu extrato?
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted space-y-3 leading-relaxed">
              <div>
                <p className="font-semibold text-foreground">OFX / QFX (Recomendado)</p>
                Acesse o internet banking ou aplicativo do seu banco (Nubank, Itaú, Inter, Bradesco, etc.),
                vá até a opção de extrato e escolha <strong>Exportar em OFX</strong>.
              </div>
              <div>
                <p className="font-semibold text-foreground">Sem duplicidades</p>
                O EcoFinance reconhece lançamentos já importados anteriormente pelo identificador único (FITID)
                para evitar registros repetidos.
              </div>
              <div>
                <p className="font-semibold text-foreground">Categorização inteligente</p>
                As transações são automaticamente associadas a categorias como Alimentação, Transporte e Lazer
                com base nas descrições do extrato.
              </div>
            </CardContent>
          </Card>

          {recentBatches.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <CardTitle className="text-sm font-bold text-foreground">
                    Importações Recentes
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="divide-y divide-border -mx-2">
                {recentBatches.map((b) => (
                  <div key={b.id} className="p-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-foreground uppercase">{b.source}</span>
                      <p className="text-[11px] text-muted">{formatDate(b.createdAt)}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {b.state}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
