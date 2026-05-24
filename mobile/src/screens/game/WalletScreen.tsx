import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import { getWallet, getTransactions, WalletData, Transaction } from '../../api/game';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(amount: number): string {
  const abs = Math.abs(amount / 100);
  return `${amount >= 0 ? '+' : '-'}$${abs.toFixed(2)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function txIcon(type: string): { name: string; color: string } {
  switch (type) {
    case 'buyin':        return { name: 'enter-outline',     color: colors.primary };
    case 'attack_win':   return { name: 'flash',             color: colors.gold };
    case 'attack_loss':  return { name: 'alert-circle',      color: colors.secondary };
    case 'withdrawal':   return { name: 'arrow-up-circle',   color: colors.warning };
    case 'deposit':      return { name: 'arrow-down-circle', color: colors.success };
    case 'shield':       return { name: 'shield',            color: colors.primary };
    case 'coin_collect': return { name: 'logo-bitcoin',      color: colors.gold };
    case 'salvage':      return { name: 'wallet-outline',    color: colors.success };
    default:             return { name: 'swap-horizontal',   color: colors.textSecondary };
  }
}

// ---------------------------------------------------------------------------
// Mock transactions (used as fallback / seeded UI)
// ---------------------------------------------------------------------------
const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 'm1',
    type: 'attack_win',
    amount: 500,
    description: 'Stole 5 coins from hunter_x',
    relatedUserId: null,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: 'm2',
    type: 'buyin',
    amount: -1000,
    description: 'Buy-in: $10 Bronze tier',
    relatedUserId: null,
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
  },
  {
    id: 'm3',
    type: 'attack_loss',
    amount: -200,
    description: 'Lost coins to shadow99',
    relatedUserId: null,
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WalletScreen() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, txs] = await Promise.all([getWallet(), getTransactions()]);
      setWallet(w);
      setTransactions(txs.length > 0 ? txs : MOCK_TRANSACTIONS);
    } catch {
      setTransactions(MOCK_TRANSACTIONS);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleCashOut = () => {
    Alert.alert('Cash Out', 'Withdrawal feature coming soon! You will be able to withdraw via PayPal or crypto.', [
      { text: 'OK' },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const balance = wallet?.balance ?? 0;
  const balanceDollars = (balance / 100).toFixed(2);

  const listHeader = (
    <>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>
        <Text style={styles.balanceAmount}>${balanceDollars}</Text>
        <Text style={styles.balanceSub}>{Math.floor(balance / 10)} coins</Text>

        <TouchableOpacity style={styles.cashOutBtn} onPress={handleCashOut} activeOpacity={0.85}>
          <Ionicons name="arrow-up-circle" size={18} color={colors.background} />
          <Text style={styles.cashOutText}>CASH OUT</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Ionicons name="flash" size={18} color={colors.gold} />
          <Text style={styles.statValue}>
            {transactions.filter((t) => t.type === 'attack_win').length}
          </Text>
          <Text style={styles.statLabel}>WINS</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="alert-circle" size={18} color={colors.secondary} />
          <Text style={styles.statValue}>
            {transactions.filter((t) => t.type === 'attack_loss').length}
          </Text>
          <Text style={styles.statLabel}>LOSSES</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="enter-outline" size={18} color={colors.primary} />
          <Text style={styles.statValue}>
            {transactions.filter((t) => t.type === 'buyin').length}
          </Text>
          <Text style={styles.statLabel}>SESSIONS</Text>
        </View>
      </View>

      <View style={styles.txSection}>
        <Text style={styles.txHeader}>TRANSACTION HISTORY</Text>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={transactions}
        ListHeaderComponent={listHeader}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        renderItem={({ item }) => {
          const icon = txIcon(item.type);
          const isPositive = item.amount > 0;
          return (
            <View style={styles.txItem}>
              <View style={[styles.txIcon, { backgroundColor: icon.color + '20' }]}>
                <Ionicons name={icon.name as any} size={20} color={icon.color} />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txDesc}>{item.description}</Text>
                <Text style={styles.txDate}>{formatDate(item.createdAt)}</Text>
              </View>
              <Text style={[styles.txAmount, { color: isPositive ? colors.success : colors.error }]}>
                {formatAmount(item.amount)}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="wallet-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No transactions yet</Text>
            <Text style={styles.emptySub}>Start hunting to earn coins!</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceCard: {
    backgroundColor: colors.surface,
    margin: spacing.md,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  balanceLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 3,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  balanceAmount: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -1,
  },
  balanceSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  cashOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  cashOutText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: fontSize.md,
    letterSpacing: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: '900',
    color: colors.text,
  },
  statLabel: {
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: 1,
    fontWeight: '700',
  },
  txSection: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  txHeader: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 3,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  txIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txDesc: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  txDate: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  txAmount: {
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
