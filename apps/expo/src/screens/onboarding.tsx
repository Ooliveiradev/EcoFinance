import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PluggyConnect } from 'react-native-pluggy-connect';
import { Logo } from '../components/Logo';

// expo-intent-launcher — carregado dinamicamente para não quebrar se o módulo nativo não estiver linkado
let IntentLauncher: any = null;
try {
  IntentLauncher = require('expo-intent-launcher');
} catch {
  // módulo não disponível, usará Linking como fallback
}


const { width, height } = Dimensions.get('window');
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000';

export const ONBOARDING_KEY = '@ecofinance_onboarded';

interface OnboardingProps {
  onComplete: () => void;
}

// ─── Slide 2: Animated Map Pin ───────────────────────────────────────────────
function AnimatedMapPin() {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <View style={mapStyles.container}>
      {/* Fake dark map grid */}
      <View style={mapStyles.map}>
        {[...Array(5)].map((_, i) => (
          <View key={`h${i}`} style={[mapStyles.gridLine, mapStyles.hLine, { top: `${20 * (i + 1)}%` as any }]} />
        ))}
        {[...Array(5)].map((_, i) => (
          <View key={`v${i}`} style={[mapStyles.gridLine, mapStyles.vLine, { left: `${20 * (i + 1)}%` as any }]} />
        ))}
        {/* Pulse ring */}
        <View style={mapStyles.pinContainer}>
          <Animated.View
            style={[mapStyles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
          />
          {/* Pin body */}
          <View style={mapStyles.pin}>
            <Text style={mapStyles.pinEmoji}>📍</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const mapStyles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', marginVertical: 24 },
  map: {
    width: 240,
    height: 200,
    backgroundColor: '#0a1628',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e3a5f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLine: { position: 'absolute', backgroundColor: '#1e3a5f' },
  hLine: { width: '100%', height: 1 },
  vLine: { height: '100%', width: 1 },
  pinContainer: { alignItems: 'center', justifyContent: 'center', width: 80, height: 80 },
  pulseRing: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#10b981',
  },
  pin: { zIndex: 10 },
  pinEmoji: { fontSize: 36 },
});

// ─── Slide 3: Notification simulation ────────────────────────────────────────
function NotificationSimulation() {
  const slideAnim = useRef(new Animated.Value(-60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const transformAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const seq = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.parallel([
          Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
        Animated.delay(1500),
        Animated.timing(transformAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.parallel([
          Animated.timing(slideAnim, { toValue: -60, duration: 400, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(transformAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    seq.start();
    return () => seq.stop();
  }, [slideAnim, opacityAnim, transformAnim]);

  const bgColor = transformAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(15,23,42,0.95)', 'rgba(6,30,15,0.97)'],
  });

  const borderColor = transformAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(51,65,85,1)', 'rgba(16,185,129,0.8)'],
  });

  return (
    <View style={notifStyles.container}>
      <Animated.View
        style={[
          notifStyles.notification,
          {
            transform: [{ translateY: slideAnim }],
            opacity: opacityAnim,
            backgroundColor: bgColor,
            borderColor,
          },
        ]}
      >
        {/* Raw notification */}
        <Animated.View style={{ opacity: transformAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0, 0] }) }}>
          <View style={notifStyles.row}>
            <Text style={notifStyles.notifIcon}>🟣</Text>
            <View>
              <Text style={notifStyles.notifTitle}>Nubank</Text>
              <Text style={notifStyles.notifBody}>Compra de R$35,00 no iFood</Text>
            </View>
          </View>
        </Animated.View>

        {/* Transformed record */}
        <Animated.View
          style={[
            notifStyles.record,
            { opacity: transformAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] }) },
          ]}
        >
          <View style={notifStyles.row}>
            <View style={notifStyles.greenDot} />
            <View>
              <Text style={notifStyles.recordTitle}>🍔 Alimentação • iFood</Text>
              <Text style={notifStyles.recordAmount}>- R$ 35,00</Text>
            </View>
            <Text style={notifStyles.recordBadge}>✓ Salvo</Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const notifStyles = StyleSheet.create({
  container: { alignItems: 'center', marginVertical: 24 },
  notification: {
    width: width * 0.82,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    minHeight: 72,
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  notifIcon: { fontSize: 24 },
  notifTitle: { color: '#cbd5e1', fontSize: 13, fontWeight: '700' },
  notifBody: { color: '#94a3b8', fontSize: 14, marginTop: 2 },
  record: { position: 'absolute', width: '100%', paddingHorizontal: 16 },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10b981' },
  recordTitle: { color: '#10b981', fontSize: 13, fontWeight: '700' },
  recordAmount: { color: '#f43f5e', fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  recordBadge: { marginLeft: 'auto', color: '#10b981', fontSize: 12, fontWeight: '700' },
});

// ─── Slide 4: Shield Visual ───────────────────────────────────────────────────
function ShieldVisual() {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ]),
    );
    glow.start();
    return () => glow.stop();
  }, [glowAnim]);

  const shadowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] });

  return (
    <View style={shieldStyles.container}>
      <Animated.View style={[shieldStyles.shield, { shadowOpacity }]}>
        <Text style={shieldStyles.shieldEmoji}>🛡️</Text>
        <View style={shieldStyles.statusBadge}>
          <View style={shieldStyles.statusDot} />
          <Text style={shieldStyles.statusText}>Aguardando Conexão...</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const shieldStyles = StyleSheet.create({
  container: { alignItems: 'center', marginVertical: 28 },
  shield: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 32,
    borderWidth: 1,
    borderColor: '#10b981',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 20,
    elevation: 12,
  },
  shieldEmoji: { fontSize: 64 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: '#020617',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f59e0b' },
  statusText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
});

// ─── Main Onboarding Component ────────────────────────────────────────────────
export function OnboardingScreen({ onComplete }: OnboardingProps) {
  const [slide, setSlide] = useState(0);
  const [locationLoading, setLocationLoading] = useState(false);
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const goToSlide = (next: number) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setSlide(next), 200);
  };

  // Slide 2: GPS permission
  const handleGpsPermission = async () => {
    setLocationLoading(true);
    try {
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') {
        Alert.alert('Permissão Necessária', 'A localização em primeiro plano é necessária para o mapeamento de gastos.');
        return;
      }
      // Ask background after foreground is granted
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') {
        Alert.alert(
          'Localização em Segundo Plano',
          'Para capturar o local das compras mesmo com o app fechado, ative "Sempre" nas configurações de localização. Você pode fazer isso depois em Opções.',
        );
      }
      goToSlide(2);
    } finally {
      setLocationLoading(false);
    }
  };

  // Slide 3: Open notification listener settings
  const handleOpenNotificationSettings = () => {
    if (Platform.OS === 'android') {
      const opened = (() => {
        try {
          if (IntentLauncher?.startActivityAsync && IntentLauncher?.ActivityAction?.NOTIFICATION_LISTENER_SETTINGS) {
            IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.NOTIFICATION_LISTENER_SETTINGS,
            );
            return true;
          }
        } catch {}
        return false;
      })();
      if (!opened) {
        Linking.openSettings().catch(() => {});
      }
    } else {
      Linking.openSettings().catch(() => {});
    }
    // Move to next slide after a short delay (user will come back manually)
    setTimeout(() => goToSlide(3), 1000);
  };

  // Slide 4: Get Pluggy connect token
  const handleConnectBank = async () => {
    setTokenLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/pluggy/token`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (!data.accessToken) throw new Error('Token ausente');
      setConnectToken(data.accessToken);
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível iniciar a conexão. Verifique se o backend está rodando.');
    } finally {
      setTokenLoading(false);
    }
  };

  // Slide 4: Pluggy success → unlock app
  const handlePluggySuccess = async (itemData: any) => {
    setConnectToken(null);
    const itemId = itemData?.item?.id;
    if (itemId) {
      // Fire-and-forget sync in background
      fetch(`${API_URL}/api/pluggy/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret-key': process.env.EXPO_PUBLIC_API_SECRET || '' },
        body: JSON.stringify({ itemId }),
      }).catch(() => {});
    }
    await AsyncStorage.setItem(ONBOARDING_KEY, 'done');
    onComplete();
  };

  // Slide 4: Pluggy widget open
  if (slide === 3 && connectToken) {
    return (
      <View style={{ flex: 1, backgroundColor: '#020617' }}>
        <PluggyConnect
          connectToken={connectToken}
          includeSandbox
          onSuccess={handlePluggySuccess}
          onError={(err: any) => {
            console.error('Pluggy error:', err);
            setConnectToken(null);
            Alert.alert('Erro de Conexão', err?.message || 'Falha ao conectar ao banco.');
          }}
          onClose={() => setConnectToken(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Progress dots */}
      <View style={styles.dots}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i === slide && styles.dotActive]} />
        ))}
      </View>

      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {/* ── Slide 0: Apresentação ── */}
        {slide === 0 && (
          <View style={styles.slide}>
            <View style={styles.logoContainer}>
              <Logo size={130} animate />
            </View>
            <Text style={styles.appName}>EcoFinance</Text>
            <Text style={styles.title}>Seus dados financeiros.</Text>
            <Text style={[styles.title, { color: '#10b981' }]}>Sob o seu controle.</Text>
            <Text style={styles.body}>
              O EcoFinance é um organizador pessoal que roda de forma totalmente segura e integrada ao seu celular. Sem servidores de terceiros lendo suas informações e sem rastreadores comerciais.
            </Text>
            <TouchableOpacity style={styles.button} onPress={() => goToSlide(1)}>
              <Text style={styles.buttonText}>Começar Configuração →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Slide 1: GPS ── */}
        {slide === 1 && (
          <View style={styles.slide}>
            <Text style={styles.stepLabel}>PASSO 1 DE 3</Text>
            <Text style={styles.title}>Mapeamento{'\n'}Geográfico</Text>
            <AnimatedMapPin />
            <Text style={styles.body}>
              Para que o EcoFinance saiba onde cada centavo foi gasto, precisamos de acesso à geolocalização. Sempre que uma notificação de compra chegar, salvaremos as coordenadas exatas no seu mapa de transações.
            </Text>
            <TouchableOpacity
              style={[styles.button, locationLoading && styles.buttonDisabled]}
              onPress={handleGpsPermission}
              disabled={locationLoading}
            >
              {locationLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>📍 Permitir GPS</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipButton} onPress={() => goToSlide(2)}>
              <Text style={styles.skipText}>Pular por agora</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Slide 2: Notificações ── */}
        {slide === 2 && (
          <View style={styles.slide}>
            <Text style={styles.stepLabel}>PASSO 2 DE 3</Text>
            <Text style={styles.title}>Captura em{'\n'}Tempo Real</Text>
            <NotificationSimulation />
            <Text style={styles.body}>
              O EcoFinance lê as notificações da barra de status do Android para registrar despesas na hora em que você passa o cartão. Conceda o "Acesso a Notificações" e ative a chave ao lado de EcoFinance.
            </Text>
            <TouchableOpacity style={styles.button} onPress={handleOpenNotificationSettings}>
              <Text style={styles.buttonText}>🔔 Ativar Escuta Ativa</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipButton} onPress={() => goToSlide(3)}>
              <Text style={styles.skipText}>Pular por agora</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Slide 3: Conexão bancária (BLOQUEIO) ── */}
        {slide === 3 && (
          <View style={styles.slide}>
            <Text style={styles.stepLabel}>PASSO FINAL</Text>
            <Text style={styles.title}>Sua Chave{'\n'}de Entrada</Text>
            <ShieldVisual />
            <Text style={styles.body}>
              Para acessar o seu painel, conecte sua conta bancária principal via Open Finance. Coletamos apenas dados de leitura do seu extrato, de forma gratuita e segura.
            </Text>
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>🔒 Esta etapa é obrigatória para usar o app</Text>
            </View>
            <TouchableOpacity
              style={[styles.button, tokenLoading && styles.buttonDisabled]}
              onPress={handleConnectBank}
              disabled={tokenLoading}
            >
              {tokenLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>🏦 Conectar Conta Bancária</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    paddingTop: 56,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1e293b',
  },
  dotActive: {
    backgroundColor: '#10b981',
    width: 24,
  },
  content: {
    flex: 1,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  logoContainer: {
    marginBottom: 16,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 10,
  },
  appName: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 4,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  stepLabel: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  title: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 36,
    marginBottom: 8,
  },
  body: {
    color: '#94a3b8',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#10b981',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  skipButton: {
    marginTop: 16,
    padding: 8,
  },
  skipText: {
    color: '#475569',
    fontSize: 14,
  },
  warningBox: {
    backgroundColor: '#1c1008',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  warningText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
  },
});
