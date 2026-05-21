import path from 'path';
import { config } from './config/env';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import authRoutes from './routes/auth';
import gameRoutes from './routes/game';
import walletRoutes from './routes/wallet';
import { setupGameSocket } from './socket/gameSocket';

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/wallet', walletRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Serve web build (static files from mobile/dist)
// ---------------------------------------------------------------------------
const webDistPath = path.resolve(__dirname, '../../mobile/dist');
app.use(express.static(webDistPath));
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path === '/health' || _req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(webDistPath, 'index.html'));
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

// Wire up game socket handlers (auth + player:location + players:update)
setupGameSocket(io);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(config.port, () => {
  console.log(`[${config.appName}] Server running on port ${config.port}`);
});

export { app, server, io };
