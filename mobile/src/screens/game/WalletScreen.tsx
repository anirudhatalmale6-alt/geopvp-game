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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import { getWallet, getTransactions, redeemSweepCoins, WalletData, Transaction } from '../../api/game';

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
    case 'coin_collect': return { name: 'cash-outline',       color: colors.gold };
    case 'salvage':      return { name: 'wallet-outline',    color: colors.success };
    case 'bonus_sweep':  return { name: 'gift-outline',      color: colors.success };
    case 'daily_bonus':  return { name: 'sunny-outline',     color: '#ffd700' };
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
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemMethod, setRedeemMethod] = useState<'paypal' | 'venmo'>('paypal');
  const [redeemRecipient, setRedeemRecipient] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

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
    const balance = wallet?.sweepBalance ?? 0;
    if (balance < 100) {
      Alert.alert('Insufficient Balance', 'You need at least $1.00 in sweep coins to redeem. Keep winning attacks to earn more!');
      return;
    }
    setRedeemRecipient('');
    setRedeemAmount('');
    setRedeemError(null);
    setShowRedeem(true);
  };

  const handleRedeemSubmit = async () => {
    const recipient = redeemRecipient.trim();
    if (!recipient) {
      setRedeemError(redeemMethod === 'venmo'
        ? 'Please enter your Venmo email or phone number.'
        : 'Please enter your PayPal email address.');
      return;
    }
    const isPhone = /^\+?\d[\d\s()-]{8,}$/.test(recipient);
    if (!isPhone && !recipient.includes('@')) {
      setRedeemError('Please enter a valid email address or phone number.');
      return;
    }
    const dollars = parseFloat(redeemAmount);
    if (isNaN(dollars) || dollars < 1) {
      setRedeemError('Minimum redemption is $1.00.');
      return;
    }
    const cents = Math.round(dollars * 100);
    const balance = wallet?.sweepBalance ?? 0;
    if (cents > balance) {
      setRedeemError(`You only have $${(balance / 100).toFixed(2)} available.`);
      return;
    }

    setRedeeming(true);
    setRedeemError(null);
    try {
      const result = await redeemSweepCoins(recipient, cents, redeemMethod);
      setShowRedeem(false);
      Alert.alert('Redemption Successful', result.message);
      await load();
    } catch (err: any) {
      setRedeemError(err.message || 'Redemption failed. Please try again.');
    } finally {
      setRedeeming(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const sweepBalance = wallet?.sweepBalance ?? wallet?.balance ?? 0;
  const prowlBalance = wallet?.prowlBalance ?? 0;
  const sweepDollars = (Math.max(0, sweepBalance) / 100).toFixed(2);

  const listHeader = (
    <>
      {/* Dual Currency Cards */}
      <View style={styles.dualBalanceRow}>
        <View style={[styles.currencyCard, { borderColor: '#ffd700' + '40' }]}>
          <View style={styles.currencyHeader}>
            <Ionicons name="trophy" size={16} color="#ffd700" />
            <Text style={[styles.currencyLabel, { color: '#ffd700' }]}>PROWL COINS</Text>
          </View>
          <Text style={styles.currencyAmount} numberOfLines={1} adjustsFontSizeToFit>{prowlBalance}</Text>
          <Text style={styles.currencySub}>Rank Score</Text>
        </View>
        <View style={[styles.currencyCard, { borderColor: colors.success + '40' }]}>
          <View style={styles.currencyHeader}>
            <Ionicons name="cash" size={16} color={colors.success} />
            <Text style={[styles.currencyLabel, { color: colors.success }]}>SWEEP COINS</Text>
          </View>
          <Text style={styles.currencyAmount} numberOfLines={1} adjustsFontSizeToFit>${sweepDollars}</Text>
          <Text style={styles.currencySub}>Redeemable</Text>
        </View>
      </View>

      {/* Action Button */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.cashOutBtn} onPress={handleCashOut} activeOpacity={0.85}>
          <Ionicons name="arrow-up-circle" size={18} color={colors.background} />
          <Text style={styles.cashOutText}>REDEEM SWEEP COINS</Text>
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
          const hideDollar = item.type === 'attack_loss' || item.type === 'shield';
          return (
            <View style={styles.txItem}>
              <View style={[styles.txIcon, { backgroundColor: icon.color + '20' }]}>
                <Ionicons name={icon.name as any} size={20} color={icon.color} />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txDesc}>{item.description}</Text>
                <Text style={styles.txDate}>{formatDate(item.createdAt)}</Text>
              </View>
              {!hideDollar && (
                <Text style={[styles.txAmount, { color: isPositive ? colors.success : colors.error }]}>
                  {formatAmount(item.amount)}
                </Text>
              )}
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

      {/* Redemption Modal */}
      <Modal visible={showRedeem} transparent animationType="fade" onRequestClose={() => setShowRedeem(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={[styles.modalIcon, { backgroundColor: colors.success + '20' }]}>
                  <Ionicons name="cash" size={20} color={colors.success} />
                </View>
                <Text style={styles.modalTitle}>REDEEM</Text>
              </View>
              <TouchableOpacity onPress={() => setShowRedeem(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Available: ${(Math.max(0, wallet?.sweepBalance ?? 0) / 100).toFixed(2)} sweep coins
            </Text>

            {/* Method toggle */}
            <View style={styles.methodToggle}>
              <TouchableOpacity
                style={[styles.methodBtn, redeemMethod === 'paypal' && styles.methodBtnActive]}
                onPress={() => { setRedeemMethod('paypal'); setRedeemRecipient(''); }}
                activeOpacity={0.8}
              >
                <Ionicons name="logo-paypal" size={16} color={redeemMethod === 'paypal' ? colors.background : colors.textSecondary} />
                <Text style={[styles.methodBtnText, redeemMethod === 'paypal' && styles.methodBtnTextActive]}>PayPal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.methodBtn, redeemMethod === 'venmo' && styles.methodBtnActiveVenmo]}
                onPress={() => { setRedeemMethod('venmo'); setRedeemRecipient(''); }}
                activeOpacity={0.8}
              >
                <Ionicons name="phone-portrait-outline" size={16} color={redeemMethod === 'venmo' ? colors.background : colors.textSecondary} />
                <Text style={[styles.methodBtnText, redeemMethod === 'venmo' && styles.methodBtnTextActive]}>Venmo</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>
              {redeemMethod === 'venmo' ? 'VENMO EMAIL OR PHONE' : 'PAYPAL EMAIL'}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder={redeemMethod === 'venmo' ? 'email or phone number' : 'your@email.com'}
              placeholderTextColor={colors.textMuted}
              keyboardType={redeemMethod === 'venmo' ? 'default' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              value={redeemRecipient}
              onChangeText={setRedeemRecipient}
            />

            <Text style={styles.inputLabel}>AMOUNT (USD)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="10.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={redeemAmount}
              onChangeText={setRedeemAmount}
            />

            {redeemError && (
              <View style={styles.redeemErrorBox}>
                <Ionicons name="warning" size={14} color={colors.error} />
                <Text style={styles.redeemErrorText}>{redeemError}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.redeemBtn, redeeming && { opacity: 0.6 }]}
              onPress={handleRedeemSubmit}
              disabled={redeeming}
              activeOpacity={0.85}
            >
              {redeeming ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <>
                  <Ionicons name="send" size={16} color={colors.background} />
                  <Text style={styles.redeemBtnText}>
                    {redeemMethod === 'venmo' ? 'SEND TO VENMO' : 'SEND TO PAYPAL'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.redeemDisclaimer}>
              Funds will be sent to your PayPal email. Processing may take a few minutes. Minimum $1.00.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  dualBalanceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    margin: spacing.md,
  },
  currencyCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  currencyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  currencyLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  currencyAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -1,
  },
  currencySub: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  dailyBonusBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#ffd700',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  dailyBonusClaimed: {
    backgroundColor: colors.surfaceLight,
  },
  dailyBonusText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1,
  },
  cashOutBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cashOutText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.success + '40',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 2,
  },
  modalSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  methodToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  methodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodBtnActive: {
    backgroundColor: '#0070ba',
    borderColor: '#0070ba',
  },
  methodBtnActiveVenmo: {
    backgroundColor: '#3d95ce',
    borderColor: '#3d95ce',
  },
  methodBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  methodBtnTextActive: {
    color: colors.background,
  },
  inputLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 2,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  redeemErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondary + '15',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  redeemErrorText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.error,
  },
  redeemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.success,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  redeemBtnText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: fontSize.md,
    letterSpacing: 1,
  },
  redeemDisclaimer: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
