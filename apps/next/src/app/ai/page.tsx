import { Metadata } from 'next';
import AIClient from './ai-client';

export const metadata: Metadata = {
  title: 'EcoFinance | Assistente',
  description: 'Seu assistente financeiro de inteligência artificial.',
};

export default function AIPage() {
  return <AIClient />;
}
