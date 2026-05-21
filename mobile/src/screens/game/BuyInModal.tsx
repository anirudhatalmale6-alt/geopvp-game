import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import { createSession } from '../../api/game';

interface TierOption {
  dollars: number;
  coins: number;
  label: string;
  highlight?: boolean;
}

const TIERS: TierOption[] = [
  { dollars: 1,  coins: 10,  label: 'COPPER' },
  { dollars: 5,  coins: 50,  label: 'BRONZE', highlight: true },
  { dollars: 10, coins: 100, label: 'SILVER' },
  { dollars: 20, coins: 200, label: 'GOLD' },
];

interface BuyInModalProps {
  visible: boolean;
  onClose: () => void;
  onSessionCreated: () => void;
}

export default function BuyInModal({ visible, onClose, onSessionCreated }: BuyInModalProps) {
  const [selectedTier, setSelectedTier] = useState<TierOption>(TIERS[1]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBuyIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await createSession(selectedTier.dollars);
      onSessionCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to start session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIcon}>
                <Ionicons name="flash" size={20} color={colors.primary} />
              </View>
              <Text style={styles.title}>START HUNTING</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>Select your buy-in tier to enter the battlefield</Text>

          {/* Tier grid */}
          <View style={styles.tiersGrid}>
            {TIERS.map((tier) => {
              const isSelected = selectedTier.dollars === tier.dollars;
              return (
                <TouchableOpacity
                  key={tier.dollars}
                  style={[
                    styles.tierCard,
                    isSelected && styles.tierCardSelected,
                    tier.highlight && !isSelected && styles.tierCardHighlight,
                  ]}
                  onPress={() => setSelectedTier(tier)}
                  activeOpacity={0.8}
                >
                  {tier.highlight && (
                    <View style={styles.popularBadge}>
                      <Text style={styles.popularText}>POPULAR</Text>
                    </View>
                  )}
                  <Text style={[styles.tierLabel, isSelected && styles.tierLabelSelected]}>
                    {tier.label}
                  </Text>
                  <Text style={[styles.tierPrice, isSelected && styles.tierPriceSelected]}>
                    ${tier.dollars}
                  </Text>
                  <View style={styles.coinsRow}>
                    <Ionicons
                      name="logo-bitcoin"
                      size={14}
                      color={isSelected ? colors.gold : colors.textMuted}
                    />
                    <Text style={[styles.coinsText, isSelected && styles.coinsTextSelected]}>
                      {tier.coins} coins
                    </Text>
                  </View>
                  <View style={styles.shieldsRow}>
                    {[0, 1, 2].map((i) => (
                      <Ionicons
                        key={i}
                        name="shield"
                        size={12}
                        color={isSelected ? colors.primary : colors.textMuted}
                        style={{ marginRight: 2 }}
                      />
                    ))}
                    <Text style={[styles.shieldsLabel, isSelected && styles.shieldsLabelSelected]}>
                      3 shields
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Summary bar */}
          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.summaryLabel}>Buy-in</Text>
              <Text style={styles.summaryValue}>${selectedTier.dollars}.00</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="logo-bitcoin" size={16} color={colors.gold} />
              <Text style={styles.summaryLabel}>Coins</Text>
              <Text style={[styles.summaryValue, { color: colors.gold }]}>{selectedTier.coins}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="shield" size={16} color={colors.primary} />
              <Text style={styles.summaryLabel}>Shields</Text>
              <Text style={[styles.summaryValue, { color: colors.primary }]}>3</Text>
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="warning" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* CTA Button */}
          <TouchableOpacity
            style={[styles.buyBtn, loading && styles.buyBtnDisabled]}
            onPress={handleBuyIn}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color={colors.background} style={{ marginRight: 8 }} />
                <Text style={styles.buyBtnText}>ENTER BATTLEFIELD — ${selectedTier.dollars}</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Coins earned can be withdrawn. By proceeding you agree to the game rules.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    ...(Platform.OS === 'web' ? { boxShadow: `0 0 40px ${colors.primary}20` } : {}),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 2,
  },
  closeBtn: {
    padding: 4,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  tiersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tierCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
  },
  tierCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  tierCardHighlight: {
    borderColor: colors.gold + '60',
  },
  popularBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    backgroundColor: colors.gold,
    borderTopRightRadius: borderRadius.md,
    borderBottomLeftRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  popularText: {
    fontSize: 8,
    fontWeight: '900',
    color: colors.background,
    letterSpacing: 1,
  },
  tierLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 2,
    marginBottom: 4,
  },
  tierLabelSelected: {
    color: colors.primary,
  },
  tierPrice: {
    fontSize: fontSize.xxl,
    fontWeight: '900',
    color: colors.text,
    marginBottom: 4,
  },
  tierPriceSelected: {
    color: colors.primary,
  },
  coinsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  coinsText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  coinsTextSelected: {
    color: colors.gold,
  },
  shieldsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  shieldsLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginLeft: 2,
  },
  shieldsLabelSelected: {
    color: colors.primary,
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    justifyContent: 'space-around',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryItem: {
    alignItems: 'center',
    gap: 4,
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  summaryValue: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.text,
  },
  summaryDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondary + '20',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.secondary + '40',
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.error,
  },
  buyBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  buyBtnDisabled: {
    opacity: 0.6,
  },
  buyBtnText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: fontSize.md,
    letterSpacing: 1,
  },
  disclaimer: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
