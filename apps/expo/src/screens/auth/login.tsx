import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { signIn } from '../../services/backend-config';

export function LoginScreen({ onComplete, notice = '' }: { onComplete: () => void | Promise<void>; notice?: string }) {
  const [url, setUrl] = useState(process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login() {
    if (busy) return;
    setBusy(true); setError('');
    try { await signIn(url, email, password); setPassword(''); await onComplete(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Entrar no EcoFinance</Text>
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    <Text style={styles.label}>Servidor</Text>
    <TextInput accessibilityLabel="Servidor" style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" editable={!busy} />
    <Text style={styles.label}>Email</Text>
    <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="username" maxLength={254} editable={!busy} />
    <Text style={styles.label}>Senha</Text>
    <TextInput accessibilityLabel="Senha" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" maxLength={128} editable={!busy} />
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={login} style={styles.button}><Text style={styles.label}>{busy ? 'Entrando…' : 'Entrar'}</Text></Pressable>
    {error ? <Text accessibilityRole="alert" style={styles.label}>{error}</Text> : null}
    <View><Text style={styles.label}>Senha esquecida? O operador pode recuperar seu acesso e revogar as sessões sem serviço pago.</Text></View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', backgroundColor: '#020617', padding: 24, gap: 12 },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  label: { color: '#f8fafc', fontSize: 16 },
  notice: { color: '#fbbf24', fontSize: 16 },
  input: { borderWidth: 1, borderColor: '#64748b', backgroundColor: '#0f172a', color: '#fff', borderRadius: 8, padding: 12 },
  button: { backgroundColor: '#047857', alignItems: 'center', borderRadius: 8, padding: 16 },
});
