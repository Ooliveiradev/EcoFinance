'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  type Preferences,
  type ThemePreference,
  type DashboardCardId,
  defaultPreferences,
  parsePreferences,
  serializePreferences,
  setTheme as updateTheme,
  setFavoriteCategory as updateFavoriteCategory,
  setCardVisible as updateCardVisible,
  moveCard as updateMoveCard,
} from '@ecofinance/shared';

const STORAGE_KEY = 'ecofinance_preferences';

interface PreferencesContextValue {
  preferences: Preferences;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
  setFavoriteCategory: (category: string | null) => void;
  toggleCardVisibility: (id: DashboardCardId) => void;
  moveCard: (id: DashboardCardId, direction: 'up' | 'down') => void;
  resetPreferences: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeToDocument(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferencesState] = useState<Preferences>(() => {
    if (typeof window === 'undefined') return defaultPreferences();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return parsePreferences(stored).preferences;
    } catch {
      return defaultPreferences();
    }
  });

  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    setSystemTheme(getSystemTheme());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  const resolvedTheme: 'light' | 'dark' = useMemo(() => {
    if (preferences.theme === 'system') return systemTheme;
    return preferences.theme;
  }, [preferences.theme, systemTheme]);

  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const savePreferences = useCallback((newPrefs: Preferences) => {
    setPreferencesState(newPrefs);
    try {
      localStorage.setItem(STORAGE_KEY, serializePreferences(newPrefs));
    } catch {
      // Storage unavailable or quota exceeded
    }
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        setPreferencesState(parsePreferences(event.newValue).preferences);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setTheme = useCallback(
    (theme: ThemePreference) => {
      savePreferences(updateTheme(preferences, theme));
    },
    [preferences, savePreferences],
  );

  const setFavoriteCategory = useCallback(
    (category: string | null) => {
      savePreferences(updateFavoriteCategory(preferences, category));
    },
    [preferences, savePreferences],
  );

  const toggleCardVisibility = useCallback(
    (id: DashboardCardId) => {
      const card = preferences.dashboardCards.find((c) => c.id === id);
      const visible = card ? !card.visible : true;
      savePreferences(updateCardVisible(preferences, id, visible));
    },
    [preferences, savePreferences],
  );

  const moveCard = useCallback(
    (id: DashboardCardId, direction: 'up' | 'down') => {
      savePreferences(updateMoveCard(preferences, id, direction));
    },
    [preferences, savePreferences],
  );

  const resetPreferences = useCallback(() => {
    savePreferences(defaultPreferences());
  }, [savePreferences]);

  const value = useMemo(
    () => ({
      preferences,
      resolvedTheme,
      setTheme,
      setFavoriteCategory,
      toggleCardVisibility,
      moveCard,
      resetPreferences,
    }),
    [
      preferences,
      resolvedTheme,
      setTheme,
      setFavoriteCategory,
      toggleCardVisibility,
      moveCard,
      resetPreferences,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
