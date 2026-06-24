import type { TransactionCategory } from './types';

// =============================================================================
// EcoFinance Utility Functions
// =============================================================================

// ---------------------------------------------------------------------------
// Transaction Categorization
// ---------------------------------------------------------------------------

interface CategoryPattern {
  category: TransactionCategory;
  patterns: RegExp[];
}

const CATEGORY_PATTERNS: CategoryPattern[] = [
  {
    category: 'comida',
    patterns: [
      /ifood/i,
      /rappi/i,
      /uber\s*eats/i,
      /restaurante/i,
      /lanchonete/i,
      /padaria/i,
      /supermercado/i,
      /mercado/i,
      /hortifruti/i,
      /açougue/i,
      /acougue/i,
      /pizzaria/i,
      /burger/i,
      /mcdonald/i,
      /subway/i,
      /starbucks/i,
      /café/i,
      /cafe\b/i,
      /confeitaria/i,
      /sushi/i,
      /pão\s*de\s*açúcar/i,
      /pao\s*de\s*acucar/i,
      /carrefour/i,
      /extra\s*hiper/i,
      /atacadão/i,
      /atacadao/i,
      /assaí/i,
      /assai/i,
      /zaffari/i,
      /big\s*bompreço/i,
    ],
  },
  {
    category: 'transporte',
    patterns: [
      /uber(?!\s*eats)/i,
      /99\s*(taxi|pop|app)/i,
      /cabify/i,
      /combustível/i,
      /combustivel/i,
      /gasolina/i,
      /posto/i,
      /shell/i,
      /ipiranga/i,
      /br\s*distribuidora/i,
      /estacionamento/i,
      /parking/i,
      /pedágio/i,
      /pedagio/i,
      /metro\b/i,
      /metrô/i,
      /ônibus/i,
      /onibus/i,
      /bilhete\s*único/i,
      /bilhete\s*unico/i,
      /sem\s*parar/i,
      /veloe/i,
      /move\s*mais/i,
    ],
  },
  {
    category: 'assinaturas',
    patterns: [
      /netflix/i,
      /spotify/i,
      /amazon\s*prime/i,
      /disney/i,
      /hbo/i,
      /max\b/i,
      /globoplay/i,
      /youtube\s*(premium|music)/i,
      /apple\s*(music|tv|one)/i,
      /deezer/i,
      /paramount/i,
      /crunchyroll/i,
      /xbox\s*game/i,
      /playstation\s*(plus|now)/i,
      /adobe/i,
      /microsoft\s*365/i,
      /google\s*(one|workspace)/i,
      /dropbox/i,
      /icloud/i,
      /notion/i,
      /chatgpt/i,
      /openai/i,
    ],
  },
  {
    category: 'lazer',
    patterns: [
      /cinema/i,
      /teatro/i,
      /show\b/i,
      /ingresso/i,
      /parque/i,
      /museu/i,
      /bar\b/i,
      /balada/i,
      /boliche/i,
      /karaoke/i,
      /games?\b/i,
      /steam/i,
      /playstation\s*store/i,
      /xbox\s*store/i,
      /nintendo/i,
      /livraria/i,
      /livro/i,
      /amazon\.com/i,
      /shopee/i,
      /mercado\s*livre/i,
      /aliexpress/i,
      /shein/i,
      /magazine\s*luiza/i,
      /magalu/i,
      /americanas/i,
      /casas\s*bahia/i,
    ],
  },
  {
    category: 'saude',
    patterns: [
      /farmácia/i,
      /farmacia/i,
      /drogaria/i,
      /drogasil/i,
      /droga\s*raia/i,
      /panvel/i,
      /hospital/i,
      /clínica/i,
      /clinica/i,
      /médico/i,
      /medico/i,
      /dentista/i,
      /laboratório/i,
      /laboratorio/i,
      /consulta/i,
      /exame/i,
      /fisioterapia/i,
      /psicólogo/i,
      /psicologo/i,
      /academia/i,
      /smart\s*fit/i,
      /bio\s*ritmo/i,
      /gympass/i,
      /wellhub/i,
      /unimed/i,
      /amil/i,
      /bradesco\s*saúde/i,
      /sulamérica/i,
      /sulamerica/i,
    ],
  },
  {
    category: 'educacao',
    patterns: [
      /escola/i,
      /faculdade/i,
      /universidade/i,
      /curso/i,
      /udemy/i,
      /coursera/i,
      /alura/i,
      /rocketseat/i,
      /platzi/i,
      /mensalidade\s*escolar/i,
      /material\s*escolar/i,
      /livraria\s*cultura/i,
      /livraria\s*saraiva/i,
      /duolingo/i,
      /english/i,
      /idioma/i,
    ],
  },
  {
    category: 'moradia',
    patterns: [
      /aluguel/i,
      /condomínio/i,
      /condominio/i,
      /iptu/i,
      /luz\b/i,
      /energia/i,
      /enel/i,
      /cpfl/i,
      /cemig/i,
      /eletropaulo/i,
      /água/i,
      /agua\b/i,
      /sabesp/i,
      /copasa/i,
      /gás/i,
      /gas\b/i,
      /comgás/i,
      /comgas/i,
      /internet/i,
      /vivo\s*fibra/i,
      /claro\s*(internet|fibra)/i,
      /tim\s*(fibra|live)/i,
      /oi\s*fibra/i,
      /seguro\s*(residencial|casa)/i,
      /manutenção/i,
      /manutencao/i,
      /reforma/i,
    ],
  },
  {
    category: 'salario',
    patterns: [
      /salário/i,
      /salario/i,
      /pagamento\s*(folha|mensal)/i,
      /holerite/i,
      /pró[\s-]*labore/i,
      /pro[\s-]*labore/i,
      /décimo\s*terceiro/i,
      /decimo\s*terceiro/i,
      /férias/i,
      /ferias/i,
      /fgts/i,
      /pis\b/i,
      /abono/i,
      /bonificação/i,
      /bonificacao/i,
      /comissão/i,
      /comissao/i,
      /freelance/i,
      /pagamento\s*recebido/i,
    ],
  },
  {
    category: 'investimento',
    patterns: [
      /investimento/i,
      /aplicação/i,
      /aplicacao/i,
      /resgate/i,
      /cdb\b/i,
      /lci\b/i,
      /lca\b/i,
      /tesouro\s*(direto|selic|ipca|prefixado)/i,
      /ações/i,
      /acoes/i,
      /fii\b/i,
      /fundo\s*(imobiliário|imobiliario)/i,
      /etf\b/i,
      /bitcoin/i,
      /btc\b/i,
      /ethereum/i,
      /cripto/i,
      /crypto/i,
      /binance/i,
      /mercado\s*bitcoin/i,
      /nuinvest/i,
      /rico\b/i,
      /clear\b/i,
      /xp\s*(investimentos|inc)/i,
      /modal/i,
      /btg\s*pactual/i,
      /rendimento/i,
      /dividendo/i,
    ],
  },
  {
    category: 'transferencia',
    patterns: [
      /pix\b/i,
      /transferência/i,
      /transferencia/i,
      /ted\b/i,
      /doc\b/i,
      /depósito/i,
      /deposito/i,
      /saque/i,
      /pagamento\s*de\s*boleto/i,
      /boleto/i,
    ],
  },
];

/**
 * Categorizes a transaction based on its description using regex pattern matching.
 * Returns 'desconhecido' if no pattern matches.
 */
export function categorizeTransaction(description: string): TransactionCategory {
  const normalizedDescription = description.trim();

  for (const { category, patterns } of CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedDescription)) {
        return category;
      }
    }
  }

  return 'desconhecido';
}

// ---------------------------------------------------------------------------
// Currency Formatting
// ---------------------------------------------------------------------------

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a numeric value as Brazilian Real (BRL) currency.
 * Example: 1234.56 → "R$ 1.234,56"
 */
export function formatCurrency(value: number): string {
  return brlFormatter.format(value);
}

// ---------------------------------------------------------------------------
// Deduplication Hash
// ---------------------------------------------------------------------------

/**
 * Generates a SHA-256 deduplication hash from transaction key fields.
 * Used to prevent duplicate transactions from repeated notifications.
 *
 * @param amount - The transaction amount
 * @param bankName - The name of the bank that sent the notification
 * @param timestamp - ISO 8601 timestamp of the notification
 * @returns A hex-encoded SHA-256 hash string
 */
export async function generateDeduplicationHash(
  amount: number,
  bankName: string,
  timestamp: string,
): Promise<string> {
  const data = `${amount}|${bankName.toLowerCase().trim()}|${timestamp}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// ---------------------------------------------------------------------------
// Amount Parsing
// ---------------------------------------------------------------------------

/**
 * Parses a BRL-formatted amount string into a number.
 * Handles formats like "R$ 1.234,56", "1.234,56", "1234,56", "1234.56".
 *
 * @returns The parsed number, or null if the input cannot be parsed.
 */
export function parseAmountFromText(text: string): number | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  let cleaned = text.trim();

  // Remove currency symbol and whitespace
  cleaned = cleaned.replace(/R\$\s*/gi, '');

  // Remove any remaining whitespace
  cleaned = cleaned.replace(/\s/g, '');

  if (cleaned.length === 0) {
    return null;
  }

  // Detect BRL format (dots as thousands separators, comma as decimal)
  // e.g., "1.234,56" or "1.234.567,89"
  const brlMatch = cleaned.match(/^-?(\d{1,3}(?:\.\d{3})*),(\d{1,2})$/);
  if (brlMatch) {
    const integerPart = cleaned.split(',')[0]!.replace(/\./g, '');
    const decimalPart = cleaned.split(',')[1]!;
    const result = parseFloat(`${integerPart}.${decimalPart}`);
    return isNaN(result) ? null : result;
  }

  // Simple comma decimal (no thousands separator): "1234,56"
  const simpleCommaMatch = cleaned.match(/^-?\d+,(\d{1,2})$/);
  if (simpleCommaMatch) {
    const result = parseFloat(cleaned.replace(',', '.'));
    return isNaN(result) ? null : result;
  }

  // Standard numeric format: "1234.56" or "1234"
  const standardMatch = cleaned.match(/^-?\d+(\.\d{1,2})?$/);
  if (standardMatch) {
    const result = parseFloat(cleaned);
    return isNaN(result) ? null : result;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Time Window Check
// ---------------------------------------------------------------------------

/**
 * Checks if two dates are within a given time window of each other.
 *
 * @param date1 - First date (Date object or ISO string)
 * @param date2 - Second date (Date object or ISO string)
 * @param windowMs - Maximum allowed difference in milliseconds (default: 5 minutes)
 * @returns true if the dates are within the specified window
 */
export function isWithinTimeWindow(
  date1: Date | string,
  date2: Date | string,
  windowMs: number = 5 * 60 * 1000,
): boolean {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;

  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
    return false;
  }

  return Math.abs(d1.getTime() - d2.getTime()) <= windowMs;
}
