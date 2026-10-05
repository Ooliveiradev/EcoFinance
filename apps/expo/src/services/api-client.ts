import type { NotificationTransactionPayload } from '@ecofinance/shared';
// Capture must go through reviewed staging (EF-08/EF-19). Never retry the
// retired immediate writer or convert a session expiry into an automatic send.
export async function sendTransaction(_payload: NotificationTransactionPayload): Promise<{ success: boolean; duplicate: boolean }> {
  return { success: false, duplicate: false };
}
