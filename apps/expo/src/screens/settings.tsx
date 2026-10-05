import React, { useState } from 'react';
import { Text, ScrollView, Pressable, Alert } from 'react-native';
import { signOut } from '../services/backend-config';
export function SettingsScreen() {
  const [busy, setBusy] = useState(false);
  async function logout(all: boolean) {
    setBusy(true);
    try { await signOut(all); }
    catch { Alert.alert('Sessão', 'Não foi possível revogar o acesso no servidor. Reconecte e tente novamente.'); }
    finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={{ padding: 24, gap: 20, backgroundColor: '#020617', flexGrow: 1 }}>
    <Text style={{ color: '#fff', fontSize: 24 }}>Sessões de acesso</Text>
    <Text style={{ color: '#cbd5e1' }}>Cada login tem uma sessão revogável. Captura e conexão bancária legadas estão desativadas durante a migração.</Text>
    {[false, true].map(all => <Pressable key={String(all)} accessibilityRole="button" disabled={busy} onPress={() => logout(all)} style={{ backgroundColor: '#047857', padding: 16, borderRadius: 8 }}>
      <Text style={{ color: '#fff' }}>{all ? 'Sair de todos os dispositivos' : 'Sair deste dispositivo'}</Text>
    </Pressable>)}
  </ScrollView>;
}
