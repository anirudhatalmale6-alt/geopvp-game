import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  Switch,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import { getCombatStats, CombatStats } from '../../api/game';
import { getNotificationPermissionStatus, registerForPushNotifications } from '../../services/notifications';

// ---------------------------------------------------------------------------
// Avatar color from username
// ---------------------------------------------------------------------------
const AVATAR_COLORS = [
  '#00e5ff', '#ff1744', '#ffd700', '#7c4dff',
  '#00e676', '#ff9100', '#40c4ff', '#f50057',
];

function getAvatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ---------------------------------------------------------------------------
// Change Password form
// ---------------------------------------------------------------------------
function ChangePasswordForm({ onCancel }: { onCancel: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!current.trim() || !next.trim()) {
      setError('Both fields are required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setSuccess(true);
      setTimeout(onCancel, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <View style={cpStyles.successBox}>
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
        <Text style={cpStyles.successText}>Password changed!</Text>
      </View>
    );
  }

  return (
    <View style={cpStyles.form}>
      <Text style={cpStyles.formTitle}>CHANGE PASSWORD</Text>
      <TextInput
        style={cpStyles.input}
        placeholder="Current password"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={current}
        onChangeText={setCurrent}
      />
      <TextInput
        style={cpStyles.input}
        placeholder="New password"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={next}
        onChangeText={setNext}
      />
      {error && (
        <Text style={cpStyles.errorText}>{error}</Text>
      )}
      <View style={cpStyles.btnRow}>
        <TouchableOpacity style={cpStyles.cancelBtn} onPress={onCancel}>
          <Text style={cpStyles.cancelText}>CANCEL</Text>
        </TouchableOpacity>
        <TouchableOpacity style={cpStyles.saveBtn} onPress={handleSubmit} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={colors.background} />
            : <Text style={cpStyles.saveText}>SAVE</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const cpStyles = StyleSheet.create({
  form: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formTitle: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 2,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.xs,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  saveBtn: {
    flex: 1,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  saveText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.success + '20',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  successText: {
    color: colors.success,
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
});

// ---------------------------------------------------------------------------
// Main ProfileScreen
// ---------------------------------------------------------------------------

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [stats, setStats] = useState<CombatStats | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const loadStats = useCallback(async () => {
    const s = await getCombatStats();
    setStats(s);
  }, []);

  const checkNotificationStatus = useCallback(async () => {
    const enabled = await getNotificationPermissionStatus();
    setNotificationsEnabled(enabled);
  }, []);

  useEffect(() => {
    loadStats();
    checkNotificationStatus();
  }, [loadStats, checkNotificationStatus]);

  const handleNotificationToggle = async () => {
    if (notificationsEnabled) {
      Alert.alert(
        'Disable Notifications',
        'To turn off notifications, go to your iPhone Settings > CoinProwl > Notifications.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
    } else {
      const token = await registerForPushNotifications();
      if (token) {
        setNotificationsEnabled(true);
        Alert.alert('Notifications Enabled', 'You will now receive attack alerts and game notifications.');
      } else {
        Alert.alert(
          'Permission Required',
          'Notifications are blocked. Please enable them in your iPhone Settings > CoinProwl > Notifications.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
    }
  };

  const avatarColor = user?.username ? getAvatarColor(user.username) : colors.primary;
  const initials = user?.username?.substring(0, 2).toUpperCase() ?? '??';

  const handleLogout = () => {
    Alert.alert(
      'LOG OUT',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'LOG OUT', style: 'destructive', onPress: logout },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Avatar + name */}
      <View style={styles.heroCard}>
        <View style={[styles.avatar, { backgroundColor: avatarColor + '30', borderColor: avatarColor }]}>
          <Text style={[styles.avatarText, { color: avatarColor }]}>{initials}</Text>
        </View>
        <Text style={styles.username}>{user?.username?.toUpperCase() ?? 'HUNTER'}</Text>
        <Text style={styles.email}>{user?.email ?? ''}</Text>
        <View style={styles.rankBadge}>
          <Ionicons name="flash" size={12} color={colors.gold} />
          <Text style={styles.rankText}>ROOKIE HUNTER</Text>
        </View>
      </View>

      {/* Stats grid */}
      <Text style={styles.sectionTitle}>COMBAT STATS</Text>
      <View style={styles.statsGrid}>
        {[
          { label: 'SESSIONS',     value: String(stats?.sessions ?? 0),     icon: 'game-controller-outline', color: colors.primary },
          { label: 'COINS EARNED', value: String(stats?.coinsEarned ?? 0),  icon: 'cash-outline',             color: colors.gold },
          { label: 'ATTACKS WON',  value: String(stats?.attacksWon ?? 0),   icon: 'flash',                   color: colors.success },
          { label: 'ATTACKS LOST', value: String(stats?.attacksLost ?? 0),  icon: 'skull-outline',           color: colors.secondary },
          { label: 'SHIELDS USED', value: String(stats?.shieldsUsed ?? 0),  icon: 'shield',                  color: colors.primary },
          { label: 'PLAYERS HIT',  value: String(stats?.playersHit ?? 0),   icon: 'people',                  color: colors.warning },
        ].map((stat) => (
          <View key={stat.label} style={styles.statCard}>
            <Ionicons name={stat.icon as any} size={22} color={stat.color} />
            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Settings */}
      <Text style={styles.sectionTitle}>SETTINGS</Text>
      <View style={styles.settingsCard}>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => setShowChangePassword(!showChangePassword)}
        >
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.settingLabel}>Change Password</Text>
          </View>
          <Ionicons
            name={showChangePassword ? 'chevron-up' : 'chevron-forward'}
            size={18}
            color={colors.textMuted}
          />
        </TouchableOpacity>

        {showChangePassword && (
          <ChangePasswordForm onCancel={() => setShowChangePassword(false)} />
        )}

        <View style={styles.divider} />

        <TouchableOpacity style={styles.settingRow} onPress={handleNotificationToggle} activeOpacity={0.7}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.warning + '20' }]}>
              <Ionicons name="notifications-outline" size={18} color={colors.warning} />
            </View>
            <Text style={styles.settingLabel}>Notifications</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleNotificationToggle}
            trackColor={{ false: colors.border, true: colors.primary + '60' }}
            thumbColor={notificationsEnabled ? colors.primary : colors.textMuted}
            ios_backgroundColor={colors.border}
          />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.settingRow} onPress={() => {}}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: colors.accent + '20' }]}>
              <Ionicons name="help-circle-outline" size={18} color={colors.accent} />
            </View>
            <Text style={styles.settingLabel}>Help & Support</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
        <Ionicons name="log-out-outline" size={18} color={colors.secondary} />
        <Text style={styles.logoutText}>LOG OUT</Text>
      </TouchableOpacity>

      <Text style={styles.version}>CoinProwl v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: spacing.sm,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '900',
  },
  username: {
    fontSize: fontSize.xl,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 2,
  },
  email: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.gold + '20',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginTop: spacing.xs,
  },
  rankText: {
    fontSize: fontSize.xs,
    color: colors.gold,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 3,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statCard: {
    width: '30.5%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 8,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
  },
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 16 + 36 + 16,
  },
  logoutBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.secondary + '60',
    marginBottom: spacing.md,
  },
  logoutText: {
    color: colors.secondary,
    fontWeight: '800',
    fontSize: fontSize.md,
    letterSpacing: 2,
  },
  version: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
