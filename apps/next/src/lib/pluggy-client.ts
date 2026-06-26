// ---------------------------------------------------------------------------
// Pluggy API Client — Full typed integration for "Meu Pluggy" free tier
// ---------------------------------------------------------------------------

// ── Response types ──────────────────────────────────────────────────────────

export interface PluggyAuthResponse {
  apiKey: string;
}

export interface PluggyAccount {
  id: string;
  name: string;
  type: string;
  subtype: string;
  balance: number;
  currencyCode: string;
  itemId: string;
  number: string;
  marketingName: string | null;
  owner: string | null;
  taxNumber: string | null;
  bankData: {
    transferNumber: string | null;
    closingBalance: number | null;
  } | null;
  creditData: {
    level: string | null;
    brand: string | null;
    balanceCloseDate: string | null;
    balanceDueDate: string | null;
    availableCreditLimit: number | null;
    balanceForeignCurrency: number | null;
    minimumPayment: number | null;
    creditLimit: number | null;
  } | null;
}

export interface PluggyTransaction {
  id: string;
  description: string;
  descriptionRaw: string | null;
  amount: number;
  amountInAccountCurrency: number | null;
  date: string;
  category: string | null;
  categoryId: string | null;
  balance: number | null;
  accountId: string;
  providerCode: string | null;
  status: string;
  type: string;
  currencyCode: string;
  creditCardMetadata: {
    installmentNumber: number | null;
    totalInstallments: number | null;
    totalAmount: number | null;
    payeeMCC: number | null;
    cardNumber: string | null;
  } | null;
  paymentData: {
    payer: { name: string | null; documentNumber: string | null } | null;
    receiver: { name: string | null; documentNumber: string | null } | null;
    paymentMethod: string | null;
    referenceNumber: string | null;
  } | null;
}

export interface PluggyItem {
  id: string;
  connector: {
    id: number;
    name: string;
    primaryColor: string | null;
    institutionUrl: string | null;
    type: string;
  };
  status: string;
  executionStatus: string;
  createdAt: string;
  updatedAt: string;
  lastUpdatedAt: string | null;
  error: { code: string; message: string } | null;
}

interface PluggyPaginatedResponse<T> {
  total: number;
  totalPages: number;
  page: number;
  results: T[];
}

// ── Error types ─────────────────────────────────────────────────────────────

export class PluggyApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'PluggyApiError';
  }
}

export class PluggyAuthError extends PluggyApiError {
  constructor(message: string, statusCode: number, responseBody: unknown) {
    super(message, statusCode, responseBody);
    this.name = 'PluggyAuthError';
  }
}

// ── Client ──────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

export class PluggyClient {
  private readonly baseUrl = 'https://api.pluggy.ai';
  private apiKey: string | null = null;
  private apiKeyExpiresAt: number = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    if (!clientId || !clientSecret) {
      throw new Error('PluggyClient requires clientId and clientSecret');
    }
  }

  // ── Authentication ──────────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    const now = Date.now();
    // Reuse token if it hasn't expired (with 60s buffer)
    if (this.apiKey && this.apiKeyExpiresAt > now + 60_000) {
      return;
    }

    const response = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      throw new PluggyAuthError(
        `Pluggy authentication failed: ${response.status}`,
        response.status,
        body,
      );
    }

    const data = (await response.json()) as PluggyAuthResponse;
    this.apiKey = data.apiKey;
    // Pluggy tokens last ~2h; cache for 1h50m
    this.apiKeyExpiresAt = now + 110 * 60 * 1000;
  }

  // ── Generic request with retry + exponential backoff ────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.authenticate();

        let url = `${this.baseUrl}${path}`;
        if (queryParams) {
          const params = new URLSearchParams(queryParams);
          url = `${url}?${params.toString()}`;
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-API-KEY': this.apiKey!,
        };

        const fetchOptions: RequestInit = { method, headers };
        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);

        // Force re-auth on 401 and retry
        if (response.status === 401) {
          this.apiKey = null;
          this.apiKeyExpiresAt = 0;
          throw new PluggyApiError('Unauthorized', 401, null);
        }

        if (!response.ok) {
          const responseBody = await response.text().catch(() => 'unknown');
          throw new PluggyApiError(
            `Pluggy API error ${response.status} on ${method} ${path}`,
            response.status,
            responseBody,
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx errors (except 401 which we handle above, and 429)
        if (
          error instanceof PluggyApiError &&
          error.statusCode >= 400 &&
          error.statusCode < 500 &&
          error.statusCode !== 401 &&
          error.statusCode !== 429
        ) {
          throw error;
        }

        // Exponential backoff
        if (attempt < MAX_RETRIES - 1) {
          const delayMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError ?? new Error('Request failed after all retries');
  }

  // ── Public API methods ──────────────────────────────────────────────────

  async getItem(itemId: string): Promise<PluggyItem> {
    return this.request<PluggyItem>('GET', `/items/${itemId}`);
  }

  async getAccounts(itemId: string): Promise<PluggyAccount[]> {
    const response = await this.request<PluggyPaginatedResponse<PluggyAccount>>(
      'GET',
      '/accounts',
      undefined,
      { itemId },
    );
    return response.results;
  }

  async getTransactions(
    accountId: string,
    from?: string,
    to?: string,
  ): Promise<PluggyTransaction[]> {
    const allTransactions: PluggyTransaction[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const params: Record<string, string> = {
        accountId,
        pageSize: '500',
        page: String(page),
      };
      if (from) params.from = from;
      if (to) params.to = to;

      const response = await this.request<PluggyPaginatedResponse<PluggyTransaction>>(
        'GET',
        '/transactions',
        undefined,
        params,
      );

      allTransactions.push(...response.results);
      totalPages = response.totalPages;
      page++;
    }

    return allTransactions;
  }

  async createConnectToken(): Promise<string> {
    const response = await this.request<{ accessToken: string }>(
      'POST',
      '/connect_token'
    );
    return response.accessToken;
  }
}

