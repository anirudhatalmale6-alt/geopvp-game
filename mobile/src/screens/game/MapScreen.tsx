import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
  ActivityIndicator,
  AppState,
  Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as Location from 'expo-location';
// @ts-ignore — optional native dep
const WebView = Platform.OS !== 'web' ? require('react-native-webview').default : null;
import { colors, spacing, borderRadius, fontSize } from '../../theme';
import {
  getActiveSession,
  updateLocation,
  getAllPlayers,
  attackPlayer,
  buyShield,
  getCoinDrops,
  collectCoinDrop,
  GameSession,
  NearbyPlayer,
  CoinDrop,
} from '../../api/game';
import { connectSocket, disconnectSocket, emitLocation, onPlayersUpdate, onBatchUpdate, onEliminated, onBotHit, onConnectionChange } from '../../api/socket';
import NetInfo from '@react-native-community/netinfo';
import BuyInModal from './BuyInModal';
import { startBackgroundLocation, stopBackgroundLocation } from '../../services/backgroundLocation';
import { registerForPushNotifications } from '../../services/notifications';
import { getTierColor } from '../../utils/tierColors';
import { checkMockLocation } from '../../utils/anticheat';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const RANK_TIERS = [
  { min: 0,     title: 'ROOKIE HUNTER',  icon: 'footsteps-outline', color: '#9e9e9e' },
  { min: 100,   title: 'SCOUT',          icon: 'eye-outline',       color: '#78909c' },
  { min: 500,   title: 'TRACKER',        icon: 'compass-outline',   color: '#4caf50' },
  { min: 1500,  title: 'STALKER',        icon: 'navigate-outline',  color: '#2196f3' },
  { min: 3000,  title: 'PROWLER',        icon: 'flash-outline',     color: '#7c4dff' },
  { min: 5000,  title: 'ENFORCER',       icon: 'flame-outline',     color: '#ff9100' },
  { min: 10000, title: 'APEX HUNTER',    icon: 'diamond-outline',   color: '#f50057' },
  { min: 25000, title: 'LEGEND',         icon: 'star',              color: '#ffd700' },
  { min: 50000, title: 'MYTHIC PROWLER', icon: 'crown',             color: '#ffd700', iconLib: 'mci' as const },
];

function getRankForCoins(prowlCoins: number) {
  let rank = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (prowlCoins >= tier.min) rank = tier;
  }
  return rank;
}

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

// ---------------------------------------------------------------------------
// Leaflet iframe
// ---------------------------------------------------------------------------

function LeafletMap({ lat, lng, nearbyPlayers, session, coinDrops, commandRef }: {
  lat: number;
  lng: number;
  nearbyPlayers: NearbyPlayer[];
  session: GameSession | null;
  coinDrops: CoinDrop[];
  commandRef?: React.MutableRefObject<((cmd: any) => void) | null>;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

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
  @keyframes coin-pulse{
    0%{transform:scale(1);opacity:0.8;box-shadow:0 0 0 0 rgba(255,215,0,0.7)}
    70%{transform:scale(1.2);opacity:1;box-shadow:0 0 0 10px rgba(255,215,0,0)}
    100%{transform:scale(1);opacity:0.8;box-shadow:0 0 0 0 rgba(255,215,0,0)}
  }
  .enemy-marker{
    width:16px;height:16px;border-radius:50%;
    background:#ff1744;border:2px solid #ff1744;
    box-shadow:0 0 8px #ff1744;
    position:relative;
    cursor:pointer;
  }
  .enemy-marker:hover{
    transform:scale(1.3);
    box-shadow:0 0 16px #ff1744;
  }
  .enemy-marker.shielded{
    background:#7c4dff;border-color:#7c4dff;
    box-shadow:0 0 8px #7c4dff;
  }
  .enemy-marker.shielded:hover{
    box-shadow:0 0 16px #7c4dff;
  }
  .enemy-info{
    display:flex;flex-direction:column;align-items:center;
    margin-top:2px;pointer-events:none;
  }
  .enemy-name{
    color:#ff1744;font-size:10px;font-weight:700;
    text-align:center;white-space:nowrap;
    text-shadow:0 0 4px rgba(0,0,0,0.8);
    letter-spacing:1px;
  }
  .coin-marker{
    width:18px;height:18px;border-radius:50%;
    background:#ffd700;border:2px solid #ffb300;
    box-shadow:0 0 10px #ffd700,0 0 20px #ffd70060;
    display:flex;align-items:center;justify-content:center;
    font-size:10px;font-weight:900;color:#0a0e1a;
    cursor:pointer;
    user-select:none;
  }
  .coin-marker:hover{
    transform:scale(1.4);
    box-shadow:0 0 20px #ffd700;
  }
  .coin-amount{
    color:#ffd700;font-size:9px;font-weight:700;
    text-shadow:0 0 4px rgba(0,0,0,0.9);
    pointer-events:none;
  }
  .leaflet-marker-icon{
    transition:transform 0.3s linear !important;
  }
  .leaflet-marker-icon.enemy-icon{
    transition:transform 1s linear !important;
  }
  .zoomed-out .leaflet-marker-icon.enemy-icon{
    transition:none !important;
  }
  .enemy-marker-simple{
    width:8px;height:8px;border-radius:50%;
    border:1px solid;
    opacity:0.8;
  }
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
var zoomMode = 'player';
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
  maxZoom:19
}).addTo(map);

var playerIcon = L.divIcon({className:'',html:'<div class="player-pulse"></div><div class="player-marker"></div>',iconSize:[14,14],iconAnchor:[7,7]});
var playerMarker = L.marker([0,0],{icon:playerIcon}).addTo(map);
var radiusCircle = null;
var enemyMarkers = {};
var enemyData = {};
var coinMarkers = {};
var currentZoom = 16;
var isZoomedOut = false;

map.on('zoomend',function(){
  currentZoom = map.getZoom();
  var wasZoomedOut = isZoomedOut;
  isZoomedOut = currentZoom < 13;
  var el = document.getElementById('map');
  if(isZoomedOut) el.classList.add('zoomed-out');
  else el.classList.remove('zoomed-out');
  if(wasZoomedOut !== isZoomedOut) refreshEnemyIcons();
});

function refreshEnemyIcons(){
  Object.keys(enemyMarkers).forEach(function(k){
    var ed = enemyData[k];
    if(ed) enemyMarkers[k].setIcon(makeEnemyIcon(ed));
  });
}

function makeEnemyIcon(en){
  if(isZoomedOut){
    var c = en.tierColor || '#ff1744';
    var html = '<div class="enemy-marker-simple" style="background:'+c+';border-color:'+c+';"></div>';
    return L.divIcon({className:'enemy-icon',html:html,iconSize:[8,8],iconAnchor:[4,4]});
  }
  var cls = en.shielded ? 'enemy-marker shielded' : 'enemy-marker';
  var markerStyle = en.shielded ? '' : 'background:'+en.tierColor+';border-color:'+en.tierColor+';box-shadow:0 0 8px '+en.tierColor+';';
  var html = '<div class="'+cls+'" data-sid="'+en.sid+'" style="'+markerStyle+'"></div>'
    +'<div class="enemy-info">'
    +'<span class="enemy-name" style="color:'+en.tierColor+'">'+en.name+'</span>'
    +'</div>';
  return L.divIcon({className:'enemy-icon',html:html,iconSize:[16,32],iconAnchor:[8,8]});
}

function makeCoinIcon(amount){
  var html = '<div class="coin-marker">C</div>'
    +'<div class="coin-amount" style="text-align:center;margin-top:1px;">'+amount+'</div>';
  return L.divIcon({className:'',html:html,iconSize:[18,32],iconAnchor:[9,9]});
}

window.addEventListener('message',function(e){
  try{
    var d = JSON.parse(e.data);

    if(d.type==='movePlayer'){
      var sid = d.sid;
      if(enemyMarkers[sid]){
        if(isZoomedOut){
          var b = map.getBounds();
          if(!b.contains([d.lat,d.lng])){
            enemyMarkers[sid].setLatLng([d.lat,d.lng]);
            if(map.hasLayer(enemyMarkers[sid])) map.removeLayer(enemyMarkers[sid]);
          } else {
            if(!map.hasLayer(enemyMarkers[sid])) map.addLayer(enemyMarkers[sid]);
            enemyMarkers[sid].setLatLng([d.lat,d.lng]);
          }
        } else {
          enemyMarkers[sid].setLatLng([d.lat,d.lng]);
        }
      }
      return;
    }

    if(d.type==='setZoom'){
      zoomMode = d.mode;
      if(d.mode==='world'){
        var bounds = [playerMarker.getLatLng()];
        Object.keys(enemyMarkers).forEach(function(k){bounds.push(enemyMarkers[k].getLatLng());});
        Object.keys(coinMarkers).forEach(function(k){bounds.push(coinMarkers[k].getLatLng());});
        if(bounds.length>1) map.fitBounds(L.latLngBounds(bounds),{padding:[40,40],animate:true,duration:0.8});
        else map.setZoom(6,{animate:true});
      } else {
        map.setView(playerMarker.getLatLng(),16,{animate:true,duration:0.8});
      }
      return;
    }

    if(d.type==='update'||d.type==='init'){
      if(d.type==='init'){
        map.setView([d.lat,d.lng],16,{animate:false});
      } else if(zoomMode==='player'){
        map.setView([d.lat,d.lng],map.getZoom(),{animate:true,duration:1.5,easeLinearity:0.1,noMoveStart:true});
      }
      playerMarker.setLatLng([d.lat,d.lng]);

      if(d.hasSession && !radiusCircle){
        radiusCircle = L.circle([d.lat,d.lng],{radius:402,color:'#00e5ff',fillColor:'#00e5ff',fillOpacity:0.05,weight:1,opacity:0.4,dashArray:'8 4'}).addTo(map);
      }
      if(radiusCircle){
        radiusCircle.setLatLng([d.lat,d.lng]);
        if(!d.hasSession){map.removeLayer(radiusCircle);radiusCircle=null;}
      }

      // Update enemy markers — reuse existing for smooth transitions
      var currentEnemyIds = {};
      var viewBounds = map.getBounds();
      if(d.enemies){
        d.enemies.forEach(function(en){
          currentEnemyIds[en.sid] = true;
          enemyData[en.sid] = en;
          if(enemyMarkers[en.sid]){
            enemyMarkers[en.sid].setLatLng([en.lat,en.lng]);
            if(!isZoomedOut) enemyMarkers[en.sid].setIcon(makeEnemyIcon(en));
            if(isZoomedOut && !viewBounds.contains([en.lat,en.lng])){
              if(map.hasLayer(enemyMarkers[en.sid])) map.removeLayer(enemyMarkers[en.sid]);
            } else if(!map.hasLayer(enemyMarkers[en.sid])){
              map.addLayer(enemyMarkers[en.sid]);
            }
          } else {
            var icon = makeEnemyIcon(en);
            var shouldAdd = !isZoomedOut || viewBounds.contains([en.lat,en.lng]);
            var m = L.marker([en.lat,en.lng],{icon:icon});
            if(shouldAdd) m.addTo(map);
            (function(enemy){
              m.on('click',function(){
                (window.ReactNativeWebView||window.parent).postMessage(JSON.stringify({
                  type:'attackPlayer',
                  sessionId:enemy.sid,
                  username:enemy.name,
                  tierColor:enemy.tierColor,
                  shielded:enemy.shielded,
                  prowl:enemy.prowl||0
                }),'*');
              });
            })(en);
            enemyMarkers[en.sid] = m;
          }
        });
      }
      // Remove markers for players who left
      Object.keys(enemyMarkers).forEach(function(sid){
        if(!currentEnemyIds[sid]){
          map.removeLayer(enemyMarkers[sid]);
          delete enemyMarkers[sid];
          delete enemyData[sid];
        }
      });

      // Update coin drop markers — reuse existing for smooth transitions
      var currentCoinIds = {};
      if(d.coins){
        d.coins.forEach(function(c){
          currentCoinIds[c.id] = true;
          if(!coinMarkers[c.id]){
            var icon = makeCoinIcon(c.amount);
            var m = L.marker([c.lat,c.lng],{icon:icon}).addTo(map);
            (function(coin){
              m.on('click',function(){
                (window.ReactNativeWebView||window.parent).postMessage(JSON.stringify({
                  type:'collectCoin',
                  id:coin.id,
                  amount:coin.amount
                }),'*');
              });
            })(c);
            coinMarkers[c.id] = m;
          }
        });
      }
      Object.keys(coinMarkers).forEach(function(id){
        if(!currentCoinIds[id]){
          map.removeLayer(coinMarkers[id]);
          delete coinMarkers[id];
        }
      });

      if(d.type==='init'){
        (window.ReactNativeWebView||window.parent).postMessage(JSON.stringify({type:'ready'}),'*');
      }
    }
  }catch(ex){}
});
(window.ReactNativeWebView||window.parent).postMessage(JSON.stringify({type:'ready'}),'*');
</script>
</body>
</html>`;

  const webViewRef = useRef<any>(null);

  const sendCommand = useCallback((cmd: any) => {
    const payload = JSON.stringify(cmd);
    if (Platform.OS === 'web') {
      if (!iframeRef.current?.contentWindow) return;
      iframeRef.current.contentWindow.postMessage(payload, '*');
    } else {
      if (!webViewRef.current) return;
      webViewRef.current.injectJavaScript(`
        try {
          var e = new MessageEvent('message', { data: '${payload.replace(/'/g, "\\'")}' });
          window.dispatchEvent(e);
        } catch(ex) {}
        true;
      `);
    }
  }, []);

  useEffect(() => {
    if (commandRef) commandRef.current = sendCommand;
  }, [commandRef, sendCommand]);

  const buildPayload = useCallback(() => {
    const withDist = nearbyPlayers.map(p => {
      const dLat = p.latitude - lat;
      const dLng = p.longitude - lng;
      return { ...p, _dist: dLat * dLat + dLng * dLng };
    });
    withDist.sort((a, b) => a._dist - b._dist);
    const closest = withDist.slice(0, 500);
    const enemies = closest.map(p => ({
      name: p.username.substring(0, 8),
      lat: p.latitude,
      lng: p.longitude,
      tierColor: p.coinTier ? getTierColor(p.coinTier) : '#ffd700',
      shielded: p.shieldActive,
      sid: p.sessionId,
      prowl: p.prowlBalance ?? 0,
    }));
    const coins = coinDrops.map(c => ({
      id: c.id,
      lat: c.latitude,
      lng: c.longitude,
      amount: c.amount,
    }));
    return JSON.stringify({
      type: ready ? 'update' : 'init',
      lat, lng,
      hasSession: !!session,
      enemies,
      coins,
    });
  }, [lat, lng, nearbyPlayers, coinDrops, session, ready]);

  // Web: listen for postMessage from iframe
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'ready') setReady(true);
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Send data to map (web: iframe, native: WebView)
  useEffect(() => {
    const payload = buildPayload();
    if (Platform.OS === 'web') {
      if (!iframeRef.current?.contentWindow) return;
      iframeRef.current.contentWindow.postMessage(payload, '*');
    } else {
      if (!webViewRef.current) return;
      webViewRef.current.injectJavaScript(`
        try {
          var e = new MessageEvent('message', { data: '${payload.replace(/'/g, "\\'")}' });
          window.dispatchEvent(e);
        } catch(ex) {}
        true;
      `);
    }
  }, [lat, lng, nearbyPlayers, coinDrops, session, ready, buildPayload]);

  const handleNativeMessage = useCallback((event: any) => {
    try {
      const d = JSON.parse(event.nativeEvent.data);
      if (d.type === 'ready') setReady(true);
      if (d.type === 'attackPlayer') {
        // Forward to parent via a custom event the MapScreen can handle
        if ((global as any).__mapEventHandler) {
          (global as any).__mapEventHandler(d);
        }
      }
      if (d.type === 'collectCoin') {
        if ((global as any).__mapEventHandler) {
          (global as any).__mapEventHandler(d);
        }
      }
    } catch {}
  }, []);

  if (Platform.OS === 'web') {
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

  // Native: use WebView
  if (!WebView) return null;
  return (
    <WebView
      key={webViewKey}
      ref={webViewRef}
      originWhitelist={['*']}
      source={{ html }}
      style={{ flex: 1, backgroundColor: '#0a0e1a' }}
      onMessage={handleNativeMessage}
      onContentProcessDidTerminate={() => setWebViewKey(k => k + 1)}
      javaScriptEnabled
      domStorageEnabled
      geolocationEnabled
      allowsInlineMediaPlayback
      mixedContentMode="always"
    />
  );
}

// ---------------------------------------------------------------------------
// Main MapScreen
// ---------------------------------------------------------------------------

export default function MapScreen() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [nearbyPlayers, setNearbyPlayers] = useState<NearbyPlayer[]>([]);
  const [coinDrops, setCoinDrops] = useState<CoinDrop[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBuyIn, setShowBuyIn] = useState(false);

  // Attack confirmation overlay
  const [attackTarget, setAttackTarget] = useState<{
    sessionId: string;
    username: string;
    tierColor: string;
    shielded: boolean;
    prowlBalance: number;
  } | null>(null);
  const [attackResult, setAttackResult] = useState<string | null>(null);
  const [activityFeed, setActivityFeed] = useState<{ id: string; text: string; color: string; time: number }[]>([]);

  const addFeedItem = useCallback((text: string, color: string) => {
    const item = { id: Date.now().toString(), text, color, time: Date.now() };
    setActivityFeed((prev) => [item, ...prev].slice(0, 20));
  }, []);

  useEffect(() => {
    if (activityFeed.length === 0) return;
    const iv = setInterval(() => {
      setActivityFeed((prev) => prev.filter((item) => Date.now() - item.time < 60_000));
    }, 10_000);
    return () => clearInterval(iv);
  }, [activityFeed.length > 0]);

  const [statusMessage, setStatusMessage] = useState<string>('LIVE MAP');
  const [connectionLost, setConnectionLost] = useState(false);
  const [spawnSecsLeft, setSpawnSecsLeft] = useState(0);
  const [shieldSecsLeft, setShieldSecsLeft] = useState(0);
  const [zoomedOut, setZoomedOut] = useState(false);
  const mapRef = useRef<any>(null);
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const locationFallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLocationUpdate = useRef<number>(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coinPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketUnsubRef = useRef<(() => void) | null>(null);
  const sessionEndedRef = useRef(false);
  const sessionNullCountRef = useRef(0);

  useEffect(() => {
    if (Platform.OS === 'web' && MAP_CSS) {
      const style = document.createElement('style');
      style.textContent = MAP_CSS;
      document.head.appendChild(style);
      return () => { document.head.removeChild(style); };
    }
  }, []);

  // -------------------------------------------------------------------------
  // Spawn protection countdown (2 minutes after buy-in)
  // -------------------------------------------------------------------------
  const calcSpawn = useCallback(() => {
    if (!session?.spawnedAt) { setSpawnSecsLeft(0); return 0; }
    const elapsed = Date.now() - new Date(session.spawnedAt).getTime();
    const remaining = Math.max(0, 120 - Math.floor(elapsed / 1000));
    setSpawnSecsLeft(remaining);
    return remaining;
  }, [session?.spawnedAt]);

  const calcShield = useCallback(() => {
    if (!session?.shieldActiveUntil) { setShieldSecsLeft(0); return 0; }
    const remaining = Math.max(0, Math.floor((new Date(session.shieldActiveUntil).getTime() - Date.now()) / 1000));
    setShieldSecsLeft(remaining);
    return remaining;
  }, [session?.shieldActiveUntil]);

  useEffect(() => {
    if (calcSpawn() <= 0) return;
    const iv = setInterval(() => { if (calcSpawn() <= 0) clearInterval(iv); }, 1000);
    return () => clearInterval(iv);
  }, [calcSpawn]);

  // -------------------------------------------------------------------------
  // Shield countdown timer
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (calcShield() <= 0) return;
    const iv = setInterval(() => { if (calcShield() <= 0) clearInterval(iv); }, 1000);
    return () => clearInterval(iv);
  }, [calcShield]);

  // Recalculate timers + verify session when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        calcSpawn();
        calcShield();
        if (session && !sessionEndedRef.current) {
          try {
            const s = await getActiveSession();
            if (!s) {
              sessionEndedRef.current = true;
              Alert.alert(
                'SESSION ENDED',
                'Your session ended while the app was in the background. You may have been attacked. Buy in again to keep playing.',
                [{ text: 'OK', onPress: () => { setSession(null); setShowBuyIn(true); sessionEndedRef.current = false; sessionNullCountRef.current = 0; } }],
              );
            } else {
              setSession(s);
            }
          } catch {}
        }
      }
    });
    return () => sub.remove();
  }, [calcSpawn, calcShield, session]);

  // -------------------------------------------------------------------------
  // Location permission + GPS watch
  // -------------------------------------------------------------------------
  const startLocationWatch = useCallback(async () => {
    // Clean up any existing watcher
    locationSub.current?.remove();
    if (locationFallbackRef.current) clearInterval(locationFallbackRef.current);

    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      lastLocationUpdate.current = Date.now();
      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {}

    locationSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 5 },
      (pos) => {
        if (checkMockLocation(pos)) {
          console.warn('[AntiCheat] Mock location detected, ignoring update');
          return;
        }
        lastLocationUpdate.current = Date.now();
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
    );

    // Fallback: if watchPosition stops firing (poor signal areas), poll every 8s
    locationFallbackRef.current = setInterval(async () => {
      if (Date.now() - lastLocationUpdate.current > 6000) {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          lastLocationUpdate.current = Date.now();
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        } catch {}
      }
    }, 8000);
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
      await startLocationWatch();
    })();
    return () => {
      locationSub.current?.remove();
      if (locationFallbackRef.current) clearInterval(locationFallbackRef.current);
    };
  }, [startLocationWatch]);

  // Restart GPS watcher when app returns to foreground
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && locationPermission) {
        startLocationWatch();
      }
    });
    return () => sub.remove();
  }, [locationPermission, startLocationWatch]);

  // -------------------------------------------------------------------------
  // Initial session fetch
  // -------------------------------------------------------------------------
  const refreshSession = useCallback(async (allowNull = false) => {
    try {
      const s = await getActiveSession();
      if (s || allowNull) setSession(s);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      await refreshSession(true);
      setLoading(false);
    })();
  }, [refreshSession]);

  // -------------------------------------------------------------------------
  // Socket.io — real-time player movement
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!session || !location) return;

    let alive = true;

    (async () => {
      await connectSocket();
      if (!alive) return;

      // Subscribe to players:update events — pipe directly to WebView for smooth animation
      // NOTE: We intentionally do NOT update React state here. The direct WebView
      // command handles the visual update. React state is refreshed by the REST poll
      // every 30s. This avoids a full state rebuild + payload resubmission on every
      // single player movement, which was the main source of lag.
      const unsub = onPlayersUpdate((data) => {
        const sid = data.sessionId || data.userId;
        if (mapRef.current) {
          mapRef.current({ type: 'movePlayer', sid, lat: data.lat, lng: data.lng });
        }
      });
      socketUnsubRef.current = unsub;

      // Subscribe to batch updates from bot AI (one event with all bot positions)
      const unsubBatch = onBatchUpdate((bots) => {
        if (mapRef.current) {
          for (const b of bots) {
            const sid = b.sessionId || b.userId;
            mapRef.current({ type: 'movePlayer', sid, lat: b.lat, lng: b.lng });
          }
        }
      });

      // Listen for elimination (PvP attack killed your session)
      const unsubElim = onEliminated((data) => {
        sessionEndedRef.current = true;
        addFeedItem(`${data.attackerName} attacked you and took ${data.coinsLost} coins!`, '#ff4444');
        Alert.alert(
          'YOU WERE ELIMINATED!',
          `${data.attackerName} attacked you and took ${data.coinsLost} coins!${data.coinsSaved > 0 ? ` ${data.coinsSaved} coins saved to wallet.` : ''} Buy in again to keep playing.`,
          [{ text: 'OK', onPress: () => { setSession(null); setShowBuyIn(true); sessionEndedRef.current = false; } }],
        );
      });

      // Listen for bot attacks
      const unsubBot = onBotHit((data) => {
        setAttackResult(data.message);
        addFeedItem(data.message, '#ff8800');
        refreshSession();
        setTimeout(() => setAttackResult(null), 4000);
      });

      const unsubConn = onConnectionChange(async (connected) => {
        setConnectionLost(!connected);
        if (connected && !sessionEndedRef.current) {
          try {
            const currentSession = await getActiveSession();
            if (!currentSession) {
              sessionEndedRef.current = true;
              Alert.alert(
                'SESSION ENDED',
                'Your session ended while you were disconnected. You may have been attacked. Buy in again to keep playing.',
                [{ text: 'OK', onPress: () => { setSession(null); setShowBuyIn(true); sessionEndedRef.current = false; sessionNullCountRef.current = 0; } }],
              );
            }
          } catch {
            // Network still unstable — don't falsely end session, let the REST poll handle it
          }
        }
      });

      return () => {
        unsubElim();
        unsubBot();
        unsubBatch();
        unsubConn();
      };
    })();

    return () => {
      alive = false;
      if (socketUnsubRef.current) {
        socketUnsubRef.current();
        socketUnsubRef.current = null;
      }
    };
  }, [session?.id]);

  // Instant network state detection via NetInfo
  useEffect(() => {
    if (!session) return;
    const unsubNet = NetInfo.addEventListener((state) => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setConnectionLost(offline);
    });
    return () => unsubNet();
  }, [session?.id]);

  // Emit location via socket whenever GPS updates
  useEffect(() => {
    if (!session || !location) return;
    emitLocation(location.lat, location.lng);
  }, [location?.lat, location?.lng, session?.id]);

  // Disconnect socket and stop background location when session ends
  useEffect(() => {
    if (!session) {
      disconnectSocket();
      stopBackgroundLocation();
    } else {
      startBackgroundLocation();
      registerForPushNotifications().catch(() => {});
    }
  }, [session]);

  // -------------------------------------------------------------------------
  // REST polling — player list (reduced to 30s since socket handles live moves)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!session || !location) return;

    const poll = async () => {
      try {
        const currentSession = await getActiveSession();
        if (!currentSession && session) {
          sessionNullCountRef.current += 1;
          // Require 5 consecutive null checks (50s) before declaring session ended
          // — prevents false alerts during connectivity drops
          if (sessionNullCountRef.current < 5) return;
          if (sessionEndedRef.current) return;
          sessionEndedRef.current = true;
          Alert.alert(
            'SESSION ENDED',
            'Your session has been terminated. You may have been attacked! Buy in again to keep playing.',
            [{ text: 'OK', onPress: () => { setSession(null); setShowBuyIn(true); sessionEndedRef.current = false; sessionNullCountRef.current = 0; } }],
          );
          return;
        }
        sessionNullCountRef.current = 0;
        if (currentSession) setSession(currentSession);
        await updateLocation(location.lat, location.lng);
        const { players, totalOnMap } = await getAllPlayers();
        setNearbyPlayers(players);
        setStatusMessage(`${totalOnMap} HUNTER${totalOnMap !== 1 ? 'S' : ''} ON MAP`);
      } catch {
        // Network error — don't count as session null, just skip this cycle
      }
    };

    poll();
    // Poll every 10s — check session status + update player list
    pollRef.current = setInterval(poll, 10_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session?.id, location?.lat, location?.lng]);

  // -------------------------------------------------------------------------
  // Coin drops — fetch every 15s
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (coinPollRef.current) clearInterval(coinPollRef.current);
    if (!session || !location) return;

    const fetchCoins = async () => {
      try {
        const drops = await getCoinDrops();
        setCoinDrops(drops);
      } catch {}
    };

    fetchCoins();
    coinPollRef.current = setInterval(fetchCoins, 15_000);

    return () => {
      if (coinPollRef.current) clearInterval(coinPollRef.current);
    };
  }, [session?.id, location?.lat, location?.lng]);

  // -------------------------------------------------------------------------
  // iframe postMessage handler — attack + collect events from Leaflet
  // -------------------------------------------------------------------------
  useEffect(() => {
    const mapHandler = (d: any) => {
      if (d.type === 'attackPlayer') {
        setAttackTarget({
          sessionId: d.sessionId,
          username: d.username,
          tierColor: d.tierColor || '#ffd700',
          shielded: !!d.shielded,
          prowlBalance: d.prowl || 0,
        });
      }
      if (d.type === 'collectCoin') {
        handleCollectCoin(d.id, d.amount);
      }
    };

    // Native: global handler called from WebView onMessage
    (global as any).__mapEventHandler = mapHandler;

    // Web: listen to postMessage
    if (Platform.OS === 'web') {
      const handler = (e: MessageEvent) => {
        try { mapHandler(JSON.parse(e.data)); } catch {}
      };
      window.addEventListener('message', handler);
      return () => {
        window.removeEventListener('message', handler);
        delete (global as any).__mapEventHandler;
      };
    }

    return () => { delete (global as any).__mapEventHandler; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // -------------------------------------------------------------------------
  // Attack handler
  // -------------------------------------------------------------------------
  const handleAttack = async () => {
    if (!attackTarget) return;
    if (spawnSecsLeft > 0) {
      setAttackResult(`Spawn protection active! Wait ${spawnSecsLeft}s before attacking.`);
      setTimeout(() => setAttackResult(null), 3000);
      setAttackTarget(null);
      return;
    }
    const target = attackTarget;
    setAttackTarget(null);

    try {
      const result = await attackPlayer(target.sessionId);
      const msg = result.success
        ? `ATTACK SUCCESS! Stole ${result.coinsStolen} coins from ${target.username}!`
        : `ATTACK BLOCKED! ${target.username} had a shield.`;
      setAttackResult(msg);
      addFeedItem(
        result.success
          ? `You attacked ${target.username} and took ${result.coinsStolen} coins!`
          : `You attacked ${target.username} but their shield blocked it.`,
        result.success ? '#00e676' : '#ffaa00',
      );
      await refreshSession();
      setTimeout(() => setAttackResult(null), 4000);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.toLowerCase().includes('no active session') || msg.toLowerCase().includes('session')) {
        const currentSession = await getActiveSession().catch(() => null);
        if (!currentSession) {
          sessionEndedRef.current = true;
          Alert.alert(
            'SESSION ENDED',
            'Your session has ended. You may have been attacked while your connection was unstable. Buy in again to keep playing.',
            [{ text: 'OK', onPress: () => { setSession(null); setShowBuyIn(true); sessionEndedRef.current = false; sessionNullCountRef.current = 0; } }],
          );
          return;
        }
      }
      setAttackResult(`Attack failed: ${msg}`);
      setTimeout(() => setAttackResult(null), 3000);
    }
  };

  // -------------------------------------------------------------------------
  // Coin collect handler
  // -------------------------------------------------------------------------
  const handleCollectCoin = async (dropId: string, amount: number) => {
    try {
      const result = await collectCoinDrop(dropId);
      setAttackResult(`+${result.amount} COIN${result.amount !== 1 ? 'S' : ''} ADDED TO WALLET!`);
      setCoinDrops(prev => prev.filter(c => c.id !== dropId));
      setTimeout(() => setAttackResult(null), 3000);
    } catch (err: any) {
      setAttackResult(err.message?.includes('Too far') ? 'MOVE CLOSER TO COLLECT!' : 'Already collected!');
      setTimeout(() => setAttackResult(null), 2500);
    }
  };

  // -------------------------------------------------------------------------
  // Shield handler
  // -------------------------------------------------------------------------
  const handleBuyShield = () => {
    const bought24h = session?.shieldsBought24h ?? 0;
    const remaining = 3 - bought24h;
    if (remaining <= 0) return;
    Alert.alert(
      'Buy Shield?',
      `Purchase a shield for $1 (active for 10 minutes). You can buy ${remaining} more today.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Buy $1',
          onPress: async () => {
            try {
              const updated = await buyShield();
              setSession(updated);
            } catch {}
          },
        },
      ],
    );
  };

  const shieldIsActive = shieldSecsLeft > 0 && !!session?.shieldActiveUntil;

  const ATTACK_RADIUS_MILES = 0.25;
  const [targetIndex, setTargetIndex] = useState(0);
  const playersInRange = React.useMemo(() => {
    if (!session || !location || nearbyPlayers.length === 0) return [];
    const inRange: { player: NearbyPlayer; dist: number }[] = [];
    for (const p of nearbyPlayers) {
      const dLat = (p.latitude - location.lat) * Math.PI / 180;
      const dLng = (p.longitude - location.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(location.lat * Math.PI / 180) * Math.cos(p.latitude * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      const dist = 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (dist <= ATTACK_RADIUS_MILES) {
        inRange.push({ player: p, dist });
      }
    }
    inRange.sort((a, b) => a.dist - b.dist);
    return inRange.map(x => x.player);
  }, [session, location, nearbyPlayers]);
  const nearestInRange = playersInRange.length > 0 ? playersInRange[Math.min(targetIndex, playersInRange.length - 1)] : null;
  useEffect(() => { if (targetIndex >= playersInRange.length) setTargetIndex(0); }, [playersInRange.length, targetIndex]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
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
        <Text style={styles.permissionSub}>Enable location permission to play CoinProwl</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Real map — works on both web (iframe) and native (WebView) */}
      {location && (
        <LeafletMap
          lat={location.lat}
          lng={location.lng}
          nearbyPlayers={nearbyPlayers}
          session={session}
          coinDrops={coinDrops}
          commandRef={mapRef}
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
              <Ionicons name="cash-outline" size={14} color={getTierColor(session.coinTier)} />
              <Text style={styles.coinsText}>{session.mapCoins}</Text>
            </View>
          )}
        </View>

        {connectionLost && session && (
          <View style={styles.connectionBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
            <Text style={styles.connectionBannerText}>Connection lost — reconnecting...</Text>
          </View>
        )}

        {/* Session HUD cards */}
        {session && (
          <View style={styles.hudRow}>
            <View style={styles.hudCard}>
              <Ionicons name="cash-outline" size={18} color={getTierColor(session.coinTier)} />
              <Text style={[styles.hudValue, { color: getTierColor(session.coinTier) }]}>{session.mapCoins}</Text>
              <Text style={styles.hudLabel}>COINS</Text>
            </View>
            <View style={styles.hudCard}>
              <Ionicons name="shield" size={18} color={shieldIsActive ? colors.primary : colors.textMuted} />
              <Text style={[styles.hudValue, { color: shieldIsActive ? colors.primary : colors.text }]}>
                {shieldIsActive
                  ? `${Math.floor(shieldSecsLeft / 60)}:${(shieldSecsLeft % 60).toString().padStart(2, '0')}`
                  : 'OFF'}
              </Text>
              <Text style={styles.hudLabel}>{`${session?.shieldsBought24h ?? 0}/3 TODAY`}</Text>
            </View>
            <View style={styles.hudCard}>
              <Ionicons name="people" size={18} color={nearbyPlayers.length > 0 ? colors.secondary : colors.textMuted} />
              <Text style={[styles.hudValue, { color: nearbyPlayers.length > 0 ? colors.secondary : colors.text }]}>
                {nearbyPlayers.length}
              </Text>
              <Text style={styles.hudLabel}>NEARBY</Text>
            </View>
            <View style={styles.hudCard}>
              <Text style={{ fontSize: 16 }}>💰</Text>
              <Text style={[styles.hudValue, { color: coinDrops.length > 0 ? colors.gold : colors.text }]}>
                {coinDrops.length}
              </Text>
              <Text style={styles.hudLabel}>DROPS</Text>
            </View>
          </View>
        )}

        {/* Spawn protection countdown */}
        {spawnSecsLeft > 0 && (
          <View style={styles.spawnBanner}>
            <Ionicons name="shield-checkmark" size={18} color="#00e5ff" />
            <Text style={styles.spawnText}>
              SPAWN PROTECTION {Math.floor(spawnSecsLeft / 60)}:{(spawnSecsLeft % 60).toString().padStart(2, '0')}
            </Text>
          </View>
        )}

        {/* Location coords + zoom toggle */}
        {location && (
          <View style={styles.locationRow}>
            <View style={styles.locationBar}>
              <Ionicons name="location" size={12} color={colors.primary} />
              <Text style={styles.locationText}>
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              </Text>
            </View>
            {session && (
              <TouchableOpacity
                style={[styles.zoomBtn, zoomedOut && styles.zoomBtnActive]}
                onPress={() => {
                  const newMode = !zoomedOut;
                  setZoomedOut(newMode);
                  if (mapRef.current) {
                    mapRef.current({ type: 'setZoom', mode: newMode ? 'world' : 'player' });
                  }
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={zoomedOut ? 'locate' : 'globe-outline'}
                  size={16}
                  color={zoomedOut ? colors.background : colors.primary}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Result toast (attacks + coin collects) */}
        {attackResult && (
          <View style={[
            styles.toastBanner,
            attackResult.includes('COIN') && { borderColor: colors.gold + '60' },
          ]}>
            <Ionicons
              name={
                attackResult.includes('SUCCESS') || attackResult.includes('COIN')
                  ? 'checkmark-circle'
                  : 'close-circle'
              }
              size={16}
              color={
                attackResult.includes('COIN')
                  ? colors.gold
                  : attackResult.includes('SUCCESS') ? colors.success : colors.error
              }
            />
            <Text style={styles.toastText}>{attackResult}</Text>
          </View>
        )}

        {/* Activity feed */}
        {activityFeed.length > 0 && (
          <View style={styles.feedContainer} pointerEvents="none">
            {activityFeed.slice(0, 2).map((item, idx) => (
              <View key={item.id} style={[styles.feedItem, { opacity: 1 - idx * 0.3 }]}>
                <View style={[styles.feedDot, { backgroundColor: item.color }]} />
                <Text style={styles.feedText} numberOfLines={1}>{item.text}</Text>
                <Text style={styles.feedTime}>
                  {Math.floor((Date.now() - item.time) / 60000) > 0
                    ? `${Math.floor((Date.now() - item.time) / 60000)}m`
                    : 'now'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Attack confirmation overlay — shown when enemy marker is tapped */}
        {attackTarget && (() => {
          const targetRank = getRankForCoins(attackTarget.prowlBalance);
          return (
            <View style={styles.attackPanel} pointerEvents="auto">
              <Text style={styles.attackPanelTitle}>ATTACK TARGET</Text>
              <Text style={[styles.attackPanelName, { color: attackTarget.tierColor }]}>{attackTarget.username.toUpperCase()}</Text>
              <View style={styles.attackRankBadge}>
                {(targetRank as any).iconLib === 'mci'
                  ? <MaterialCommunityIcons name={targetRank.icon as any} size={14} color={targetRank.color} />
                  : <Ionicons name={targetRank.icon as any} size={14} color={targetRank.color} />}
                <Text style={[styles.attackRankText, { color: targetRank.color }]}>{targetRank.title}</Text>
              </View>
              {attackTarget.shielded && (
                <View style={styles.shieldWarning}>
                  <Ionicons name="shield" size={14} color={colors.warning} />
                  <Text style={styles.shieldWarningText}>SHIELD ACTIVE — ATTACK BLOCKED</Text>
                </View>
              )}
              <View style={styles.attackPanelBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setAttackTarget(null)}>
                  <Text style={styles.cancelBtnText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attackConfirmBtn} onPress={handleAttack}>
                  <Ionicons name="flash" size={16} color="#fff" />
                  <Text style={styles.attackConfirmText}>ATTACK</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}

        {/* Spacer pushes action buttons to bottom */}
        <View style={{ flex: 1 }} />

        {/* Action buttons at bottom */}
        <View style={styles.actionRow} pointerEvents="auto">
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
              {playersInRange.length > 1 && (
                <TouchableOpacity
                  style={styles.cycleBtn}
                  onPress={() => setTargetIndex(i => (i + 1) % playersInRange.length)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="swap-horizontal" size={18} color={colors.primary} />
                  <Text style={styles.cycleBtnText}>{targetIndex + 1}/{playersInRange.length}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.attackBtn, !nearestInRange && styles.attackBtnDisabled]}
                onPress={() => {
                  if (nearestInRange) {
                    setAttackTarget({
                      sessionId: nearestInRange.sessionId,
                      username: nearestInRange.username,
                      tierColor: nearestInRange.coinTier ? getTierColor(nearestInRange.coinTier) : '#ffd700',
                      shielded: nearestInRange.shieldActive,
                      prowlBalance: nearestInRange.prowlBalance ?? 0,
                    });
                  }
                }}
                activeOpacity={nearestInRange ? 0.85 : 1}
              >
                <Ionicons name="flash" size={18} color={nearestInRange ? '#fff' : colors.textMuted} />
                <Text style={[styles.attackBtnText, !nearestInRange && { color: colors.textMuted }]}>
                  {nearestInRange ? `ATTACK ${nearestInRange.username.substring(0, 8).toUpperCase()}` : 'NO TARGET IN RANGE'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shieldBtn, shieldIsActive && styles.shieldBtnActive, (session?.shieldsBought24h ?? 0) >= 3 && !shieldIsActive && styles.shieldBtnUsed]}
                onPress={handleBuyShield}
                disabled={shieldIsActive || (session?.shieldsBought24h ?? 0) >= 3}
              >
                <Ionicons
                  name="shield"
                  size={18}
                  color={shieldIsActive ? colors.background : (session?.shieldsBought24h ?? 0) >= 3 ? colors.textMuted : colors.primary}
                />
                <Text style={{ fontSize: 9, color: shieldIsActive ? colors.background : colors.textMuted, fontWeight: '700' }}>
                  {shieldIsActive ? 'ON' : (session?.shieldsBought24h ?? 0) >= 3 ? 'MAX' : '$1'}
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
    paddingTop: Platform.OS === 'ios' ? 54 : spacing.lg,
    backgroundColor: 'rgba(10, 14, 26, 0.85)',
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#d32f2f',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    marginTop: 4,
  },
  connectionBannerText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: '600',
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
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(10, 14, 26, 0.7)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  locationText: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  zoomBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(10, 14, 26, 0.8)',
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  spawnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    marginHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.4)',
  },
  spawnText: {
    fontSize: fontSize.sm,
    fontWeight: '700' as const,
    color: '#00e5ff',
    letterSpacing: 1,
  },
  feedContainer: {
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    gap: 3,
  },
  feedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    borderRadius: borderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  feedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  feedText: {
    flex: 1,
    fontSize: 11,
    color: colors.text,
    fontWeight: '600',
  },
  feedTime: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '600',
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
    backgroundColor: 'rgba(17, 24, 39, 0.97)',
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
  attackRankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(26, 34, 53, 0.8)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  attackRankText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  attackPanelTierDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    alignSelf: 'center',
    marginVertical: spacing.xs,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
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
  attackBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.secondary,
  },
  attackBtnDisabled: {
    backgroundColor: 'rgba(26, 34, 53, 0.9)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cycleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  cycleBtnText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: fontSize.xs,
    letterSpacing: 1,
  },
  attackBtnText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
  shieldBtn: {
    width: 52,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
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
  shieldBtnUsed: {
    borderColor: colors.border,
    opacity: 0.5,
  },
  shieldBtnText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: fontSize.sm,
    letterSpacing: 1,
  },
});
