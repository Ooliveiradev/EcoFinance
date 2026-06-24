import { NotificationTransactionPayload } from '@ecofinance/shared';

// For Android emulator, 10.0.2.2 points to host localhost. Adjust in production via environment vars.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000';
const API_SECRET = process.env.EXPO_PUBLIC_API_SECRET || '';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function sendTransaction(payload: NotificationTransactionPayload, retries = 3): Promise<{ success: boolean; duplicate: boolean }> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/transactions/notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret-key': API_SECRET,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, duplicate: data.duplicate || false };
      }

      console.warn(`Attempt ${attempt} failed with status ${response.status}`);
      if (response.status === 401 || response.status === 403) {
        // Auth error, do not retry
        console.error('API Authentication failed. Check your EXPO_PUBLIC_API_SECRET.');
        break;
      }
    } catch (error) {
      console.warn(`Attempt ${attempt} network error:`, error);
    }

    if (attempt < retries) {
      const backoff = attempt * 1000;
      await sleep(backoff);
    }
  }

  return { success: false, duplicate: false };
}

export async function testConnection(url: string, secret: string): Promise<boolean> {
  try {
    // Just a ping/healthcheck route (assuming the backend has one)
    // If not, we can hit a known endpoint and check if it's 401 (auth failed) vs network error
    const response = await fetch(`${url}/api/transactions/notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret-key': secret,
      },
      body: JSON.stringify({ test: true }), // Invalid payload should return 400, but proves connection and auth (if not 401)
    });

    return response.status !== 401 && response.status !== 404 && response.status !== 502;
  } catch {
    return false;
  }
}
