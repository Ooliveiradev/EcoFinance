import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CardRecord, ManualAccountRecord, ManualCategoryRecord, ManualEntryRecord, PlanningRule, PlanningView } from '@ecofinance/shared';

export type RootStack = {
  Tabs: undefined;
  EntryForm: { entry?: ManualEntryRecord; draftId?: string };
  References: undefined;
  ReferenceForm: { type: 'account'; record?: ManualAccountRecord } | { type: 'category'; record?: ManualCategoryRecord };
  CardForm: { card?: CardRecord };
  Invoice: { card: CardRecord };
  Budget: { month: string; plan: PlanningView['plan']; copy?: boolean };
  RecurrenceForm: { month: string; rule?: PlanningRule };
  Imports: undefined;
  ImportReview: { batchId: string };
  Pending: undefined;
  Settings: undefined;
};
export type StackProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
export function useStack() { return useNavigation<NativeStackNavigationProp<RootStack>>(); }
