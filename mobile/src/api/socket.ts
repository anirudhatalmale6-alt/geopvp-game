/**
 * Socket.io client singleton for CoinProwl real-time player movement.
 */

import { Platform } from 'react-native';
import { io as SocketIOClient, Socket } from 'socket.io-client';
import { getToken } from './client';

// ---------------------------------------------------------------------------
// Determine server URL
// ---------------------------------------------------------------------------

function getSocketUrl(): string {
  if (Platform.OS === 'web') {
    // Same-origin on web — connect to the window's origin
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin;
    }
    return '/';
  }
  // Native: fall back to env or localhost
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api';
  // Strip the /api suffix to get the base server URL
  return apiUrl.replace(/\/api\/?$/, '');
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _socket: Socket | null = null;

export async function connectSocket(): Promise<void> {
  if (_socket?.connected) return;

  const token = await getToken();
  if (!token) {
    console.warn('[Socket] No auth token — skipping connection');
    return;
  }

  const url = getSocketUrl();

  _socket = SocketIOClient(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  _socket.on('connect', () => {
    console.log('[Socket] Connected:', _socket?.id);
  });

  _socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  _socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });
}

export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

export function emitLocation(lat: number, lng: number): void {
  if (_socket?.connected) {
    _socket.emit('player:location', { lat, lng });
  }
}

export type PlayersUpdatePayload = {
  userId: string;
  username: string;
  lat: number;
  lng: number;
  ts: number;
};

export function onPlayersUpdate(callback: (data: PlayersUpdatePayload) => void): () => void {
  if (!_socket) return () => {};
  _socket.on('players:update', callback);
  // Return an unsubscribe function
  return () => {
    _socket?.off('players:update', callback);
  };
}

export function getSocket(): Socket | null {
  return _socket;
}
