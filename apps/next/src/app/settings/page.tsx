import { Metadata } from 'next';
import { SettingsClient } from './settings-client';
import { SessionControls } from '@/components/session-controls';
import { DataControls } from './data-controls';
import { CategoryRules } from './category-rules';

export const metadata: Metadata = {
  title: 'EcoFinance | Configurações',
  description: 'Gerencie suas preferências e configurações.',
};

export default function SettingsPage() {
  return <><SessionControls /><DataControls /><CategoryRules /><SettingsClient /></>;
}
