import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, Pressable } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { HomeScreen } from './screens/home';
import { AccountsScreen } from './screens/accounts';
import { SettingsScreen } from './screens/settings';
import { AIScreen } from './screens/ai';
import { OnboardingScreen, ONBOARDING_KEY } from './screens/onboarding';
import { LoginScreen } from './screens/auth/login';
import { disableLegacyCapture } from './services/notification-handler';
import { backendFetch, clearSession, loadBackendConfig, onSessionExpired, SessionExpired } from './services/backend-config';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const Tab = createBottomTabNavigator();

const CustomDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#020617',
    card: '#0f172a',
    text: '#f8fafc',
    primary: '#10b981',
    border: '#334155',
    notification: '#10b981',
  },
};

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [startupError, setStartupError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => onSessionExpired(() => setAuthenticated(false)), []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      setIsReady(false);
      setStartupError(false);
      // Check if user has already completed onboarding
      try {
        await disableLegacyCapture();
        const value = await AsyncStorage.getItem(ONBOARDING_KEY);
        const session = await loadBackendConfig();
        if (!active) return;
        setHasOnboarded(value === 'done');
        if (session) {
          const response = await backendFetch('/api/auth/get-session');
          if (!response.ok) throw new Error('Session service unavailable');
          const value: unknown = await response.json();
          if (!active) return;
          if (value === null) await clearSession();
          if (!active) return;
          setAuthenticated(response.ok && value !== null);
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof SessionExpired) setAuthenticated(false);
        else setStartupError(true);
      } finally {
        if (active) setIsReady(true);
      }
    };
    init();
    return () => { active = false; };
  }, [attempt]);

  // Show a splash/loading screen while checking AsyncStorage
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#020617', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#10b981" size="large" />
      </View>
    );
  }

  // Show onboarding for first-time users
  if (startupError) return <View style={{ flex: 1, backgroundColor: '#020617', padding: 24, justifyContent: 'center', gap: 16 }}>
    <Text accessibilityRole="alert" style={{ color: '#fff' }}>Não foi possível verificar sua sessão. Verifique a conexão e tente novamente.</Text>
    <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}><Text style={{ color: '#34d399' }}>Tentar novamente</Text></Pressable>
  </View>;
  if (!hasOnboarded) {
    return (
      <>
        <StatusBar style="light" />
        <OnboardingScreen onComplete={() => setHasOnboarded(true)} />
      </>
    );
  }

  // Main app after onboarding
  if (!authenticated) return <LoginScreen onComplete={() => setAuthenticated(true)} />;
  return (
    <NavigationContainer theme={CustomDarkTheme}>
      <StatusBar style="light" />
      <Tab.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#f8fafc',
          headerTitleStyle: { fontWeight: 'bold' },
          tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
          tabBarActiveTintColor: '#10b981',
          tabBarInactiveTintColor: '#64748b',
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: 'Meu mês',
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="calendar-month" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Accounts"
          component={AccountsScreen}
          options={{
            title: 'Contas e cartões',
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="bank" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="AI"
          component={AIScreen}
          options={{
            title: 'Assistente',
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="robot-outline" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Configurações',
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="cog" color={color} size={size} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
