import path from 'path';
import { config } from './config/env';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import authRoutes from './routes/auth';
import gameRoutes from './routes/game';
import walletRoutes from './routes/wallet';
import adminRoutes from './routes/admin';
import publicRoutes from './routes/public';
import paypalRoutes from './routes/paypal';
import iapRoutes from './routes/iap';
import { setupGameSocket } from './socket/gameSocket';
import { setIO } from './socket/ioInstance';
import { startBotAI } from './bot/botAI';
import referralRoutes from './routes/referrals';
import { REFERRAL_SCHEMA } from './services/referrals';
import { query as dbQuery } from './config/database';

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip}`);
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/iap', iapRoutes);
app.use('/api/referrals', referralRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Basemap style
//
// The game map, the public live map and the admin map all draw their base layer
// from this one file. It used to be CARTO's keyless raster tiles, until CARTO
// began stamping "API KEY REQUIRED" across them, which showed up mid-game for
// every player.
//
// Serving it from here (rather than baking it into the app) means the map's
// colours — or the tile provider itself, if this one ever does the same — can be
// changed by editing public/website/map-style.json and restarting. No app
// release, no store review. The mobile client falls back to the copy bundled in
// its build if this is unreachable, so the map always draws.
//
// This needs an explicit route: the SPA catch-all below answers unknown paths
// with index.html and a 200, which would otherwise hand clients HTML that looks
// like a successful style fetch.
const mapStylePath = path.resolve(__dirname, '../public/website/map-style.json');
app.get('/map-style.json', (_req, res) => {
  res.type('application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(mapStylePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'map style not found' });
  });
});

// ---------------------------------------------------------------------------
// Serve admin dashboard
// ---------------------------------------------------------------------------
const adminPath = path.resolve(__dirname, '../public/admin');
app.use('/admin', express.static(adminPath));

// ---------------------------------------------------------------------------
// Download / get-the-app smart redirect (iOS -> App Store, Android -> Play)
// ---------------------------------------------------------------------------
const downloadPage = path.resolve(__dirname, '../public/download/index.html');
app.get(['/download', '/get', '/app'], (_req, res) => {
  res.sendFile(downloadPage);
});

// ---------------------------------------------------------------------------
// Invite links: coinprowl.com/r/CODE -> the game in the browser with the code filled in on sign-up
// ---------------------------------------------------------------------------
app.get('/r/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  res.redirect(302, code ? `/play/?ref=${code}` : '/play/');
});

// ---------------------------------------------------------------------------
// The game in the browser: coinprowl.com/play (built by mobile/scripts/build-web.py)
// index.html / manifest must never be cached (a new build changes the bundle name); the hashed bundle and
// assets can be cached for good.
// ---------------------------------------------------------------------------
const playPath = path.resolve(__dirname, '../public/play');
app.use('/play', express.static(playPath, {
  setHeaders(res, filePath) {
    if (/index\.html$|\.webmanifest$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else if (/[\\/](_expo|assets)[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));
app.get(['/play', '/play/*'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(playPath, 'index.html'));
});

// ---------------------------------------------------------------------------
// Serve CoinProwl website
// ---------------------------------------------------------------------------
const websitePath = path.resolve(__dirname, '../public/website');
app.use(express.static(websitePath));
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path === '/health' || _req.path.startsWith('/socket.io') || _req.path.startsWith('/admin')) {
    return next();
  }
  res.sendFile(path.join(websitePath, 'index.html'));
});

// ---------------------------------------------------------------------------
// HTTP + Socket.io server
// ---------------------------------------------------------------------------
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

setIO(io);

// Wire up game socket handlers (auth + player:location + players:update)
setupGameSocket(io);

// Spectator namespace for live map website (no auth, receive-only)
const spectatorNs = io.of('/spectator');
spectatorNs.on('connection', (socket) => {
  socket.join('spectate');
});

// Start bot AI loop (bots move + attack every 5s)
startBotAI(io);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(config.port, () => {
  console.log(`[${config.appName}] Server running on port ${config.port}`);
});

// referral columns/table (idempotent; the schema has no other migration runner on the live server)
dbQuery(REFERRAL_SCHEMA)
  .then(() => console.log('[Referral] schema ready'))
  .catch((err) => console.error('[Referral] schema setup FAILED — referral endpoints will error:', err));

export { app, server, io };
