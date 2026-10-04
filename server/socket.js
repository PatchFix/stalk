import { Server } from 'socket.io';
import { createChatMessage, listChat, withNicknames } from './db.js';
import { getWalletFromCookieHeader } from './auth.js';
import { assertChatCooldown } from './limits.js';
import { getTokenBalanceUi, isValidPubkey } from './solana.js';

const ROOM = (mint) => `chat:${mint}`;

/** @type {WeakMap<object, { mint: string | null }>} */
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
    socketMeta.set(socket, { mint: null });
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
        socketMeta.set(socket, { mint });

        const messages = await withNicknames(await listChat(mint));
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

        const { uiAmount } = await getTokenBalanceUi(socket.data.wallet, mint);
        if (uiAmount <= 0) {
          socket.leave(ROOM(mint));
          return ack?.({ ok: false, error: 'Holder chat is for token holders only' });
        }

        await assertChatCooldown(socket.data.wallet);

        const [message] = await withNicknames([
          await createChatMessage({
            mint,
            wallet: socket.data.wallet,
            body,
          }),
        ]);

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
