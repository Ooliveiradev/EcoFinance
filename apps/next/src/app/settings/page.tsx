import { Metadata } from 'next';
import { SettingsClient } from './settings-client';

export const metadata: Metadata = {
  title: 'EcoFinance | Configurações',
  description: 'Gerencie suas preferências e configurações.',
};

export default function SettingsPage() {
  return <SettingsClient />;
}
