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

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

export { app, server, io };
