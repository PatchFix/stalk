import { io } from 'socket.io-client';

let socket;

export function getChatSocket() {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function connectChatSocket() {
  const s = getChatSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectChatSocket() {
  if (!socket) return;
  socket.removeAllListeners('chat:message');
  if (socket.connected) socket.disconnect();
}
