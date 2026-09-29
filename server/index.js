import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { initDb } from './db.js';
import { authRouter } from './routes/auth.js';
import { tokensRouter } from './routes/tokens.js';
import { boardsRouter } from './routes/boards.js';
import { calloutsRouter } from './routes/callouts.js';
import { chatRouter } from './routes/chat.js';
import { votesRouter } from './routes/votes.js';
import { attachChatSocket } from './socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const port = Number(process.env.PORT || 3000);

await initDb();

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-stalk-secret-change-me'));

app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'stalk', time: new Date().toISOString() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    stalkMint: process.env.STALK_MINT || null,
    voteThreshold: Number(process.env.STALK_VOTE_THRESHOLD || 500_000),
    phantomAppId: process.env.PHANTOM_APP_ID || null,
    rpcUrl: Boolean(process.env.SOLANA_RPC_URL),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/boards', boardsRouter);
app.use('/api/callouts', calloutsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/votes', votesRouter);

const dist = path.join(root, 'dist');
app.use(express.static(dist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) {
      res
        .status(503)
        .type('html')
        .send(
          '<!doctype html><meta charset="utf-8"><title>STALK</title><p>Frontend not built yet. Run <code>npm run build</code> or <code>npm run dev:client</code>.</p>',
        );
    }
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: { code: err.code || 'internal', message: err.message || 'Something broke' },
  });
});

attachChatSocket(server);

server.listen(port, () => {
  console.log(`STALK listening on :${port}`);
});
