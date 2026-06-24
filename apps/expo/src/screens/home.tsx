import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';

export function HomeScreen({ navigation }: any) {
  const [listenerActive, setListenerActive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // In a real app, you would load these from local storage (e.g. AsyncStorage/SQLite)
  // Since the background task can't easily push to the UI directly, they share a store.
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);

  useEffect(() => {
    checkStatus();
    // Simulate loading data
    loadMockData();
  }, []);

  const checkStatus = async () => {
    const status = await RNAndroidNotificationListener.getPermissionStatus();
    setListenerActive(status === 'authorized');
  };

  const onRefresh = () => {
    setRefreshing(true);
    checkStatus();
    // load real data
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  const loadMockData = () => {
    setRecentTransactions([
      { id: '1', bank: 'Nubank', amount: -35.5, description: 'Starbucks', time: new Date().toISOString(), gps: true },
      { id: '2', bank: 'Itaú', amount: -120.0, description: 'Uber Trip', time: new Date(Date.now() - 3600000).toISOString(), gps: true },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statusCard}>
          <View style={[styles.indicator, { backgroundColor: listenerActive ? '#10b981' : '#f43f5e' }]} />
          <Text style={styles.statusText}>
            Escuta em Segundo Plano: {listenerActive ? 'Ativa' : 'Inativa'}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Capturas Recentes</Text>

      {recentTransactions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>Nenhuma transação capturada ainda.</Text>
          <Text style={styles.emptyStateSub}>As notificações de compra aparecerão aqui automaticamente.</Text>
        </View>
      ) : (
        <FlatList
          data={recentTransactions}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
          renderItem={({ item }) => (
            <View style={styles.transactionCard}>
              <View style={styles.row}>
                <Text style={styles.bankName}>{item.bank}</Text>
                <Text style={styles.amount}>R$ {Math.abs(item.amount).toFixed(2)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.description}>{item.description}</Text>
              </View>
              <View style={styles.rowFooter}>
                <Text style={styles.time}>{new Date(item.time).toLocaleTimeString('pt-BR')}</Text>
                {item.gps && <Text style={styles.gpsBadge}>📍 GPS</Text>}
              </View>
            </View>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617', // slate-950
  },
  header: {
    padding: 16,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  indicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  statusText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: 'bold',
    marginHorizontal: 16,
    marginBottom: 8,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  transactionCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 8,
  },
  bankName: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  amount: {
    color: '#f43f5e', // expenses are red
    fontSize: 16,
    fontWeight: 'bold',
  },
  description: {
    color: '#f1f5f9',
    fontSize: 14,
  },
  time: {
    color: '#64748b',
    fontSize: 12,
  },
  gpsBadge: {
    color: '#10b981',
    fontSize: 10,
    backgroundColor: '#064e3b', // emerald-900
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyStateText: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  emptyStateSub: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
  }
});
