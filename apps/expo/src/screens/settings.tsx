import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { checkLocationPermission, requestLocationPermission } from '../services/location-service';
import { testConnection } from '../services/api-client';

export function SettingsScreen() {
  const [notificationStatus, setNotificationStatus] = useState<string>('unknown');
  const [locationStatus, setLocationStatus] = useState<string>('unknown');
  const [apiUrl, setApiUrl] = useState(process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000');
  const [apiSecret, setApiSecret] = useState(process.env.EXPO_PUBLIC_API_SECRET || '');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    const { status } = await Notifications.getPermissionsAsync();
    setNotificationStatus(status);

    const hasLocation = await checkLocationPermission();
    setLocationStatus(hasLocation ? 'granted' : 'denied');
  };

  const handleRequestNotification = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    setNotificationStatus(status);
    if (status !== 'granted') {
      Alert.alert('Atenção', 'Sem permissão de notificações, a captura automática não funcionará.');
    }
  };

  const handleRequestLocation = async () => {
    const granted = await requestLocationPermission();
    setLocationStatus(granted ? 'granted' : 'denied');
  };

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    const success = await testConnection(apiUrl, apiSecret);
    setConnectionStatus(success ? 'success' : 'error');
    if (success) {
      Alert.alert('Sucesso', 'Conexão com o backend estabelecida com sucesso!');
    } else {
      Alert.alert('Erro', 'Não foi possível conectar ao backend. Verifique a URL e a chave secreta.');
    }
  };

  const isGranted = (status: string) => status === 'granted';

  return (
    <ScrollView style={styles.container}>
      {/* Permissions Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Permissões</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notificações</Text>
          <Text style={styles.cardDescription}>
            Necessário para capturar as compras dos aplicativos bancários em tempo real.
          </Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status: </Text>
            <Text style={[styles.statusValue, isGranted(notificationStatus) ? styles.textSuccess : styles.textDanger]}>
              {isGranted(notificationStatus) ? 'Concedido ✓' : 'Pendente'}
            </Text>
          </View>
          {!isGranted(notificationStatus) && (
            <TouchableOpacity style={styles.button} onPress={handleRequestNotification}>
              <Text style={styles.buttonText}>Solicitar Permissão</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Localização (GPS)</Text>
          <Text style={styles.cardDescription}>
            Associa o local exato da compra no momento da notificação.
          </Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status: </Text>
            <Text style={[styles.statusValue, locationStatus === 'granted' ? styles.textSuccess : styles.textDanger]}>
              {locationStatus === 'granted' ? 'Concedido ✓' : 'Pendente'}
            </Text>
          </View>
          {locationStatus !== 'granted' && (
            <TouchableOpacity style={styles.button} onPress={handleRequestLocation}>
              <Text style={styles.buttonText}>Solicitar Permissão</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Backend Configuration */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Configuração do Backend</Text>
        <View style={styles.card}>
          <Text style={styles.label}>URL da API</Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="https://sua-api.com"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Chave Secreta (API_SECRET_KEY)</Text>
          <TextInput
            style={styles.input}
            value={apiSecret}
            onChangeText={setApiSecret}
            secureTextEntry
            placeholder="Sua chave secreta"
            placeholderTextColor="#64748b"
          />

          <TouchableOpacity
            style={[styles.button, styles.buttonBlue, { marginTop: 16 }]}
            onPress={handleTestConnection}
            disabled={connectionStatus === 'testing'}
          >
            <Text style={styles.buttonText}>
              {connectionStatus === 'testing' ? 'Testando...' : 'Testar Conexão'}
            </Text>
          </TouchableOpacity>

          {connectionStatus === 'success' && (
            <Text style={[styles.statusValue, styles.textSuccess, { textAlign: 'center', marginTop: 8 }]}>
              ✓ Backend conectado
            </Text>
          )}
          {connectionStatus === 'error' && (
            <Text style={[styles.statusValue, styles.textDanger, { textAlign: 'center', marginTop: 8 }]}>
              ✗ Falha na conexão
            </Text>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>EcoFinance App v1.0.0 — SDK 52</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  section: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#f8fafc', marginBottom: 12 },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f1f5f9', marginBottom: 4 },
  cardDescription: { fontSize: 13, color: '#94a3b8', marginBottom: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  statusLabel: { color: '#cbd5e1', fontSize: 14 },
  statusValue: { fontSize: 14, fontWeight: 'bold' },
  textSuccess: { color: '#10b981' },
  textDanger: { color: '#f43f5e' },
  button: { backgroundColor: '#10b981', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  buttonBlue: { backgroundColor: '#3b82f6' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  label: { color: '#cbd5e1', fontSize: 14, marginBottom: 8, marginTop: 8 },
  input: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#f8fafc',
    padding: 12,
    fontSize: 14,
  },
  footer: { padding: 24, alignItems: 'center' },
  footerText: { color: '#475569', fontSize: 12 },
});
