import Link from 'next/link';
import { FileSpreadsheet } from 'lucide-react';

/**
 * States that import previews are not part of the confirmed numbers on screen.
 * The count comes from batches in review, capped by the server read.
 */
export function PendingImportsNotice({ count, cap = 20 }: { count: number; cap?: number }) {
  if (count <= 0) return null;
  const batches = count >= cap ? `${cap} ou mais lotes` : count === 1 ? '1 lote' : `${count} lotes`;
  return (
    <div
      role="status"
      data-testid="pending-imports"
      className="p-3 rounded-xl bg-info-soft text-info border border-info/20 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
    >
      <span className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>
          {batches} de importação em revisão. Os valores desta página incluem só lançamentos confirmados; a prévia
          fica em Importações até a confirmação.
        </span>
      </span>
      <Link href="/imports" className="font-semibold underline underline-offset-2 shrink-0">
        Revisar importações
      </Link>
    </div>
  );
}
