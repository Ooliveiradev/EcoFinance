import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { NOTIFICATION_HANDLER_TASK } from '../services/notification-handler';

interface CapturedTransaction {
  id: string;
  bank: string;
  amount: number;
  description: string;
  time: string;
  hasGPS: boolean;
}

export function HomeScreen({ navigation }: any) {
  const [taskActive, setTaskActive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [recentTransactions] = useState<CapturedTransaction[]>([]);

  useEffect(() => {
    checkTaskStatus();
  }, []);

  const checkTaskStatus = async () => {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(NOTIFICATION_HANDLER_TASK);
    setTaskActive(isRegistered);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await checkTaskStatus();
    setRefreshing(false);
  };

  const handleRequestPermission = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === 'granted') {
      Alert.alert('Sucesso', 'Permissão de notificações concedida! O app irá capturar compras automaticamente.');
      await checkTaskStatus();
    } else {
      Alert.alert('Atenção', 'Permissão negada. Sem isso, o app não consegue capturar transações automaticamente.');
    }
  };

  return (
    <View style={styles.container}>
      {/* Status Card */}
      <View style={styles.header}>
        <View style={styles.statusCard}>
          <View style={[styles.indicator, { backgroundColor: taskActive ? '#10b981' : '#f43f5e' }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusText}>
              Captura em Segundo Plano: {taskActive ? 'Ativa' : 'Inativa'}
            </Text>
            <Text style={styles.statusSub}>
              {taskActive
                ? 'As notificações bancárias serão capturadas automaticamente.'
                : 'Conceda permissão para ativar a captura automática.'}
            </Text>
          </View>
        </View>

        {!taskActive && (
          <TouchableOpacity style={styles.button} onPress={handleRequestPermission}>
            <Text style={styles.buttonText}>Ativar Captura Automática</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* How it works */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>💡 Como funciona</Text>
        <Text style={styles.infoText}>
          Quando você receber uma notificação de compra do seu banco (Nubank, Itaú, Inter, etc.),
          o aplicativo vai capturar automaticamente o valor, a descrição e o GPS, e enviar para
          o seu dashboard EcoFinance.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Capturas Recentes</Text>

      {recentTransactions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>Nenhuma captura ainda</Text>
          <Text style={styles.emptyStateSub}>
            As transações capturadas via notificação aparecerão aqui.
          </Text>
        </View>
      ) : (
        <FlatList
          data={recentTransactions}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.transactionCard}>
              <View style={styles.row}>
                <Text style={styles.bankName}>{item.bank}</Text>
                <Text style={[styles.amount, { color: item.amount < 0 ? '#f43f5e' : '#10b981' }]}>
                  R$ {Math.abs(item.amount).toFixed(2)}
                </Text>
              </View>
              <Text style={styles.description}>{item.description}</Text>
              <View style={styles.rowFooter}>
                <Text style={styles.time}>{new Date(item.time).toLocaleTimeString('pt-BR')}</Text>
                {item.hasGPS && <Text style={styles.gpsBadge}>📍 GPS</Text>}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617' },
  header: { padding: 16, gap: 12 },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  indicator: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  statusText: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  statusSub: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  button: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  infoCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
  },
  infoTitle: { color: '#f1f5f9', fontWeight: '600', marginBottom: 6 },
  infoText: { color: '#94a3b8', fontSize: 13, lineHeight: 20 },
  sectionTitle: { color: '#f8fafc', fontSize: 16, fontWeight: 'bold', marginHorizontal: 16, marginBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  transactionCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 8,
  },
  bankName: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  amount: { fontSize: 16, fontWeight: 'bold' },
  description: { color: '#f1f5f9', fontSize: 14 },
  time: { color: '#64748b', fontSize: 12 },
  gpsBadge: { color: '#10b981', fontSize: 11 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, marginTop: 32 },
  emptyStateText: { color: '#cbd5e1', fontSize: 16, fontWeight: '500', marginBottom: 8 },
  emptyStateSub: { color: '#64748b', fontSize: 13, textAlign: 'center' },
});
