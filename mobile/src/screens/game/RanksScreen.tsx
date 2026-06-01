import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import { getWallet } from '../../api/game';

// ---------------------------------------------------------------------------
// Rank tiers — based on total Prowl Coins earned
// ---------------------------------------------------------------------------
const RANK_TIERS = [
  { min: 0,     title: 'ROOKIE HUNTER',   icon: 'footsteps-outline', color: '#9e9e9e' },
  { min: 100,   title: 'SCOUT',           icon: 'eye-outline',       color: '#78909c' },
  { min: 500,   title: 'TRACKER',         icon: 'compass-outline',   color: '#4caf50' },
  { min: 1500,  title: 'STALKER',         icon: 'navigate-outline',  color: '#2196f3' },
  { min: 3000,  title: 'PROWLER',         icon: 'flash-outline',     color: '#7c4dff' },
  { min: 5000,  title: 'ENFORCER',        icon: 'flame-outline',     color: '#ff9100' },
  { min: 10000, title: 'APEX HUNTER',     icon: 'diamond-outline',   color: '#f50057' },
  { min: 25000, title: 'LEGEND',          icon: 'star',              color: '#ffd700' },
  { min: 50000, title: 'MYTHIC PROWLER',  icon: 'crown',             color: '#ffd700', iconLib: 'mci' as const },
];

function getCurrentRankIndex(prowlCoins: number): number {
  let idx = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (prowlCoins >= RANK_TIERS[i].min) idx = i;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// RanksScreen
// ---------------------------------------------------------------------------
export default function RanksScreen() {
  const [prowlCoins, setProwlCoins] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadWallet = useCallback(async () => {
    try {
      const w = await getWallet();
      setProwlCoins(w.prowlBalance ?? 0);
    } catch {
      setProwlCoins(0);
    }
  }, []);

  useEffect(() => {
    loadWallet().finally(() => setLoading(false));
  }, [loadWallet]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadWallet();
    setRefreshing(false);
  }, [loadWallet]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const coins = prowlCoins ?? 0;
  const currentIdx = getCurrentRankIndex(coins);
  const currentRank = RANK_TIERS[currentIdx];
  const nextRank = currentIdx < RANK_TIERS.length - 1 ? RANK_TIERS[currentIdx + 1] : null;
  const progress = nextRank
    ? Math.min(1, Math.max(0, (coins - currentRank.min) / (nextRank.min - currentRank.min)))
    : 1;

  // Display ranks in reverse order (highest at top)
  const ranksReversed = [...RANK_TIERS].reverse();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {/* Current rank summary */}
      <View style={styles.summaryCard}>
        <View style={[styles.summaryIconWrap, { backgroundColor: currentRank.color + '20' }]}>
          <Ionicons name={currentRank.icon as any} size={32} color={currentRank.color} />
        </View>
        <Text style={styles.summaryLabel}>CURRENT RANK</Text>
        <Text style={[styles.summaryTitle, { color: currentRank.color }]}>{currentRank.title}</Text>
        <Text style={styles.summaryCoins}>{coins.toLocaleString()} Prowl Coins</Text>
        {nextRank && (
          <View style={styles.progressSection}>
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: currentRank.color }]}
              />
            </View>
            <Text style={styles.progressText}>
              {(nextRank.min - coins).toLocaleString()} more to {nextRank.title}
            </Text>
          </View>
        )}
        {!nextRank && (
          <Text style={styles.maxRankText}>MAX RANK ACHIEVED</Text>
        )}
      </View>

      {/* Rank ladder */}
      <Text style={styles.sectionTitle}>RANK PROGRESSION</Text>
      <View style={styles.ladderContainer}>
        {ranksReversed.map((tier, idx) => {
          const tierIdx = RANK_TIERS.length - 1 - idx;
          const isCurrent = tierIdx === currentIdx;
          const isLocked = tierIdx > currentIdx;

          return (
            <View key={tier.title} style={styles.rankRow}>
              {/* Connector line */}
              {idx < ranksReversed.length - 1 && (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: tierIdx > currentIdx ? colors.border : tier.color + '40' },
                  ]}
                />
              )}

              {/* Rank card */}
              <View
                style={[
                  styles.rankCard,
                  isCurrent && styles.rankCardCurrent,
                  isCurrent && { borderColor: tier.color, shadowColor: tier.color },
                  isLocked && styles.rankCardLocked,
                ]}
              >
                <View
                  style={[
                    styles.rankIconWrap,
                    { backgroundColor: tier.color + (isLocked ? '10' : '20') },
                  ]}
                >
                  {(tier as any).iconLib === 'mci'
                    ? <MaterialCommunityIcons name={tier.icon as any} size={24} color={isLocked ? tier.color + '60' : tier.color} />
                    : <Ionicons name={tier.icon as any} size={24} color={isLocked ? tier.color + '60' : tier.color} />}
                </View>
                <View style={styles.rankInfo}>
                  <Text
                    style={[
                      styles.rankTitle,
                      { color: isLocked ? colors.textMuted : tier.color },
                    ]}
                  >
                    {tier.title}
                  </Text>
                  <Text style={[styles.rankMin, isLocked && styles.rankMinLocked]}>
                    {tier.min.toLocaleString()} Prowl Coins
                  </Text>
                </View>
                {isCurrent && (
                  <View style={[styles.currentBadge, { backgroundColor: tier.color + '20' }]}>
                    <Text style={[styles.currentBadgeText, { color: tier.color }]}>YOU</Text>
                  </View>
                )}
                {isLocked && (
                  <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                )}
                {!isLocked && !isCurrent && (
                  <Ionicons name="checkmark-circle" size={18} color={tier.color} />
                )}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  summaryIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 3,
  },
  summaryTitle: {
    fontSize: fontSize.xl,
    fontWeight: '900',
    letterSpacing: 2,
  },
  summaryCoins: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  progressSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: 4,
  },
  progressBar: {
    width: '80%',
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  maxRankText: {
    fontSize: fontSize.xs,
    color: colors.gold,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 3,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  ladderContainer: {
    gap: 0,
  },
  rankRow: {
    position: 'relative',
    marginBottom: spacing.sm,
  },
  connector: {
    position: 'absolute',
    left: 36,
    top: 60,
    width: 2,
    height: spacing.sm + 4,
    zIndex: -1,
  },
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  rankCardCurrent: {
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 6,
  },
  rankCardLocked: {
    opacity: 0.5,
  },
  rankIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankInfo: {
    flex: 1,
    gap: 2,
  },
  rankTitle: {
    fontSize: fontSize.md,
    fontWeight: '800',
    letterSpacing: 1,
  },
  rankMin: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  rankMinLocked: {
    color: colors.textMuted,
  },
  currentBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
