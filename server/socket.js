import { Server } from 'socket.io';
import { createChatMessage, listChat } from './db.js';
import { getWalletFromCookieHeader } from './auth.js';
import { getTokenBalanceUi, isValidPubkey } from './solana.js';

const ROOM = (mint) => `chat:${mint}`;

/** @type {WeakMap<object, { lastSend: number, mint: string | null }>} */
const socketMeta = new WeakMap();

export function attachChatSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: process.env.CORS_ORIGIN || true,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const wallet = getWalletFromCookieHeader(socket.handshake.headers.cookie);
    if (!wallet) {
      return next(new Error('unauthorized'));
    }
    socket.data.wallet = wallet;
    socketMeta.set(socket, { lastSend: 0, mint: null });
    next();
  });

  io.on('connection', (socket) => {
    socket.on('chat:join', async (payload, ack) => {
      try {
        const mint = String(payload?.mint || '');
        if (!isValidPubkey(mint)) {
          return ack?.({ ok: false, error: 'Invalid mint' });
        }

        const { uiAmount } = await getTokenBalanceUi(socket.data.wallet, mint);
        if (uiAmount <= 0) {
          return ack?.({ ok: false, error: 'Holder chat is for token holders only' });
        }

        const prev = socketMeta.get(socket);
        if (prev?.mint) {
          socket.leave(ROOM(prev.mint));
        }
        socket.join(ROOM(mint));
        socketMeta.set(socket, { lastSend: prev?.lastSend || 0, mint });

        const messages = await listChat(mint);
        ack?.({ ok: true, messages, balance: uiAmount });
      } catch (err) {
        console.error('chat:join', err);
        ack?.({ ok: false, error: err.message || 'Failed to join chat' });
      }
    });

    socket.on('chat:leave', (payload) => {
      const mint = String(payload?.mint || '');
      if (mint) socket.leave(ROOM(mint));
      const meta = socketMeta.get(socket);
      if (meta) socketMeta.set(socket, { ...meta, mint: null });
    });

    socket.on('chat:send', async (payload, ack) => {
      try {
        const mint = String(payload?.mint || '');
        const body = String(payload?.body || '').trim();
        const meta = socketMeta.get(socket);

        if (!isValidPubkey(mint)) {
          return ack?.({ ok: false, error: 'Invalid mint' });
        }
        if (meta?.mint !== mint) {
          return ack?.({ ok: false, error: 'Join the room before sending' });
        }
        if (body.length < 1 || body.length > 500) {
          return ack?.({ ok: false, error: 'Message must be 1–500 characters' });
        }

        const now = Date.now();
        if (meta && now - meta.lastSend < 400) {
          return ack?.({ ok: false, error: 'Slow down' });
        }

        const { uiAmount } = await getTokenBalanceUi(socket.data.wallet, mint);
        if (uiAmount <= 0) {
          socket.leave(ROOM(mint));
          return ack?.({ ok: false, error: 'Holder chat is for token holders only' });
        }

        const message = await createChatMessage({
          mint,
          wallet: socket.data.wallet,
          body,
        });

        if (meta) socketMeta.set(socket, { ...meta, lastSend: now });

        io.to(ROOM(mint)).emit('chat:message', message);
        ack?.({ ok: true, message });
      } catch (err) {
        console.error('chat:send', err);
        ack?.({ ok: false, error: err.message || 'Failed to send' });
      }
    });
  });

  return io;
}
