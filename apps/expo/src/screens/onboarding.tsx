import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logo } from '../components/Logo';

export const ONBOARDING_KEY = '@ecofinance_onboarded';

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function continueToLogin() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'done');
      onComplete();
    } catch { setError('Não foi possível salvar a configuração. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <View style={styles.container}>
    <Logo size={100} />
    <Text style={styles.title}>Bem-vindo ao EcoFinance</Text>
    <Text style={styles.body}>Entre com o endereço do seu servidor, email e senha. O operador da instalação pode criar ou recuperar seu acesso.</Text>
    <Text style={styles.body}>Gerencie o mês, lançamentos, planejamento, cartões e importações direto no aparelho. O app não pede localização nem leitura de notificações; sem conexão, mostra a última cópia salva e guarda suas alterações como pendentes.</Text>
    <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={continueToLogin} disabled={busy}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continuar para o login</Text>}
    </TouchableOpacity>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', justifyContent: 'center', alignItems: 'center', padding: 28, gap: 24 },
  title: { color: '#f8fafc', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  body: { color: '#cbd5e1', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  button: { backgroundColor: '#047857', padding: 16, borderRadius: 12, alignSelf: 'stretch', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#fda4af', fontSize: 16 },
});
