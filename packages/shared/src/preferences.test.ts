import { describe, expect, it } from 'vitest';
import {
  arePreferencesEqual,
  DASHBOARD_CARD_IDS,
  defaultPreferences,
  moveCard,
  normalizePreferences,
  parsePreferences,
  preferencesSchema,
  serializePreferences,
  setCardVisible,
  setFavoriteCategory,
  setTheme,
  visibleCards,
} from './preferences';

describe('defaults', () => {
  it('start system-themed with every card visible in the default order', () => {
    const defaults = defaultPreferences();
    expect(defaults.theme).toBe('system');
    expect(defaults.favoriteCategory).toBeNull();
    expect(defaults.dashboardCards.map(card => card.id)).toEqual([...DASHBOARD_CARD_IDS]);
    expect(defaults.dashboardCards.every(card => card.visible)).toBe(true);
    expect(preferencesSchema.safeParse(defaults).success).toBe(true);
  });

  it('puts upcoming bills first so they are prioritised', () => {
    expect(DASHBOARD_CARD_IDS[0]).toBe('upcoming-bills');
  });
});

describe('normalizePreferences', () => {
  it('returns defaults for anything that is not an object', () => {
    for (const value of [null, undefined, 'text', 42, [], true]) {
      expect(normalizePreferences(value)).toEqual(defaultPreferences());
    }
  });

  it('salvages valid fields independently', () => {
    const result = normalizePreferences({
      theme: 'dark',
      favoriteCategory: '  comida ',
      dashboardCards: [{ id: 'categories', visible: false }, 'garbage', { id: 'nope', visible: true }],
    });
    expect(result.theme).toBe('dark');
    expect(result.favoriteCategory).toBe('comida');
    expect(result.dashboardCards.map(card => card.id)).toEqual(['categories', 'upcoming-bills', 'month-summary', 'recent-entries']);
    expect(result.dashboardCards[0]).toEqual({ id: 'categories', visible: false });
  });

  it('drops duplicate cards, keeping the first position and visibility', () => {
    const result = normalizePreferences({
      dashboardCards: [
        { id: 'recent-entries', visible: false },
        { id: 'recent-entries', visible: true },
      ],
    });
    expect(result.dashboardCards.filter(card => card.id === 'recent-entries')).toEqual([{ id: 'recent-entries', visible: false }]);
    expect(result.dashboardCards).toHaveLength(DASHBOARD_CARD_IDS.length);
  });

  it('defaults missing or non-boolean visibility to visible', () => {
    const result = normalizePreferences({ dashboardCards: [{ id: 'categories' }, { id: 'month-summary', visible: 'no' }] });
    expect(result.dashboardCards.slice(0, 2)).toEqual([
      { id: 'categories', visible: true },
      { id: 'month-summary', visible: true },
    ]);
  });

  it('rejects unknown themes and unusable favourite categories', () => {
    expect(normalizePreferences({ theme: 'sepia' }).theme).toBe('system');
    expect(normalizePreferences({ favoriteCategory: '   ' }).favoriteCategory).toBeNull();
    expect(normalizePreferences({ favoriteCategory: 'x'.repeat(65) }).favoriteCategory).toBeNull();
    expect(normalizePreferences({ favoriteCategory: 'x'.repeat(64) }).favoriteCategory).toHaveLength(64);
    expect(normalizePreferences({ favoriteCategory: 7 }).favoriteCategory).toBeNull();
  });

  it('always yields a document accepted by the strict schema', () => {
    const messy = normalizePreferences({ theme: 'light', extra: 'ignored', dashboardCards: [{ id: 'categories', visible: false, extra: 1 }] });
    expect(preferencesSchema.safeParse(messy).success).toBe(true);
    expect(messy).not.toHaveProperty('extra');
  });
});

describe('preferencesSchema', () => {
  it('rejects documents the normaliser would repair', () => {
    const valid = defaultPreferences();
    expect(preferencesSchema.safeParse({ ...valid, theme: 'sepia' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...valid, dashboardCards: valid.dashboardCards.slice(1) }).success).toBe(false);
    const duplicated = [valid.dashboardCards[0]!, valid.dashboardCards[0]!, valid.dashboardCards[2]!, valid.dashboardCards[3]!];
    expect(preferencesSchema.safeParse({ ...valid, dashboardCards: duplicated }).success).toBe(false);
  });
});

describe('parsePreferences / serializePreferences', () => {
  it('treats missing storage as a clean first run', () => {
    expect(parsePreferences(null)).toEqual({ preferences: defaultPreferences(), recovered: false });
  });

  it('round-trips a customised document', () => {
    const custom = setFavoriteCategory(setTheme(moveCard(defaultPreferences(), 'recent-entries', 'up'), 'light'), 'saude');
    expect(parsePreferences(serializePreferences(custom))).toEqual({ preferences: custom, recovered: false });
  });

  it('reports unreadable text as recovered and falls back to defaults', () => {
    expect(parsePreferences('{not json')).toEqual({ preferences: defaultPreferences(), recovered: true });
  });

  it('normalises valid JSON that has the wrong shape without flagging recovery', () => {
    expect(parsePreferences('"text"')).toEqual({ preferences: defaultPreferences(), recovered: false });
  });
});

describe('arePreferencesEqual', () => {
  it('compares by content', () => {
    expect(arePreferencesEqual(defaultPreferences(), defaultPreferences())).toBe(true);
    expect(arePreferencesEqual(defaultPreferences(), setTheme(defaultPreferences(), 'dark'))).toBe(false);
  });
});

describe('updates', () => {
  it('sets theme and favourite category through normalisation', () => {
    expect(setTheme(defaultPreferences(), 'dark').theme).toBe('dark');
    expect(setFavoriteCategory(defaultPreferences(), ' lazer ').favoriteCategory).toBe('lazer');
    expect(setFavoriteCategory(setFavoriteCategory(defaultPreferences(), 'lazer'), null).favoriteCategory).toBeNull();
  });

  it('toggles card visibility without touching order or other cards', () => {
    const hidden = setCardVisible(defaultPreferences(), 'categories', false);
    expect(visibleCards(hidden)).toEqual(['upcoming-bills', 'month-summary', 'recent-entries']);
    expect(hidden.dashboardCards.map(card => card.id)).toEqual([...DASHBOARD_CARD_IDS]);
    expect(visibleCards(setCardVisible(hidden, 'categories', true))).toEqual([...DASHBOARD_CARD_IDS]);
  });

  it('moves cards one step and ignores impossible moves', () => {
    const base = defaultPreferences();
    expect(moveCard(base, 'month-summary', 'up').dashboardCards.map(card => card.id)).toEqual([
      'month-summary',
      'upcoming-bills',
      'categories',
      'recent-entries',
    ]);
    expect(moveCard(base, 'upcoming-bills', 'down').dashboardCards[1]!.id).toBe('upcoming-bills');
    expect(moveCard(base, 'upcoming-bills', 'up')).toBe(base);
    expect(moveCard(base, 'recent-entries', 'down')).toBe(base);
    expect(moveCard({ ...base, dashboardCards: [] }, 'categories', 'up').dashboardCards).toEqual([]);
  });

  it('keeps hidden cards in the order when listing visible ones', () => {
    const moved = setCardVisible(moveCard(defaultPreferences(), 'categories', 'up'), 'upcoming-bills', false);
    expect(visibleCards(moved)).toEqual(['categories', 'month-summary', 'recent-entries']);
  });
});
