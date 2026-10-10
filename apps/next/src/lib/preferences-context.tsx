'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useSyncExternalStore } from 'react';
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
  setTheme: (theme: ThemePreference) => void;
  setFavoriteCategory: (category: string | null) => void;
  toggleCardVisibility: (id: DashboardCardId) => void;
  moveCard: (id: DashboardCardId, direction: 'up' | 'down') => void;
  resetPreferences: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

// The system theme is never provider state. React treats any provider value that
// changes above a streamed Suspense boundary not yet revealed as an update to
// that boundary: it discards the server HTML and renders the page on the client
// while the hidden streamed copy is still in the document (two copies of the
// page until React's reveal script removes it). Only the components that show
// the theme subscribe to it.
const DARK_QUERY = '(prefers-color-scheme: dark)';
function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const systemTheme = (): 'light' | 'dark' => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');
const serverTheme = (): 'light' | 'dark' => 'dark';

function applyThemeToDocument(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  // Server and first client render use the defaults, so hydration matches; the
  // stored choice is applied right after mount, and only when it differs.
  const [preferences, setPreferencesState] = useState<Preferences>(defaultPreferences);

  useEffect(() => {
    try {
      const stored = parsePreferences(localStorage.getItem(STORAGE_KEY)).preferences;
      setPreferencesState(current => (serializePreferences(current) === serializePreferences(stored) ? current : stored));
    } catch {
      // Storage unavailable: keep the defaults
    }
  }, []);

  // The inline script in layout.tsx applied the theme before paint; this keeps
  // the document in sync with later preference and system changes.
  useEffect(() => {
    if (preferences.theme !== 'system') return applyThemeToDocument(preferences.theme);
    const apply = () => applyThemeToDocument(systemTheme());
    apply();
    return subscribeSystemTheme(apply);
  }, [preferences.theme]);

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
      setTheme,
      setFavoriteCategory,
      toggleCardVisibility,
      moveCard,
      resetPreferences,
    }),
    [
      preferences,
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

/** Theme applied to the document. Hydrates as 'dark' and updates only the calling component. */
export function useResolvedTheme(): 'light' | 'dark' {
  const { preferences } = usePreferences();
  const system = useSyncExternalStore(subscribeSystemTheme, systemTheme, serverTheme);
  return preferences.theme === 'system' ? system : preferences.theme;
}
