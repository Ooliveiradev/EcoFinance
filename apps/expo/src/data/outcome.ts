import type { SubmitOutcome } from './outbox';

export type NoticeState = { message: string; tone: 'ok' | 'warning' | 'danger' };
export const NO_NOTICE: NoticeState = { message: '', tone: 'ok' };
/** What the person is told after a save: synced, pending on this device, or needing a decision. */
export function outcomeMessage(outcome: SubmitOutcome): NoticeState {
  if (outcome.status === 'synced') return { message: 'Salvo e sincronizado.', tone: 'ok' };
  if (outcome.status === 'pending') return {
    message: outcome.reason === 'expired'
      ? 'Sessão expirada: a alteração ficou pendente neste aparelho e será enviada depois que você entrar novamente.'
      : 'Sem conexão: a alteração ficou pendente neste aparelho e será enviada ao reconectar.',
    tone: 'warning',
  };
  if (outcome.status === 'conflict') return { message: `${outcome.message} Resolva em Mais › Pendências.`, tone: 'danger' };
  return { message: outcome.message, tone: 'danger' };
}
