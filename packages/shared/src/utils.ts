// =============================================================================
// EcoFinance Utility Functions
// =============================================================================

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
