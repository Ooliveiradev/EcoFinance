import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, Linking } from 'react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
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
    const notifStatus = await RNAndroidNotificationListener.getPermissionStatus();
    setNotificationStatus(notifStatus);

    const hasLocation = await checkLocationPermission();
    setLocationStatus(hasLocation ? 'granted' : 'denied');
  };

  const handleRequestNotification = async () => {
    RNAndroidNotificationListener.requestPermission();
    // Re-check after a delay since the user comes back from settings
    setTimeout(checkPermissions, 5000);
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
      Alert.alert('Sucesso', 'Conexão com o backend estabelecida.');
    } else {
      Alert.alert('Erro', 'Não foi possível conectar ao backend ou credenciais inválidas.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Permissões</Text>
        
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Leitura de Notificações</Text>
          <Text style={styles.cardDescription}>Necessário para capturar as compras dos aplicativos bancários em tempo real.</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status: </Text>
            <Text style={[styles.statusValue, notificationStatus === 'authorized' ? styles.textSuccess : styles.textDanger]}>
              {notificationStatus === 'authorized' ? 'Concedido' : 'Pendente'}
            </Text>
          </View>
          {notificationStatus !== 'authorized' && (
            <TouchableOpacity style={styles.button} onPress={handleRequestNotification}>
              <Text style={styles.buttonText}>Abrir Configurações do Android</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Localização (GPS)</Text>
          <Text style={styles.cardDescription}>Necessário para associar o local exato da compra no momento da notificação (em segundo plano).</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Status: </Text>
            <Text style={[styles.statusValue, locationStatus === 'granted' ? styles.textSuccess : styles.textDanger]}>
              {locationStatus === 'granted' ? 'Concedido' : 'Pendente'}
            </Text>
          </View>
          {locationStatus !== 'granted' && (
            <TouchableOpacity style={styles.button} onPress={handleRequestLocation}>
              <Text style={styles.buttonText}>Solicitar Permissão</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backend Configuration</Text>
        <View style={styles.card}>
          <Text style={styles.label}>API URL</Text>
          <TextInput 
            style={styles.input} 
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="https://sua-api.com"
            placeholderTextColor="#64748b"
          />
          
          <Text style={styles.label}>API Secret Key</Text>
          <TextInput 
            style={styles.input} 
            value={apiSecret}
            onChangeText={setApiSecret}
            secureTextEntry
            placeholder="Sua chave secreta"
            placeholderTextColor="#64748b"
          />
          
          <TouchableOpacity 
            style={[styles.button, styles.buttonSecondary, { marginTop: 16 }]} 
            onPress={handleTestConnection}
            disabled={connectionStatus === 'testing'}
          >
            <Text style={styles.buttonText}>
              {connectionStatus === 'testing' ? 'Testando...' : 'Testar Conexão'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>EcoFinance App v1.0.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617', // slate-950
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#0f172a', // slate-900
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e293b', // slate-800
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusLabel: {
    color: '#cbd5e1',
    fontSize: 14,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  textSuccess: {
    color: '#10b981', // emerald-500
  },
  textDanger: {
    color: '#f43f5e', // rose-500
  },
  button: {
    backgroundColor: '#10b981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#3b82f6', // blue-500
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 14,
    marginBottom: 8,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#f8fafc',
    padding: 12,
    fontSize: 14,
  },
  footer: {
    padding: 24,
    alignItems: 'center',
  },
  footerText: {
    color: '#475569', // slate-600
    fontSize: 12,
  }
});
