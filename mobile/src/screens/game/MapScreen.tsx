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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const MAP_CSS = `
  @keyframes pulse {
    0%   { transform: scale(1);   opacity: 1; box-shadow: 0 0 0 0 rgba(0,229,255,0.6); }
    70%  { transform: scale(1.4); opacity: 0;   box-shadow: 0 0 0 20px rgba(0,229,255,0); }
    100% { transform: scale(1);   opacity: 0;   box-shadow: 0 0 0 0 rgba(0,229,255,0); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.3; }
  }
  .pulse-ring {
    animation: pulse 2s ease-out infinite;
  }
  .blink {
    animation: blink 1.2s ease-in-out infinite;
  }
`;

function LeafletMap({ lat, lng, nearbyPlayers, session }: {
  lat: number;
  lng: number;
  nearbyPlayers: NearbyPlayer[];
  session: GameSession | null;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body,#map{width:100%;height:100%;background:#0a0e1a}
  .player-marker{
    width:14px;height:14px;border-radius:50%;
    background:#00e5ff;border:2px solid #00e5ff;
    box-shadow:0 0 12px #00e5ff,0 0 24px #00e5ff60;
  }
  .player-pulse{
    position:absolute;width:30px;height:30px;border-radius:50%;
    background:rgba(0,229,255,0.3);top:-8px;left:-8px;
    animation:pulse 2s ease-out infinite;
  }
  @keyframes pulse{
    0%{transform:scale(1);opacity:0.6}
    100%{transform:scale(2.5);opacity:0}
  }
  .enemy-marker{
    width:12px;height:12px;border-radius:50%;
    background:#ff1744;border:2px solid #ff1744;
    box-shadow:0 0 8px #ff1744;
  }
  .enemy-label{
    color:#ff1744;font-size:10px;font-weight:700;
    text-align:center;white-space:nowrap;
    text-shadow:0 0 4px rgba(0,0,0,0.8);
    margin-top:2px;letter-spacing:1px;
  }
  .leaflet-tile-pane{}
  .leaflet-control-attribution{display:none!important}
  .leaflet-control-zoom{display:none!important}
  .radius-circle{
    stroke:#00e5ff;stroke-opacity:0.4;fill:#00e5ff;fill-opacity:0.05;
    stroke-dasharray:8 4;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
var map = L.map('map',{zoomControl:false,attributionControl:false}).setView([0,0],16);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
  maxZoom:19
}).addTo(map);

var playerIcon = L.divIcon({className:'',html:'<div class="player-pulse"></div><div class="player-marker"></div>',iconSize:[14,14],iconAnchor:[7,7]});
var playerMarker = L.marker([0,0],{icon:playerIcon}).addTo(map);
var radiusCircle = null;
var enemyMarkers = [];

window.addEventListener('message',function(e){
  try{
    var d = JSON.parse(e.data);
    if(d.type==='update'){
      map.setView([d.lat,d.lng],map.getZoom(),{animate:true,duration:0.5});
      playerMarker.setLatLng([d.lat,d.lng]);

      if(d.hasSession && !radiusCircle){
        radiusCircle = L.circle([d.lat,d.lng],{radius:402,color:'#00e5ff',fillColor:'#00e5ff',fillOpacity:0.05,weight:1,opacity:0.4,dashArray:'8 4'}).addTo(map);
      }
      if(radiusCircle){
        radiusCircle.setLatLng([d.lat,d.lng]);
        if(!d.hasSession){map.removeLayer(radiusCircle);radiusCircle=null;}
      }

      enemyMarkers.forEach(function(m){map.removeLayer(m)});
      enemyMarkers=[];
      if(d.enemies){
        d.enemies.forEach(function(en){
          var icon = L.divIcon({className:'',html:'<div class="enemy-marker"></div><div class="enemy-label">'+en.name+'</div>',iconSize:[12,12],iconAnchor:[6,6]});
          var m = L.marker([en.lat,en.lng],{icon:icon}).addTo(map);
          enemyMarkers.push(m);
        });
      }
    }
    if(d.type==='init'){
      map.setView([d.lat,d.lng],16);
      playerMarker.setLatLng([d.lat,d.lng]);
      window.parent.postMessage(JSON.stringify({type:'ready'}),'*');
    }
  }catch(ex){}
});
window.parent.postMessage(JSON.stringify({type:'ready'}),'*');
</script>
</body>
</html>`;

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'ready') setReady(true);
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (!iframeRef.current?.contentWindow) return;
    const enemies = nearbyPlayers.map(p => ({
      name: p.username.substring(0, 8),
      lat: p.latitude || lat + (Math.random() - 0.5) * 0.003,
      lng: p.longitude || lng + (Math.random() - 0.5) * 0.003,
    }));
    iframeRef.current.contentWindow.postMessage(JSON.stringify({
      type: ready ? 'update' : 'init',
      lat, lng,
      hasSession: !!session,
      enemies,
    }), '*');
  }, [lat, lng, nearbyPlayers, session, ready]);

  return (
    <iframe
      ref={iframeRef as any}
      srcDoc={html}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        position: 'absolute',
        top: 0,
        left: 0,
      } as any}
      allow="geolocation"
    />
  );
}

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' && MAP_CSS) {
      const style = document.createElement('style');
      style.textContent = MAP_CSS;
      document.head.appendChild(style);
      return () => { document.head.removeChild(style); };
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      setLocationPermission(granted);
      if (!granted) {
        setLoading(false);
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {}

      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      );
    })();
    return () => { locationSub.current?.remove(); };
  }, []);

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

    poll();
    pollRef.current = setInterval(poll, 10_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session?.id, location?.lat, location?.lng]);

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

  const handleBuyShield = async () => {
    try {
      const updated = await buyShield();
      setSession(updated);
    } catch {}
  };

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
      {/* Real map */}
      {Platform.OS === 'web' && location && (
        <LeafletMap
          lat={location.lat}
          lng={location.lng}
          nearbyPlayers={nearbyPlayers}
          session={session}
        />
      )}

      {/* HUD overlay on top of map */}
      <View style={styles.hudOverlay} pointerEvents="box-none">
        {/* Top status bar */}
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

        {/* Session HUD cards */}
        {session && (
          <View style={styles.hudRow}>
            <View style={styles.hudCard}>
              <Ionicons name="logo-bitcoin" size={18} color={colors.gold} />
              <Text style={styles.hudValue}>{session.mapCoins}</Text>
              <Text style={styles.hudLabel}>COINS</Text>
            </View>
            <View style={styles.hudCard}>
              <Ionicons name="shield" size={18} color={shieldIsActive ? colors.primary : colors.textMuted} />
              <Text style={[styles.hudValue, { color: shieldIsActive ? colors.primary : colors.text }]}>
                {shieldIsActive ? 'ON' : 'OFF'}
              </Text>
              <Text style={styles.hudLabel}>SHIELD</Text>
            </View>
            <View style={styles.hudCard}>
              <Ionicons name="people" size={18} color={nearbyPlayers.length > 0 ? colors.secondary : colors.textMuted} />
              <Text style={[styles.hudValue, { color: nearbyPlayers.length > 0 ? colors.secondary : colors.text }]}>
                {nearbyPlayers.length}
              </Text>
              <Text style={styles.hudLabel}>NEARBY</Text>
            </View>
          </View>
        )}

        {/* Location coords */}
        {location && (
          <View style={styles.locationBar}>
            <Ionicons name="location" size={12} color={colors.primary} />
            <Text style={styles.locationText}>
              {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
            </Text>
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
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAttackTarget(null)}>
                <Text style={styles.cancelBtnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attackConfirmBtn} onPress={() => handleAttack(attackTarget)}>
                <Ionicons name="flash" size={16} color="#fff" />
                <Text style={styles.attackConfirmText}>ATTACK</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Spacer pushes action buttons to bottom */}
        <View style={{ flex: 1 }} />

        {/* Action buttons at bottom */}
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
      </View>

      <BuyInModal
        visible={showBuyIn}
        onClose={() => setShowBuyIn(false)}
        onSessionCreated={refreshSession}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    position: 'relative',
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
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
  hudOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingTop: spacing.lg,
    backgroundColor: 'rgba(10, 14, 26, 0.85)',
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
    backgroundColor: 'rgba(26, 34, 53, 0.9)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  coinsText: {
    color: colors.gold,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  hudRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  hudCard: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hudValue: {
    fontSize: fontSize.md,
    fontWeight: '900',
    color: colors.text,
  },
  hudLabel: {
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: 1,
    fontWeight: '600',
  },
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.sm,
    backgroundColor: 'rgba(10, 14, 26, 0.7)',
    alignSelf: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  locationText: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(26, 34, 53, 0.95)',
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
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: spacing.lg,
  },
  startBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
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
    backgroundColor: 'rgba(10, 14, 26, 0.8)',
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
