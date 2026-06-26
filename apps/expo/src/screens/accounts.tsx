import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { PluggyConnect } from 'react-native-pluggy-connect';

// Endereço base da API do backend Next.js. No emulador Android, 10.0.2.2 aponta para o localhost da máquina.
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000';

export function AccountsScreen() {
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // 1. Gera o Connect Token no backend
  const handleConnectBank = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/pluggy/token`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });

      if (!response.ok) {
        throw new Error(`Erro na API: ${response.status}`);
      }

      const data = await response.json();
      if (data.accessToken) {
        setConnectToken(data.accessToken);
      } else {
        throw new Error('Token não retornado pela API');
      }
    } catch (error) {
      console.error('Erro ao buscar connect token:', error);
      Alert.alert('Erro', 'Não foi possível iniciar a conexão com o banco. Verifique se o backend está rodando.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Lida com o Sucesso do Widget do Pluggy
  const handlePluggySuccess = async (itemData: any) => {
    setConnectToken(null); // Fecha o widget
    setIsSyncing(true);

    try {
      // O itemId é o identificador único da conexão que o usuário acabou de criar
      const itemId = itemData?.item?.id;
      
      if (!itemId) {
        throw new Error('ID do item não encontrado na resposta do Pluggy');
      }

      // Chama nossa API para sincronizar as contas usando esse itemId
      const response = await fetch(`${API_URL}/api/pluggy/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret-key': process.env.EXPO_PUBLIC_API_SECRET || ''
        },
        body: JSON.stringify({ itemId }),
      });

      if (!response.ok) {
        throw new Error(`Erro na sincronização: ${response.status}`);
      }

      const syncResult = await response.json();
      Alert.alert('Sucesso!', `Banco conectado e ${syncResult.synced || 0} contas sincronizadas.`);
      // TODO: Buscar contas salvas no banco para atualizar a interface
    } catch (error) {
      console.error('Erro ao sincronizar contas:', error);
      Alert.alert('Erro', 'O banco foi conectado, mas houve um erro ao sincronizar as contas no nosso servidor.');
    } finally {
      setIsSyncing(false);
    }
  };

  // 3. Renderiza o Widget se houver token
  if (connectToken) {
    return (
      <View style={{ flex: 1, backgroundColor: '#020617', width: '100%', height: '100%' }}>
        <PluggyConnect
          connectToken={connectToken}
          includeSandbox={true}
          onSuccess={handlePluggySuccess}
          onError={(error: any) => {
            console.error('Pluggy Connect Error:', error);
            Alert.alert('Erro de Conexão', 'Houve um problema ao conectar com seu banco.');
            setConnectToken(null);
          }}
          onClose={() => {
            setConnectToken(null);
          }}
        />
      </View>
    );
  }

  // 4. Tela Padrão de Contas
  return (
    <View style={styles.container}>
      {isSyncing ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={styles.syncText}>Sincronizando suas contas...</Text>
          <Text style={styles.syncSubtext}>Isso pode levar alguns segundos.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.title}>Suas Contas</Text>
          <Text style={styles.subtitle}>
            Conecte seu banco via Pluggy para visualizar seus saldos e sincronizar transações.
          </Text>
          
          <TouchableOpacity 
            style={[styles.button, isLoading && styles.buttonDisabled]} 
            onPress={handleConnectBank}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Conectar Banco (Pluggy)</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#020617',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center'
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { 
    color: '#f8fafc', 
    fontSize: 24, 
    fontWeight: 'bold', 
    marginBottom: 8 
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  syncText: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
  },
  syncSubtext: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 8,
  },
  button: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#059669',
    opacity: 0.7,
  },
  buttonText: { 
    color: '#fff', 
    fontWeight: '700', 
    fontSize: 16 
  },
});
