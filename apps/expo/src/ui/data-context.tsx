import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { civilToday, currentMonthParam } from '@ecofinance/shared';
import { ApiError, toApiError } from '../data/api';
import { loadWithCache, type Loaded } from '../data/cache';
import { NO_NOTICE, outcomeMessage, type NoticeState } from '../data/outcome';
import { flush, listOutbox, onOutboxChange, OutboxBusy, submit, type Mutation, type OutboxItem, type SubmitOutcome } from '../data/outbox';

interface DataContextValue {
  userId: string;
  month: string;
  setMonth: (month: string) => void;
  today: string;
  outbox: OutboxItem[];
  /** Bumped after changes reach the server, so open screens re-read their data. */
  version: number;
  syncing: boolean;
  sync: () => Promise<void>;
  save: (mutation: Mutation, replaceId?: string) => Promise<SubmitOutcome>;
}
const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [month, setMonth] = useState(() => currentMonthParam(new Date()));
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const today = civilToday(new Date());

  useEffect(() => {
    let active = true;
    const refresh = () => { void listOutbox(userId).then(items => { if (active) setOutbox(items); }); };
    refresh();
    const unsubscribe = onOutboxChange(changed => { if (changed === userId) refresh(); });
    return () => { active = false; unsubscribe(); };
  }, [userId]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flush(userId);
      if (result.sent.size) setVersion(value => value + 1);
    } finally { setSyncing(false); }
  }, [userId]);

  // Reconnection: drafts are replayed on start and whenever the app returns to the foreground.
  useEffect(() => {
    void sync();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    return () => subscription.remove();
  }, [sync]);

  const save = useCallback(async (mutation: Mutation, replaceId?: string) => {
    let outcome: SubmitOutcome;
    try { outcome = await submit(userId, mutation, replaceId); }
    catch (error) {
      if (error instanceof OutboxBusy) return { status: 'rejected' as const, message: error.message };
      throw error;
    }
    if (outcome.status === 'synced') setVersion(value => value + 1);
    return outcome;
  }, [userId]);

  const value = useMemo(() => ({ userId, month, setMonth, today, outbox, version, syncing, sync, save }), [userId, month, today, outbox, version, syncing, sync, save]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error('DataProvider ausente.');
  return value;
}

/** Save through the outbox with a busy flag and the resulting message for the person. */
export function useSaver() {
  const { save } = useData();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(NO_NOTICE);
  const send = useCallback(async (mutation: Mutation, replaceId?: string) => {
    setBusy(true);
    try {
      const outcome = await save(mutation, replaceId);
      setNotice(outcomeMessage(outcome));
      return outcome;
    } finally { setBusy(false); }
  }, [save]);
  return { busy, notice, setNotice, send };
}

type ResourceState<T> = { name: string; loaded: Loaded<T> | null; error: ApiError | null };
/**
 * Loads `name` network first with the per-user cache fallback. `name` must
 * identify the request (e.g. `report.2026-10`); the fetcher may change identity.
 */
export function useResource<T>(name: string, fetcher: () => Promise<T>) {
  const { userId, version } = useData();
  const latest = useRef(fetcher);
  useEffect(() => { latest.current = fetcher; });
  const [state, setState] = useState<ResourceState<T>>({ name: '', loaded: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let active = true;
    loadWithCache(userId, name, () => latest.current())
      .then(loaded => { if (active) setState({ name, loaded, error: null }); })
      .catch(raw => {
        if (!active) return;
        let error: ApiError;
        try { error = toApiError(raw); } catch { error = new ApiError('unavailable', 'Falha inesperada ao carregar.'); }
        setState({ name, loaded: null, error });
      })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [userId, name, version, attempt]);
  const reload = useCallback(() => { setRefreshing(true); setAttempt(value => value + 1); }, []);
  const current = state.name === name ? state : null;
  return { loaded: current?.loaded ?? null, error: current?.error ?? null, loading: !current, refreshing, reload };
}
