import { getCurrentLocation } from './location-service';
import { sendTransaction } from './api-client';
import { 
  parseAmountFromText, 
  categorizeTransaction, 
  generateDeduplicationHash 
} from '@ecofinance/shared';

interface NotificationData {
  app: string;
  title: string;
  text: string;
  subText: string;
  groupedMessages: string[];
  time: string;
}

// Bank app package names for filtering
const BANK_PACKAGES: Record<string, string> = {
  'com.nu.production': 'Nubank',
  'com.itau': 'Itaú',
  'com.bradesco': 'Bradesco',
  'br.com.intermedium': 'Inter',
  'com.c6bank.app': 'C6 Bank',
  'com.santander.app': 'Santander',
  'br.com.bb.android': 'Banco do Brasil',
  'com.mercadopago.wallet': 'Mercado Pago',
  'br.com.itau.empresas': 'Itaú PJ',
};

// Purchase-related keywords to filter relevant notifications
const PURCHASE_KEYWORDS = ['compra', 'pagamento', 'débito', 'pix', 'transferência', 'saque', 'aprovad'];

export async function headlessNotificationListener(data: NotificationData): Promise<void> {
  try {
    const bankName = BANK_PACKAGES[data.app];
    if (!bankName) {
      console.log(`Notification from unknown app ignored: ${data.app}`);
      return; // Not a known bank app
    }

    const notificationText = `${data.title} ${data.text} ${data.subText || ''}`.toLowerCase();
    
    const isPurchase = PURCHASE_KEYWORDS.some(keyword => notificationText.includes(keyword));
    if (!isPurchase) {
      console.log(`Notification without purchase keywords ignored from ${bankName}.`);
      return; 
    }

    const amount = parseAmountFromText(data.text) || parseAmountFromText(data.title);
    if (!amount) {
      console.log(`Could not parse amount from notification text: ${data.text}`);
      return;
    }

    // Attempt to extract description (usually follows the word "em" or is the title)
    // Basic heuristic:
    let description = data.text;
    const emMatch = notificationText.match(/em (.*?)( no valor|$)/);
    if (emMatch && emMatch[1]) {
      description = emMatch[1].trim();
    }

    console.log(`Detected valid transaction: ${bankName} - ${amount} - ${description}`);

    // Get current GPS location (will timeout if unable)
    const location = await getCurrentLocation();

    const timestamp = data.time ? new Date(parseInt(data.time)).toISOString() : new Date().toISOString();

    const payload = {
      description,
      amount: -Math.abs(amount), // Purchases are negative
      bankName,
      latitude: location?.latitude || null,
      longitude: location?.longitude || null,
      timestamp,
    };

    const response = await sendTransaction(payload);
    
    if (response.success) {
      console.log('Transaction sent successfully to backend.', response.duplicate ? '(Duplicate detected and handled)' : '');
    } else {
      console.error('Failed to send transaction to backend.');
    }

  } catch (error) {
    console.error('Error in headlessNotificationListener:', error);
  }
}
