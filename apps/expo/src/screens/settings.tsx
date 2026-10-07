import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { forgetDevice, logout } from '../data/session';
import { useStack } from '../navigation';
import { useData } from '../ui/data-context';
import { Box, Button, ListItem, Muted, Notice, Screen, Title } from '../ui/kit';

export function MoreScreen() {
  const navigation = useStack();
  const { outbox } = useData();
  return <Screen>
    <View style={{ gap: 8 }}>
      <ListItem title="Contas e categorias" subtitle="Saldos, cadastro e arquivamento" onPress={() => navigation.navigate('References')} />
      <ListItem title="Importar arquivos" subtitle="Extratos e faturas com revisão antes de lançar" onPress={() => navigation.navigate('Imports')} />
      <ListItem title="Pendências de sincronização" subtitle={outbox.length ? `${outbox.length} alteração(ões) neste aparelho` : 'Tudo sincronizado'} onPress={() => navigation.navigate('Pending')} />
      <ListItem title="Sessão e privacidade" subtitle="Sair e apagar dados locais" onPress={() => navigation.navigate('Settings')} />
    </View>
  </Screen>;
}

export function SettingsScreen() {
  const { outbox } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function confirm(action: () => Promise<void>, title: string) {
    const warning = outbox.length ? `${outbox.length} alteração(ões) ainda não sincronizada(s) serão apagadas deste aparelho.` : 'Cache e rascunhos deste aparelho serão apagados.';
    Alert.alert(title, warning, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Sair', style: 'destructive', onPress: () => void run(action) }]);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); }
    catch { setError('Não foi possível revogar o acesso no servidor. Reconecte e tente de novo, ou use “Sair só deste aparelho”.'); }
    finally { setBusy(false); }
  }
  return <Screen>
    <Title>Sessões de acesso</Title>
    <Muted>Sua sessão fica no armazenamento seguro do aparelho. Ao sair, o cache de dados financeiros e os rascunhos locais são apagados.</Muted>
    <Button label="Sair deste dispositivo" disabled={busy} onPress={() => confirm(() => logout(false), 'Sair deste dispositivo?')} />
    <Button label="Sair de todos os dispositivos" variant="secondary" disabled={busy} onPress={() => confirm(() => logout(true), 'Sair de todos os dispositivos?')} />
    <Notice message={error} tone="danger" />
    {error ? <Box tone="warning">
      <Muted>Sem conexão, você pode apagar a sessão e os dados deste aparelho agora. A sessão no servidor continua válida até expirar ou ser revogada em outro dispositivo.</Muted>
      <Button label="Sair só deste aparelho" variant="danger" disabled={busy} onPress={() => confirm(forgetDevice, 'Sair sem contatar o servidor?')} />
    </Box> : null}
    <Muted>Captura de notificações, localização e conexão bancária paga foram removidas do aplicativo; nenhuma dessas permissões é solicitada.</Muted>
  </Screen>;
}
