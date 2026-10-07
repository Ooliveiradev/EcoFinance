import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Text, Pressable } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { OnboardingScreen, ONBOARDING_KEY } from './screens/onboarding';
import { LoginScreen } from './screens/auth/login';
import { MonthScreen } from './screens/month';
import { EntriesScreen } from './screens/entries';
import { EntryFormScreen } from './screens/entry-form';
import { PlanningScreen, BudgetScreen, RecurrenceFormScreen } from './screens/planning';
import { CardsScreen, CardFormScreen, InvoiceScreen } from './screens/cards';
import { ReferencesScreen, ReferenceFormScreen } from './screens/references';
import { ImportsScreen, ImportReviewScreen } from './screens/imports';
import { PendingScreen } from './screens/pending';
import { MoreScreen, SettingsScreen } from './screens/settings';
import { disableLegacyCapture } from './services/notification-handler';
import { backendFetch, clearSession, loadBackendConfig, onSessionExpired, SessionExpired } from './services/backend-config';
import { toApiError } from './data/api';
import { activeUserId, prepareUser, unsyncedCount } from './data/session';
import { DataProvider } from './ui/data-context';
import { colors } from './ui/theme';
import type { RootStack } from './navigation';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStack>();

const CustomDarkTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: colors.card, text: colors.text, primary: '#10b981', border: '#334155', notification: '#10b981' },
};
const header = { headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, headerTitleStyle: { fontWeight: 'bold' as const } };
type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
const icon = (name: IconName) => function TabIcon({ color, size }: { color: string; size: number }) {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
};
const tabs = { Month: icon('calendar-month'), Entries: icon('format-list-bulleted'), Planning: icon('calendar-check'), Cards: icon('credit-card-outline'), More: icon('dots-horizontal') };

function Tabs() {
  return <Tab.Navigator initialRouteName="Month" screenOptions={{ ...header, tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border }, tabBarActiveTintColor: '#10b981', tabBarInactiveTintColor: '#94a3b8' }}>
    <Tab.Screen name="Month" component={MonthScreen} options={{ title: 'Meu mês', tabBarIcon: tabs.Month }} />
    <Tab.Screen name="Entries" component={EntriesScreen} options={{ title: 'Lançamentos', tabBarIcon: tabs.Entries }} />
    <Tab.Screen name="Planning" component={PlanningScreen} options={{ title: 'Planejamento', tabBarIcon: tabs.Planning }} />
    <Tab.Screen name="Cards" component={CardsScreen} options={{ title: 'Cartões', tabBarIcon: tabs.Cards }} />
    <Tab.Screen name="More" component={MoreScreen} options={{ title: 'Mais', tabBarIcon: tabs.More }} />
  </Tab.Navigator>;
}

function Main({ userId }: { userId: string }) {
  return <DataProvider userId={userId}>
    <NavigationContainer theme={CustomDarkTheme}>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={header}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="EntryForm" component={EntryFormScreen} options={{ title: 'Lançamento' }} />
        <Stack.Screen name="References" component={ReferencesScreen} options={{ title: 'Contas e categorias' }} />
        <Stack.Screen name="ReferenceForm" component={ReferenceFormScreen} options={{ title: 'Cadastro' }} />
        <Stack.Screen name="CardForm" component={CardFormScreen} options={{ title: 'Cartão' }} />
        <Stack.Screen name="Invoice" component={InvoiceScreen} options={{ title: 'Fatura' }} />
        <Stack.Screen name="Budget" component={BudgetScreen} options={{ title: 'Orçamento' }} />
        <Stack.Screen name="RecurrenceForm" component={RecurrenceFormScreen} options={{ title: 'Nova recorrência' }} />
        <Stack.Screen name="Imports" component={ImportsScreen} options={{ title: 'Importar' }} />
        <Stack.Screen name="ImportReview" component={ImportReviewScreen} options={{ title: 'Revisão' }} />
        <Stack.Screen name="Pending" component={PendingScreen} options={{ title: 'Pendências' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Sessão e privacidade' }} />
      </Stack.Navigator>
    </NavigationContainer>
  </DataProvider>;
}

/** Signed-in user with a valid local session; `offline` when the server could not confirm it at startup. */
type Startup = { status: 'loading' } | { status: 'error' } | { status: 'ready'; onboarded: boolean; userId: string | null };

async function checkStartup(): Promise<Startup> {
  await disableLegacyCapture();
  const onboarded = await AsyncStorage.getItem(ONBOARDING_KEY) === 'done';
  const session = await loadBackendConfig();
  if (!session) return { status: 'ready', onboarded, userId: null };
  try {
    const response = await backendFetch('/api/auth/get-session');
    if (response.status >= 500) throw new TypeError('Session service unavailable');
    if (!response.ok) throw new Error('Unexpected session response');
    if (await response.json() === null) { await clearSession(); return { status: 'ready', onboarded, userId: null }; }
  } catch (raw) {
    if (raw instanceof SessionExpired) return { status: 'ready', onboarded, userId: null };
    // Offline start: open the saved copy of this same user; any 401 later returns to login.
    if (toApiError(raw).kind !== 'offline') throw raw;
  }
  await prepareUser(session.userId);
  return { status: 'ready', onboarded, userId: session.userId };
}

export default function App() {
  const [startup, setStartup] = useState<Startup>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loginNotice, setLoginNotice] = useState('');

  const signedIn = startup.status === 'ready' ? startup.userId : null;
  const lastUser = useRef<string | null>(null);
  useEffect(() => { if (signedIn) lastUser.current = signedIn; }, [signedIn]);

  useEffect(() => onSessionExpired(() => {
    setStartup(current => current.status === 'ready' ? { ...current, userId: null } : current);
    const previous = lastUser.current;
    if (!previous) return;
    // Logout already erased local data; an expiry keeps drafts of the same account to send after login.
    void unsyncedCount(previous).then(count => setLoginNotice(count
      ? `Sessão expirada. ${count} alteração(ões) pendente(s) continuam neste aparelho e serão enviadas quando você entrar com a mesma conta.`
      : ''), () => setLoginNotice(''));
  }), []);

  useEffect(() => {
    let active = true;
    checkStartup().then(result => { if (active) setStartup(result); }, () => { if (active) setStartup({ status: 'error' }); });
    return () => { active = false; };
  }, [attempt]);

  if (startup.status === 'loading') return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
    <ActivityIndicator color="#10b981" size="large" />
  </View>;
  if (startup.status === 'error') return <View style={{ flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center', gap: 16 }}>
    <Text accessibilityRole="alert" style={{ color: '#fff' }}>Não foi possível verificar sua sessão. Verifique a conexão e tente novamente.</Text>
    <Pressable accessibilityRole="button" onPress={() => { setStartup({ status: 'loading' }); setAttempt(value => value + 1); }}><Text style={{ color: colors.accent }}>Tentar novamente</Text></Pressable>
  </View>;
  if (!startup.onboarded) return <>
    <StatusBar style="light" />
    <OnboardingScreen onComplete={() => setStartup({ ...startup, onboarded: true })} />
  </>;
  if (!startup.userId) return <LoginScreen notice={loginNotice} onComplete={async () => {
    const userId = await activeUserId();
    if (!userId) return;
    await prepareUser(userId);
    setLoginNotice('');
    setStartup({ ...startup, userId });
  }} />;
  return <Main key={startup.userId} userId={startup.userId} />;
}
