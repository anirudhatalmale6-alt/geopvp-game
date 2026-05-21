import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import {
  getActiveSession,
  updateLocation,
  getNearbyPlayers,
  attackPlayer,
  buyShield,
  GameSession,
  NearbyPlayer,
} from '../../api/game';
import BuyInModal from './BuyInModal';

const { width: SCREEN_W } = Dimensions.get('window');
const RADAR_SIZE = Math.min(SCREEN_W - 32, 360);

// ---------------------------------------------------------------------------
// Web radar animation (CSS-based)
// ---------------------------------------------------------------------------
const RADAR_STYLE = Platform.OS === 'web' ? `
  @keyframes pulse {
    0%   { transform: scale(1);   opacity: 0.9; box-shadow: 0 0 0 0 rgba(0,229,255,0.5); }
    70%  { transform: scale(1.3); opacity: 0;   box-shadow: 0 0 0 16px rgba(0,229,255,0); }
    100% { transform: scale(1);   opacity: 0;   box-shadow: 0 0 0 0 rgba(0,229,255,0); }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes sweep {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.3; }
  }
  .pulse-dot {
    animation: pulse 2s ease-out infinite;
  }
  .radar-sweep {
    animation: sweep 3s linear infinite;
  }
  .blink {
    animation: blink 1.2s ease-in-out infinite;
  }
` : '';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapScreen() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [nearbyPlayers, setNearbyPlayers] = useState<NearbyPlayer[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBuyIn, setShowBuyIn] = useState(false);
  const [attackTarget, setAttackTarget] = useState<NearbyPlayer | null>(null);
  const [attackResult, setAttackResult] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('SCANNING AREA...');
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Inject CSS for web animations
  useEffect(() => {
    if (Platform.OS === 'web' && RADAR_STYLE) {
      const style = document.createElement('style');
      style.textContent = RADAR_STYLE;
      document.head.appendChild(style);
      return () => { document.head.removeChild(style); };
    }
  }, []);

  // Request location permission
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      setLocationPermission(granted);
      if (!granted) {
        setLoading(false);
        return;
      }
      // Get initial position
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {}

      // Subscribe to updates
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      );
    })();
    return () => { locationSub.current?.remove(); };
  }, []);

  // Load active session on mount
  const refreshSession = useCallback(async () => {
    try {
      const s = await getActiveSession();
      setSession(s);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      await refreshSession();
      setLoading(false);
    })();
  }, [refreshSession]);

  // Poll: update location + fetch nearby players every 10s when in session
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!session || !location) return;

    const poll = async () => {
      try {
        await updateLocation(location.lat, location.lng);
        const players = await getNearbyPlayers();
        setNearbyPlayers(players);
        if (players.length > 0) {
          setStatusMessage(`${players.length} HUNTER${players.length > 1 ? 'S' : ''} DETECTED`);
        } else {
          setStatusMessage('AREA CLEAR');
        }
      } catch {}
    };

    poll(); // immediate first run
    pollRef.current = setInterval(poll, 10_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session?.id, location?.lat, location?.lng]);

  // Attack handler
  const handleAttack = async (player: NearbyPlayer) => {
    try {
      const result = await attackPlayer(player.sessionId);
      setAttackResult(result.success
        ? `ATTACK SUCCESS! Stole ${result.coinsStolen} coins from ${player.username}!`
        : `ATTACK BLOCKED! ${player.username} had a shield.`);
      await refreshSession();
      setTimeout(() => setAttackResult(null), 4000);
    } catch (err: any) {
      setAttackResult(`Attack failed: ${err.message}`);
      setTimeout(() => setAttackResult(null), 3000);
    }
    setAttackTarget(null);
  };

  // Buy shield
  const handleBuyShield = async () => {
    try {
      const updated = await buyShield();
      setSession(updated);
    } catch {}
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const shieldIsActive = session?.shieldActiveUntil
    ? new Date(session.shieldActiveUntil) > new Date()
    : false;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>INITIALIZING...</Text>
      </View>
    );
  }

  if (locationPermission === false) {
    return (
      <View style={styles.centered}>
        <Ionicons name="location-outline" size={48} color={colors.textMuted} />
        <Text style={styles.permissionTitle}>LOCATION ACCESS REQUIRED</Text>
        <Text style={styles.permissionSub}>Enable location permission to play GeoPVP</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Status bar top */}
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
        {session && (
          <View style={styles.topRight}>
            <Ionicons name="logo-bitcoin" size={14} color={colors.gold} />
            <Text style={styles.coinsText}>{session.mapCoins}</Text>
          </View>
        )}
      </View>

      {/* Radar view */}
      <View style={styles.radarWrapper}>
        <View style={styles.radar}>
          {/* Concentric rings */}
          <View style={[styles.ring, { width: RADAR_SIZE * 0.25, height: RADAR_SIZE * 0.25, borderRadius: RADAR_SIZE * 0.25 / 2 }]} />
          <View style={[styles.ring, { width: RADAR_SIZE * 0.5,  height: RADAR_SIZE * 0.5,  borderRadius: RADAR_SIZE * 0.5  / 2 }]} />
          <View style={[styles.ring, { width: RADAR_SIZE * 0.75, height: RADAR_SIZE * 0.75, borderRadius: RADAR_SIZE * 0.75 / 2 }]} />

          {/* Cross-hair lines */}
          <View style={styles.crossH} />
          <View style={styles.crossV} />

          {/* Radar sweep (web only) */}
          {Platform.OS === 'web' && (
            <View
              className="radar-sweep"
              style={styles.sweepContainer as any}
            >
              <View style={styles.sweepLine} />
              <View style={styles.sweepFan} />
            </View>
          )}

          {/* Attack radius circle */}
          {session && (
            <View style={styles.attackRadius} />
          )}

          {/* Nearby players as red dots */}
          {nearbyPlayers.map((player, idx) => {
            // Place players around the radar based on index (since we don't have relative bearing)
            const angle = (idx / Math.max(nearbyPlayers.length, 1)) * Math.PI * 2;
            const dist = 0.3 + Math.random() * 0.25; // between 30-55% from center
            const px = 50 + Math.cos(angle) * dist * 50;
            const py = 50 + Math.sin(angle) * dist * 50;
            return (
              <TouchableOpacity
                key={player.sessionId}
                style={[
                  styles.playerDot,
                  { left: `${px}%` as any, top: `${py}%` as any },
                  player.shieldActive && styles.playerDotShielded,
                ]}
                onPress={() => setAttackTarget(player)}
              >
                <View style={styles.playerDotInner} />
                <Text style={styles.playerLabel}>{player.username.substring(0, 6)}</Text>
              </TouchableOpacity>
            );
          })}

          {/* Player (self) dot */}
          {Platform.OS === 'web' ? (
            <View
              className="pulse-dot"
              style={[styles.selfDot, shieldIsActive && styles.selfDotShielded]}
            />
          ) : (
            <View style={[styles.selfDot, shieldIsActive && styles.selfDotShielded]} />
          )}
        </View>
      </View>

      {/* Location info */}
      {location && (
        <View style={styles.locationBar}>
          <Ionicons name="location" size={12} color={colors.primary} />
          <Text style={styles.locationText}>
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
          </Text>
        </View>
      )}

      {/* Session HUD */}
      {session && (
        <View style={styles.hudRow}>
          <View style={styles.hudCard}>
            <Ionicons name="logo-bitcoin" size={20} color={colors.gold} />
            <Text style={styles.hudValue}>{session.mapCoins}</Text>
            <Text style={styles.hudLabel}>COINS</Text>
          </View>
          <View style={styles.hudCard}>
            <Ionicons name="shield" size={20} color={shieldIsActive ? colors.primary : colors.textMuted} />
            <Text style={[styles.hudValue, { color: shieldIsActive ? colors.primary : colors.text }]}>
              {shieldIsActive ? 'ON' : 'OFF'}
            </Text>
            <Text style={styles.hudLabel}>SHIELD</Text>
          </View>
          <View style={styles.hudCard}>
            <Ionicons name="people" size={20} color={nearbyPlayers.length > 0 ? colors.secondary : colors.textMuted} />
            <Text style={[styles.hudValue, { color: nearbyPlayers.length > 0 ? colors.secondary : colors.text }]}>
              {nearbyPlayers.length}
            </Text>
            <Text style={styles.hudLabel}>NEARBY</Text>
          </View>
        </View>
      )}

      {/* Attack result toast */}
      {attackResult && (
        <View style={styles.toastBanner}>
          <Ionicons
            name={attackResult.includes('SUCCESS') ? 'checkmark-circle' : 'close-circle'}
            size={16}
            color={attackResult.includes('SUCCESS') ? colors.success : colors.error}
          />
          <Text style={styles.toastText}>{attackResult}</Text>
        </View>
      )}

      {/* Attack confirmation panel */}
      {attackTarget && (
        <View style={styles.attackPanel}>
          <Text style={styles.attackPanelTitle}>ATTACK TARGET</Text>
          <Text style={styles.attackPanelName}>{attackTarget.username.toUpperCase()}</Text>
          <Text style={styles.attackPanelCoins}>{attackTarget.mapCoins} coins</Text>
          {attackTarget.shieldActive && (
            <View style={styles.shieldWarning}>
              <Ionicons name="shield" size={14} color={colors.warning} />
              <Text style={styles.shieldWarningText}>SHIELD ACTIVE</Text>
            </View>
          )}
          <View style={styles.attackPanelBtns}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setAttackTarget(null)}
            >
              <Text style={styles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.attackConfirmBtn}
              onPress={() => handleAttack(attackTarget)}
            >
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={styles.attackConfirmText}>ATTACK</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {!session ? (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => setShowBuyIn(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="flash" size={20} color={colors.background} />
            <Text style={styles.startBtnText}>START HUNTING</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.sessionBtns}>
            <TouchableOpacity
              style={[styles.shieldBtn, shieldIsActive && styles.shieldBtnActive]}
              onPress={handleBuyShield}
              disabled={session.shieldsRemaining === 0 || shieldIsActive}
            >
              <Ionicons
                name="shield"
                size={18}
                color={shieldIsActive ? colors.background : colors.primary}
              />
              <Text style={[styles.shieldBtnText, shieldIsActive && { color: colors.background }]}>
                {shieldIsActive ? 'SHIELDED' : `SHIELD (${session.shieldsRemaining})`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <BuyInModal
        visible={showBuyIn}
        onClose={() => setShowBuyIn(false)}
        onSessionCreated={refreshSession}
      />
    </View>
  );
}

const S = RADAR_SIZE;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    marginTop: spacing.md,
  },
  permissionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  permissionSub: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    // @ts-ignore web
    ...(Platform.OS === 'web' ? { boxShadow: `0 0 6px ${colors.primary}` } : {}),
  },
  statusText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 2,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  coinsText: {
    color: colors.gold,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  radarWrapper: {
    marginTop: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radar: {
    width: S,
    height: S,
    borderRadius: S / 2,
    backgroundColor: '#030712',
    borderWidth: 2,
    borderColor: colors.primary + '60',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    // @ts-ignore web
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 40px ${colors.primary}30, inset 0 0 40px rgba(0,0,0,0.5)`,
    } : {}),
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: colors.primary + '25',
  },
  crossH: {
    position: 'absolute',
    width: '100%',
    height: 1,
    backgroundColor: colors.primary + '15',
  },
  crossV: {
    position: 'absolute',
    width: 1,
    height: '100%',
    backgroundColor: colors.primary + '15',
  },
  sweepContainer: {
    position: 'absolute',
    width: S / 2,
    height: S,
    left: S / 2,
    top: 0,
    transformOrigin: 'left center',
  },
  sweepLine: {
    position: 'absolute',
    left: 0,
    top: S / 2,
    width: S / 2,
    height: 2,
    backgroundColor: colors.primary + '90',
  },
  sweepFan: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: S / 2,
    height: S,
    // @ts-ignore web
    background: `conic-gradient(from -90deg at 0% 50%, transparent 270deg, ${colors.primary}40 360deg)`,
    borderRadius: `0 ${S / 2}px ${S / 2}px 0`,
  },
  attackRadius: {
    position: 'absolute',
    width: S * 0.35,
    height: S * 0.35,
    borderRadius: (S * 0.35) / 2,
    borderWidth: 1,
    borderColor: colors.primary + '50',
    borderStyle: 'dashed',
  },
  selfDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    // @ts-ignore web
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 0 4px ${colors.primary}40, 0 0 12px ${colors.primary}`,
    } : {}),
    zIndex: 10,
  },
  selfDotShielded: {
    // @ts-ignore web
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 0 8px ${colors.primary}30, 0 0 20px ${colors.primary}`,
    } : {}),
    backgroundColor: colors.primary,
  },
  playerDot: {
    position: 'absolute',
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateX: -10 }, { translateY: -10 }],
    zIndex: 8,
  },
  playerDotShielded: {
    // web glow handled inline
  },
  playerDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.secondary,
    // @ts-ignore web
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 8px ${colors.secondary}`,
    } : {}),
  },
  playerLabel: {
    position: 'absolute',
    top: 20,
    fontSize: 8,
    color: colors.secondary,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    width: 60,
    left: -25,
  },
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.sm,
  },
  locationText: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  hudRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  hudCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hudValue: {
    fontSize: fontSize.lg,
    fontWeight: '900',
    color: colors.text,
  },
  hudLabel: {
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: 1,
    fontWeight: '600',
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    marginHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toastText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  attackPanel: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    width: '90%',
    borderWidth: 1,
    borderColor: colors.secondary + '60',
    alignItems: 'center',
    gap: spacing.xs,
  },
  attackPanelTitle: {
    fontSize: fontSize.xs,
    color: colors.secondary,
    fontWeight: '800',
    letterSpacing: 3,
  },
  attackPanelName: {
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: '900',
    letterSpacing: 2,
  },
  attackPanelCoins: {
    fontSize: fontSize.md,
    color: colors.gold,
    fontWeight: '700',
  },
  shieldWarning: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  shieldWarningText: {
    fontSize: fontSize.xs,
    color: colors.warning,
    fontWeight: '700',
    letterSpacing: 1,
  },
  attackPanelBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  cancelBtn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  attackConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.secondary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  attackConfirmText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  actionRow: {
    width: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: 'auto',
  },
  startBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    // @ts-ignore web
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 20px ${colors.primary}60`,
    } : {}),
  },
  startBtnText: {
    color: colors.background,
    fontWeight: '900',
    fontSize: fontSize.md,
    letterSpacing: 2,
  },
  sessionBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shieldBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  shieldBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  shieldBtnText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
});
