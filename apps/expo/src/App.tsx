import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
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
import { registerNotificationHandlerTask } from './services/notification-handler';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
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

  useEffect(() => {
    const init = async () => {
      // Register background task (non-blocking)
      registerNotificationHandlerTask().catch((err) => {
        console.warn('Could not register notification task:', err);
      });

      // Check if user has already completed onboarding
      try {
        const value = await AsyncStorage.getItem(ONBOARDING_KEY);
        setHasOnboarded(value === 'done');
      } catch {
        setHasOnboarded(false);
      } finally {
        setIsReady(true);
      }
    };
    init();
  }, []);

  // Show a splash/loading screen while checking AsyncStorage
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#020617', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#10b981" size="large" />
      </View>
    );
  }

  // Show onboarding for first-time users
  if (!hasOnboarded) {
    return (
      <>
        <StatusBar style="light" />
        <OnboardingScreen onComplete={() => setHasOnboarded(true)} />
      </>
    );
  }

  // Main app after onboarding
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
            title: 'Início',
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="home" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Accounts"
          component={AccountsScreen}
          options={{
            title: 'Contas',
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
            title: 'Opções',
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="cog" color={color} size={size} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
