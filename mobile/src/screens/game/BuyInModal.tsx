import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import { createBuyInOrder, captureBuyInOrder } from '../../api/game';
import PayPalWebViewModal from '../../components/PayPalWebViewModal';

interface TierOption {
  dollars: number;
  coins: number;
  label: string;
  color: string;
  highlight?: boolean;
}

const TIERS: TierOption[] = [
  { dollars: 1,  coins: 10,  label: 'COPPER',      color: '#b87333' },
  { dollars: 2,  coins: 20,  label: 'TIN',         color: '#8a9597' },
  { dollars: 3,  coins: 30,  label: 'IRON',        color: '#6a6a6a' },
  { dollars: 4,  coins: 40,  label: 'NICKEL',      color: '#7a7a7a' },
  { dollars: 5,  coins: 50,  label: 'BRONZE',      color: '#cd7f32', highlight: true },
  { dollars: 6,  coins: 60,  label: 'BRASS',       color: '#b5a642' },
  { dollars: 7,  coins: 70,  label: 'SILVER',      color: '#c0c0c0' },
  { dollars: 8,  coins: 80,  label: 'ELECTRUM',    color: '#d4c675' },
  { dollars: 9,  coins: 90,  label: 'GOLD',        color: '#ffd700' },
  { dollars: 10, coins: 100, label: 'ROSE GOLD',   color: '#e8a090', highlight: true },
  { dollars: 11, coins: 110, label: 'PALLADIUM',   color: '#ced0ce' },
  { dollars: 12, coins: 120, label: 'PLATINUM',    color: '#e5e4e2' },
  { dollars: 13, coins: 130, label: 'OPAL',        color: '#d4eaf7' },
  { dollars: 14, coins: 140, label: 'TOPAZ',       color: '#ffc87c' },
  { dollars: 15, coins: 150, label: 'AMETHYST',    color: '#9966cc' },
  { dollars: 16, coins: 160, label: 'AQUAMARINE',  color: '#7fffd4' },
  { dollars: 17, coins: 170, label: 'EMERALD',     color: '#50c878' },
  { dollars: 18, coins: 180, label: 'PEARL',       color: '#f0ead6' },
  { dollars: 19, coins: 190, label: 'SAPPHIRE',    color: '#0f52ba' },
  { dollars: 20, coins: 200, label: 'ALEXANDRITE', color: '#008b8b', highlight: true },
  { dollars: 21, coins: 210, label: 'RUBY',        color: '#e0115f' },
  { dollars: 22, coins: 220, label: 'BLACK OPAL',  color: '#1a1a2e' },
  { dollars: 23, coins: 230, label: 'TANZANITE',   color: '#4d4dff' },
  { dollars: 24, coins: 240, label: 'RED BERYL',   color: '#c41e3a' },
  { dollars: 25, coins: 250, label: 'DIAMOND',     color: '#b9f2ff' },
];

interface BuyInModalProps {
  visible: boolean;
  onClose: () => void;
  onSessionCreated: () => void;
  eliminationMessage?: string | null;
}

export default function BuyInModal({ visible, onClose, onSessionCreated, eliminationMessage }: BuyInModalProps) {
  const [selectedTier, setSelectedTier] = useState<TierOption>(TIERS[4]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationConsent, setLocationConsent] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const [paypalUrl, setPaypalUrl] = useState<string | null>(null);
  const pendingOrderRef = useRef<string | null>(null);

  const handleBuyIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const order = await createBuyInOrder(selectedTier.dollars);
      pendingOrderRef.current = order.orderId;
      setPaypalUrl(order.approvalUrl);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to start payment. Please try again.');
      setLoading(false);
    }
  };

  const handlePayPalApproved = async () => {
    setPaypalUrl(null);
    setLoading(true);
    const orderId = pendingOrderRef.current;
    pendingOrderRef.current = null;

    if (!orderId) {
      setError('Payment reference lost. Please try again.');
      setLoading(false);
      return;
    }

    try {
      await captureBuyInOrder(orderId);
      onSessionCreated();
      onClose();
    } catch (captureErr: any) {
      if (captureErr.message?.includes('not completed')) {
        Alert.alert(
          'Payment Pending',
          'It looks like the payment wasn\'t completed. Please try again.',
          [{ text: 'OK' }],
        );
      } else {
        setError(captureErr.message || 'Failed to process payment.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePayPalCancelled = () => {
    setPaypalUrl(null);
    pendingOrderRef.current = null;
    setLoading(false);
  };

  const tierColor = selectedTier.color;
  const isDarkTier = selectedTier.label === 'BLACK OPAL' || selectedTier.label === 'IRON' || selectedTier.label === 'NICKEL';

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
              <View style={[styles.headerIcon, { backgroundColor: tierColor + '30' }]}>
                <Ionicons name="flash" size={20} color={tierColor} />
              </View>
              <Text style={styles.title}>START HUNTING</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {eliminationMessage ? (
            <View style={styles.elimBanner}>
              <Ionicons name="skull-outline" size={18} color="#ff4444" />
              <Text style={styles.elimText}>{eliminationMessage}</Text>
            </View>
          ) : null}

          <Text style={styles.subtitle}>Select your buy-in tier to enter the battlefield</Text>

          {/* Scrollable tier grid */}
          <ScrollView
            ref={scrollRef}
            style={styles.tiersScroll}
            contentContainerStyle={styles.tiersGrid}
            showsVerticalScrollIndicator={false}
          >
            {TIERS.map((tier) => {
              const isSelected = selectedTier.dollars === tier.dollars;
              const isDark = tier.label === 'BLACK OPAL' || tier.label === 'IRON' || tier.label === 'NICKEL';
              return (
                <TouchableOpacity
                  key={tier.dollars}
                  style={[
                    styles.tierCard,
                    { borderColor: isSelected ? tier.color : colors.border },
                    isSelected && { backgroundColor: tier.color + '18' },
                  ]}
                  onPress={() => setSelectedTier(tier)}
                  activeOpacity={0.8}
                >
                  {tier.highlight && (
                    <View style={[styles.popularBadge, { backgroundColor: tier.color }]}>
                      <Text style={[styles.popularText, isDark && { color: '#fff' }]}>
                        {tier.dollars === 5 ? 'POPULAR' : tier.dollars === 10 ? 'VALUE' : 'PREMIUM'}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.tierDot, { backgroundColor: tier.color }]} />
                  <Text style={[
                    styles.tierLabel,
                    isSelected && { color: tier.color },
                  ]}>
                    {tier.label}
                  </Text>
                  <Text style={[
                    styles.tierPrice,
                    isSelected && { color: tier.color },
                  ]}>
                    ${tier.dollars}
                  </Text>
                  <Text style={[
                    styles.coinsText,
                    isSelected && { color: tier.color },
                  ]}>
                    {tier.coins} prowl coins
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Summary bar */}
          <View style={[styles.summaryBar, { borderColor: tierColor + '40' }]}>
            <View style={styles.summaryItem}>
              <Ionicons name="cash-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.summaryLabel}>Buy-in</Text>
              <Text style={[styles.summaryValue, { color: tierColor }]}>${selectedTier.dollars}.00</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="cash-outline" size={16} color={colors.gold} />
              <Text style={styles.summaryLabel}>Prowl Coins</Text>
              <Text style={[styles.summaryValue, { color: colors.gold }]}>{selectedTier.coins}</Text>
            </View>
          </View>

          {/* Location consent */}
          <TouchableOpacity
            style={[styles.consentRow, locationConsent && styles.consentRowActive]}
            onPress={() => setLocationConsent(!locationConsent)}
            activeOpacity={0.8}
          >
            <View style={[styles.checkbox, locationConsent && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              {locationConsent && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={styles.consentText}>
              I understand that my live location will be displayed on the map and visible to other players while my session is active. I can end my session at any time to stop sharing my location.
            </Text>
          </TouchableOpacity>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="warning" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* CTA Button */}
          <TouchableOpacity
            style={[styles.buyBtn, { backgroundColor: tierColor }, (loading || !locationConsent) && styles.buyBtnDisabled]}
            onPress={handleBuyIn}
            disabled={loading || !locationConsent}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color={isDarkTier ? '#fff' : colors.background} style={{ marginRight: 8 }} />
                <Text style={[styles.buyBtnText, isDarkTier && { color: '#fff' }]}>
                  ENTER BATTLEFIELD — ${selectedTier.dollars}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Your location is only shared while you have an active session. End your session or close the app to stop sharing. You can block any player from your profile. Coins earned can be withdrawn.
          </Text>
        </View>
      </View>

      <PayPalWebViewModal
        visible={!!paypalUrl}
        approvalUrl={paypalUrl || ''}
        onApproved={handlePayPalApproved}
        onCancelled={handlePayPalCancelled}
      />
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
    maxHeight: '90%',
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
  elimBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff444420',
    borderWidth: 1,
    borderColor: '#ff444460',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  elimText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: '#ff6666',
    fontWeight: '700',
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  tiersScroll: {
    maxHeight: 320,
    marginBottom: spacing.md,
  },
  tiersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  tierCard: {
    width: '31%',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    borderWidth: 1,
    position: 'relative',
    alignItems: 'center',
    minHeight: 80,
    justifyContent: 'center',
  },
  popularBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    borderTopRightRadius: borderRadius.md,
    borderBottomLeftRadius: borderRadius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  popularText: {
    fontSize: 6,
    fontWeight: '900',
    color: colors.background,
    letterSpacing: 0.5,
  },
  tierDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 3,
  },
  tierLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 1,
    textAlign: 'center',
  },
  tierPrice: {
    fontSize: fontSize.lg,
    fontWeight: '900',
    color: colors.text,
  },
  coinsText: {
    fontSize: 8,
    color: colors.textMuted,
    fontWeight: '600',
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
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  consentRowActive: {
    borderColor: colors.primary + '60',
    backgroundColor: colors.primary + '10',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.textMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  consentText: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  disclaimer: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
