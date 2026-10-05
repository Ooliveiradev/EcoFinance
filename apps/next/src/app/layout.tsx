import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ClientLayout } from '@/components/client-layout';
import { PreferencesProvider } from '@/lib/preferences-context';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'EcoFinance | Gestão Financeira Pessoal',
  description:
    'Gerenciador financeiro mensal com controle de contas, planejamento, cartões e importação multiformato.',
  keywords: ['finanças', 'dashboard', 'planejamento', 'orçamento', 'contas', 'lançamentos'],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

// Inline script executed synchronously before first paint to prevent theme flashing (FOUC).
const themeInitScript = `
(function() {
  try {
    var raw = localStorage.getItem('ecofinance_preferences');
    var theme = 'system';
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system')) {
        theme = parsed.theme;
      }
    }
    var resolved = theme === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    if (resolved === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <PreferencesProvider>
          <ClientLayout>{children}</ClientLayout>
        </PreferencesProvider>
      </body>
    </html>
  );
}
