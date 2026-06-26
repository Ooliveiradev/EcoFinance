import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { getCurrentLocation } from './location-service';
import { sendTransaction } from './api-client';
import { parseAmountFromText } from '@ecofinance/shared';

export const NOTIFICATION_HANDLER_TASK = 'ECOFINANCE_NOTIFICATION_HANDLER';

// Bank sender names to match in push notifications
const BANK_SENDER_MAP: Record<string, string> = {
  nubank: 'Nubank',
  'nu pagamentos': 'Nubank',
  itaú: 'Itaú',
  itau: 'Itaú',
  bradesco: 'Bradesco',
  'banco inter': 'Inter',
  inter: 'Inter',
  c6: 'C6 Bank',
  santander: 'Santander',
  'banco do brasil': 'Banco do Brasil',
  'mercado pago': 'Mercado Pago',
};

// Keywords to identify purchase notifications
const PURCHASE_KEYWORDS = [
  'compra', 'pagamento', 'débito', 'debito',
  'pix enviado', 'transferência', 'transferencia',
  'saque', 'aprovad', 'utilizado',
];

function detectBankFromNotification(title: string, body: string): string | null {
  const combined = `${title} ${body}`.toLowerCase();
  for (const [key, bankName] of Object.entries(BANK_SENDER_MAP)) {
    if (combined.includes(key)) return bankName;
  }
  return null;
}

function isPurchaseNotification(title: string, body: string): boolean {
  const combined = `${title} ${body}`.toLowerCase();
  return PURCHASE_KEYWORDS.some(k => combined.includes(k));
}

// This task runs when a notification is received in the background/foreground
try {
  TaskManager.defineTask(NOTIFICATION_HANDLER_TASK, async ({ data, error }: any) => {
    if (error) {
      console.error('NOTIFICATION_HANDLER_TASK error:', error);
      return;
    }

    const notification = data?.notification as Notifications.Notification | undefined;
    if (!notification) return;

    const title = notification.request.content.title || '';
    const body = notification.request.content.body || '';

    if (!isPurchaseNotification(title, body)) {
      console.log('Notification is not a purchase, ignoring.');
      return;
    }

    const bankName = detectBankFromNotification(title, body);
    if (!bankName) {
      console.log('Could not identify bank from notification, ignoring.');
      return;
    }

    // Try to parse the amount
    const amount = parseAmountFromText(body) || parseAmountFromText(title);
    if (!amount) {
      console.log('Could not parse amount from notification.');
      return;
    }

    let description = body;
    // Try to extract merchant name using "em" pattern common in Brazilian banks
    const emMatch = body.toLowerCase().match(/em (.*?)( no valor| r\$|$)/);
    if (emMatch?.[1]) {
      description = emMatch[1].trim();
    }

    console.log(`Detected transaction: ${bankName} - R$${amount} - ${description}`);

    const location = await getCurrentLocation();
    const timestamp = new Date(notification.date).toISOString();

    await sendTransaction({
      description,
      amount: -Math.abs(amount),
      bankName,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      timestamp,
    });
  });
} catch (e) {
  console.warn('Failed to defineTask:', e);
}

export async function registerNotificationHandlerTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(NOTIFICATION_HANDLER_TASK);
  if (!isRegistered) {
    await Notifications.registerTaskAsync(NOTIFICATION_HANDLER_TASK);
    console.log(`Task "${NOTIFICATION_HANDLER_TASK}" registered.`);
  }
}
