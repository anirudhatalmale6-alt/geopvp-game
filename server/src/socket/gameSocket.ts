import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { query } from '../config/database';

interface AuthUser {
  id: string;
  email: string;
  username: string;
}

interface AuthenticatedSocket extends Socket {
  user?: AuthUser;
}

// ---------------------------------------------------------------------------
// JWT auth for Socket.io connections
// ---------------------------------------------------------------------------

function authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void): void {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('No token provided'));
    }
    const user = jwt.verify(token, config.jwtSecret) as AuthUser;
    socket.user = { id: user.id, email: user.email, username: user.username };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}

// ---------------------------------------------------------------------------
// Setup function — call with the io instance after creation
// ---------------------------------------------------------------------------

export function setupGameSocket(io: SocketIOServer): void {
  io.use(authenticateSocket);

  io.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const user = socket.user!;

    console.log(`[GameSocket] ${user.username} (${user.id}) connected — socket ${socket.id}`);

    // Join the shared game room
    socket.join('game');

    // -----------------------------------------------------------------------
    // player:location — client sends their current GPS coords
    // -----------------------------------------------------------------------
    socket.on('player:location', async (data: { lat: number; lng: number }) => {
      try {
        const { lat, lng } = data;
        if (typeof lat !== 'number' || typeof lng !== 'number') return;

        // Persist to DB
        await query(
          `UPDATE game_sessions
           SET latitude = $1, longitude = $2, last_location_update = now()
           WHERE user_id = $3 AND is_active = true`,
          [lat, lng, user.id],
        );

        // Broadcast to all other clients in the game room
        socket.to('game').emit('players:update', {
          userId: user.id,
          username: user.username,
          lat,
          lng,
          ts: Date.now(),
        });
      } catch (err) {
        console.error('[GameSocket] player:location error:', err);
      }
    });

    // -----------------------------------------------------------------------
    // Disconnect
    // -----------------------------------------------------------------------
    socket.on('disconnect', (reason) => {
      console.log(`[GameSocket] ${user.username} disconnected (${reason})`);
    });
  });
}
