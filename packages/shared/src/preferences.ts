import { z } from 'zod';

// =============================================================================
// User interface preferences
// =============================================================================
// Shared contract for the preferences persisted by the web (localStorage) and
// Expo (AsyncStorage) clients. The shape is also valid for the `settings` JSON
// column of the `preferences` table, so server-side persistence (once sessions
// identify the owner) can store exactly this document.
//
// Reading is deliberately forgiving: stored data may come from an older build,
// another tab or manual editing, so each field is salvaged independently
// instead of discarding the whole document.
// =============================================================================

export const PREFERENCES_VERSION = 1;

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Order here is the default order on "Meu mês". Add expense/Import file are fixed actions, not cards. */
export const DASHBOARD_CARD_IDS = ['upcoming-bills', 'month-summary', 'categories', 'recent-entries'] as const;
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

export const DASHBOARD_CARD_LABELS: Readonly<Record<DashboardCardId, string>> = {
  'upcoming-bills': 'Próximas contas',
  'month-summary': 'Resumo do mês',
  categories: 'Despesas por categoria',
  'recent-entries': 'Lançamentos recentes',
};

export const FAVORITE_CATEGORY_MAX_LENGTH = 64;

export interface DashboardCardPreference {
  id: DashboardCardId;
  visible: boolean;
}

export interface Preferences {
  version: typeof PREFERENCES_VERSION;
  theme: ThemePreference;
  dashboardCards: DashboardCardPreference[];
  /** Legacy category key today; an owner category id once categories are editable. */
  favoriteCategory: string | null;
}

export const preferencesSchema = z
  .object({
    version: z.literal(PREFERENCES_VERSION),
    theme: z.enum(THEME_PREFERENCES),
    dashboardCards: z
      .array(z.object({ id: z.enum(DASHBOARD_CARD_IDS), visible: z.boolean() }).strict())
      .length(DASHBOARD_CARD_IDS.length)
      .refine(cards => new Set(cards.map(card => card.id)).size === cards.length, 'Cartões duplicados.'),
    favoriteCategory: z.string().trim().min(1).max(FAVORITE_CATEGORY_MAX_LENGTH).nullable(),
  })
  .strict();

export function defaultPreferences(): Preferences {
  return {
    version: PREFERENCES_VERSION,
    theme: 'system',
    dashboardCards: DASHBOARD_CARD_IDS.map(id => ({ id, visible: true })),
    favoriteCategory: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCards(value: unknown): DashboardCardPreference[] {
  const seen = new Set<DashboardCardId>();
  const cards: DashboardCardPreference[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue;
      const id = DASHBOARD_CARD_IDS.find(candidate => candidate === item.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      cards.push({ id, visible: typeof item.visible === 'boolean' ? item.visible : true });
    }
  }
  // Cards introduced by newer builds appear (visible) at their default position order.
  for (const id of DASHBOARD_CARD_IDS) if (!seen.has(id)) cards.push({ id, visible: true });
  return cards;
}

/** Always returns a complete, valid document, salvaging every valid field of `input`. */
export function normalizePreferences(input: unknown): Preferences {
  const defaults = defaultPreferences();
  if (!isRecord(input)) return defaults;
  const theme = THEME_PREFERENCES.find(candidate => candidate === input.theme) ?? defaults.theme;
  const favorite = typeof input.favoriteCategory === 'string' ? input.favoriteCategory.trim() : '';
  return {
    version: PREFERENCES_VERSION,
    theme,
    dashboardCards: normalizeCards(input.dashboardCards),
    favoriteCategory:
      favorite.length > 0 && favorite.length <= FAVORITE_CATEGORY_MAX_LENGTH ? favorite : null,
  };
}

export interface ParsedPreferences {
  preferences: Preferences;
  /** True when stored text existed but was unreadable, so the UI can tell the user their settings were reset. */
  recovered: boolean;
}

export function parsePreferences(raw: string | null): ParsedPreferences {
  if (raw === null) return { preferences: defaultPreferences(), recovered: false };
  try {
    return { preferences: normalizePreferences(JSON.parse(raw)), recovered: false };
  } catch {
    return { preferences: defaultPreferences(), recovered: true };
  }
}

export function serializePreferences(preferences: Preferences): string {
  return JSON.stringify(normalizePreferences(preferences));
}

export function arePreferencesEqual(a: Preferences, b: Preferences): boolean {
  return serializePreferences(a) === serializePreferences(b);
}

export function setTheme(preferences: Preferences, theme: ThemePreference): Preferences {
  return normalizePreferences({ ...preferences, theme });
}

export function setFavoriteCategory(preferences: Preferences, favoriteCategory: string | null): Preferences {
  return normalizePreferences({ ...preferences, favoriteCategory });
}

export function setCardVisible(preferences: Preferences, id: DashboardCardId, visible: boolean): Preferences {
  return {
    ...preferences,
    dashboardCards: preferences.dashboardCards.map(card => (card.id === id ? { ...card, visible } : card)),
  };
}

export function moveCard(preferences: Preferences, id: DashboardCardId, direction: 'up' | 'down'): Preferences {
  const index = preferences.dashboardCards.findIndex(card => card.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= preferences.dashboardCards.length) return preferences;
  const dashboardCards = [...preferences.dashboardCards];
  const [moved] = dashboardCards.splice(index, 1);
  dashboardCards.splice(target, 0, moved!);
  return { ...preferences, dashboardCards };
}

/** Cards to render, in the user's order, with hidden ones removed. */
export function visibleCards(preferences: Preferences): DashboardCardId[] {
  return preferences.dashboardCards.filter(card => card.visible).map(card => card.id);
}
