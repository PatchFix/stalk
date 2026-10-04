import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const jsonPath = path.join(dataDir, 'stalk.json');

/** @type {import('pg').Pool | null} */
let pool = null;
/** @type {Store | null} */
let memory = null;

const emptyStore = () => ({
  users: {},
  nonces: {},
  boardPosts: [],
  callouts: [],
  chatMessages: [],
  votes: [],
});

class Store {
  constructor(data) {
    this.data = data;
  }

  async save() {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(this.data, null, 2));
  }
}

export async function initDb() {
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        wallet TEXT PRIMARY KEY,
        display_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS nonces (
        wallet TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS board_posts (
        id UUID PRIMARY KEY,
        mint TEXT NOT NULL,
        wallet TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS board_posts_mint_idx ON board_posts (mint, created_at DESC);
      CREATE INDEX IF NOT EXISTS board_posts_wallet_idx ON board_posts (wallet, created_at DESC);
      CREATE TABLE IF NOT EXISTS callouts (
        id UUID PRIMARY KEY,
        mint TEXT NOT NULL,
        wallet TEXT NOT NULL,
        thesis TEXT NOT NULL,
        price_at_call NUMERIC,
        mcap_at_call NUMERIC,
        holder_balance NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS callouts_mint_idx ON callouts (mint, created_at DESC);
      CREATE INDEX IF NOT EXISTS callouts_wallet_idx ON callouts (wallet, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS callouts_wallet_mint_uidx ON callouts (wallet, mint);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY,
        mint TEXT NOT NULL,
        wallet TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS chat_mint_idx ON chat_messages (mint, created_at DESC);
      CREATE INDEX IF NOT EXISTS chat_wallet_idx ON chat_messages (wallet, created_at DESC);
      CREATE TABLE IF NOT EXISTS votes (
        id UUID PRIMARY KEY,
        mint TEXT NOT NULL,
        wallet TEXT NOT NULL,
        option TEXT NOT NULL,
        stalk_balance NUMERIC NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (mint, wallet)
      );
      CREATE INDEX IF NOT EXISTS votes_mint_idx ON votes (mint);
      CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_lower_idx
        ON users (lower(display_name));
    `);
    console.log('DB: Postgres ready');
    return;
  }

  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    memory = new Store(JSON.parse(raw));
  } catch {
    memory = new Store(emptyStore());
    await memory.save();
  }
  console.log('DB: local JSON store at data/stalk.json (set DATABASE_URL for Postgres)');
}

function requireStore() {
  if (!memory) throw Object.assign(new Error('DB not initialized'), { status: 500 });
  return memory;
}

export async function upsertUser(wallet) {
  if (pool) {
    await pool.query(
      `INSERT INTO users (wallet) VALUES ($1) ON CONFLICT (wallet) DO NOTHING`,
      [wallet],
    );
    return;
  }
  const s = requireStore();
  if (!s.data.users[wallet]) {
    s.data.users[wallet] = { wallet, displayName: null, createdAt: new Date().toISOString() };
    await s.save();
  }
}

const NICKNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,15}$/;

export function parseNickname(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const nickname = String(raw).trim();
  if (!NICKNAME_RE.test(nickname)) {
    const err = new Error(
      'Nickname must be 3–16 characters, start with a letter, and use only letters, numbers, or underscores',
    );
    err.status = 400;
    err.code = 'invalid_request';
    throw err;
  }
  return nickname;
}

function takenError() {
  const err = new Error('That nickname is taken');
  err.status = 409;
  err.code = 'nickname_taken';
  return err;
}

export async function getUser(wallet) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT wallet, display_name AS nickname, created_at AS "createdAt"
       FROM users WHERE wallet = $1`,
      [wallet],
    );
    return rows[0] || { wallet, nickname: null };
  }
  const user = requireStore().data.users[wallet];
  return {
    wallet,
    nickname: user?.displayName || null,
    createdAt: user?.createdAt || null,
  };
}

export async function setNickname(wallet, raw) {
  const nickname = parseNickname(raw);
  if (pool) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (wallet, display_name) VALUES ($1, $2)
         ON CONFLICT (wallet) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING wallet, display_name AS nickname`,
        [wallet, nickname],
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') throw takenError();
      throw err;
    }
  }
  const s = requireStore();
  if (nickname) {
    const clash = Object.values(s.data.users).find(
      (user) =>
        user.wallet !== wallet &&
        user.displayName &&
        user.displayName.toLowerCase() === nickname.toLowerCase(),
    );
    if (clash) throw takenError();
  }
  if (!s.data.users[wallet]) {
    s.data.users[wallet] = { wallet, createdAt: new Date().toISOString() };
  }
  s.data.users[wallet].displayName = nickname;
  await s.save();
  return { wallet, nickname };
}

export async function withNicknames(rows) {
  const wallets = [...new Set(rows.map((row) => row.wallet).filter(Boolean))];
  const names = new Map();
  if (wallets.length) {
    if (pool) {
      const { rows: found } = await pool.query(
        `SELECT wallet, display_name AS nickname FROM users WHERE wallet = ANY($1::text[])`,
        [wallets],
      );
      for (const row of found) names.set(row.wallet, row.nickname || null);
    } else {
      const users = requireStore().data.users;
      for (const wallet of wallets) names.set(wallet, users[wallet]?.displayName || null);
    }
  }
  return rows.map((row) => ({ ...row, nickname: names.get(row.wallet) || null }));
}

export async function setNonce(wallet, nonce, expiresAt) {
  if (pool) {
    await pool.query(
      `INSERT INTO nonces (wallet, nonce, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (wallet) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
      [wallet, nonce, expiresAt.toISOString()],
    );
    return;
  }
  const s = requireStore();
  s.data.nonces[wallet] = { nonce, expiresAt: expiresAt.toISOString() };
  await s.save();
}

export async function consumeNonce(wallet) {
  if (pool) {
    const { rows } = await pool.query(`SELECT nonce, expires_at FROM nonces WHERE wallet = $1`, [
      wallet,
    ]);
    if (!rows[0]) return null;
    await pool.query(`DELETE FROM nonces WHERE wallet = $1`, [wallet]);
    return { nonce: rows[0].nonce, expiresAt: new Date(rows[0].expires_at) };
  }
  const s = requireStore();
  const entry = s.data.nonces[wallet];
  if (!entry) return null;
  delete s.data.nonces[wallet];
  await s.save();
  return { nonce: entry.nonce, expiresAt: new Date(entry.expiresAt) };
}

export async function listBoardPosts(mint, limit = 50) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, mint, wallet, body, created_at AS "createdAt"
       FROM board_posts WHERE mint = $1 ORDER BY created_at DESC LIMIT $2`,
      [mint, limit],
    );
    return rows;
  }
  return requireStore()
    .data.boardPosts.filter((p) => p.mint === mint)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function createBoardPost({ mint, wallet, body }) {
  const row = {
    id: randomUUID(),
    mint,
    wallet,
    body,
    createdAt: new Date().toISOString(),
  };
  if (pool) {
    await pool.query(
      `INSERT INTO board_posts (id, mint, wallet, body, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [row.id, row.mint, row.wallet, row.body, row.createdAt],
    );
    return row;
  }
  const s = requireStore();
  s.data.boardPosts.push(row);
  await s.save();
  return row;
}

export async function listCallouts({ mint, wallet, limit = 50 } = {}) {
  if (pool) {
    const clauses = [];
    const params = [];
    if (mint) {
      params.push(mint);
      clauses.push(`mint = $${params.length}`);
    }
    if (wallet) {
      params.push(wallet);
      clauses.push(`wallet = $${params.length}`);
    }
    params.push(limit);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, mint, wallet, thesis,
              price_at_call AS "priceAtCall",
              mcap_at_call AS "mcapAtCall",
              holder_balance AS "holderBalance",
              created_at AS "createdAt"
       FROM callouts ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(normalizeCallout);
  }
  let rows = requireStore().data.callouts;
  if (mint) rows = rows.filter((c) => c.mint === mint);
  if (wallet) rows = rows.filter((c) => c.wallet === wallet);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

function normalizeCallout(row) {
  return {
    ...row,
    priceAtCall: row.priceAtCall == null ? null : Number(row.priceAtCall),
    mcapAtCall: row.mcapAtCall == null ? null : Number(row.mcapAtCall),
    holderBalance: row.holderBalance == null ? null : Number(row.holderBalance),
  };
}

function calloutExistsError() {
  const err = new Error('You already called this token');
  err.status = 409;
  err.code = 'callout_exists';
  return err;
}

export async function findCallout(mint, wallet) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id FROM callouts WHERE mint = $1 AND wallet = $2 LIMIT 1`,
      [mint, wallet],
    );
    return rows[0] || null;
  }
  return (
    requireStore().data.callouts.find((callout) => callout.mint === mint && callout.wallet === wallet) ||
    null
  );
}

function latestCreatedAt(rowsForWallet) {
  if (!rowsForWallet.length) return null;
  return rowsForWallet.reduce(
    (latest, row) => (row.createdAt > latest ? row.createdAt : latest),
    rowsForWallet[0].createdAt,
  );
}

export async function latestBoardPostAt(wallet) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT created_at AS "createdAt" FROM board_posts WHERE wallet = $1 ORDER BY created_at DESC LIMIT 1`,
      [wallet],
    );
    return rows[0]?.createdAt || null;
  }
  return latestCreatedAt(requireStore().data.boardPosts.filter((post) => post.wallet === wallet));
}

export async function latestChatAt(wallet) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT created_at AS "createdAt" FROM chat_messages WHERE wallet = $1 ORDER BY created_at DESC LIMIT 1`,
      [wallet],
    );
    return rows[0]?.createdAt || null;
  }
  return latestCreatedAt(requireStore().data.chatMessages.filter((message) => message.wallet === wallet));
}

export async function createCallout(payload) {
  if (await findCallout(payload.mint, payload.wallet)) throw calloutExistsError();
  const row = {
    id: randomUUID(),
    mint: payload.mint,
    wallet: payload.wallet,
    thesis: payload.thesis,
    priceAtCall: payload.priceAtCall,
    mcapAtCall: payload.mcapAtCall,
    holderBalance: payload.holderBalance,
    createdAt: new Date().toISOString(),
  };
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO callouts (id, mint, wallet, thesis, price_at_call, mcap_at_call, holder_balance, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          row.id,
          row.mint,
          row.wallet,
          row.thesis,
          row.priceAtCall,
          row.mcapAtCall,
          row.holderBalance,
          row.createdAt,
        ],
      );
    } catch (err) {
      if (err.code === '23505') throw calloutExistsError();
      throw err;
    }
    return row;
  }
  const s = requireStore();
  s.data.callouts.push(row);
  await s.save();
  return row;
}

export async function listChat(mint, limit = 100) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, mint, wallet, body, created_at AS "createdAt"
       FROM chat_messages WHERE mint = $1 ORDER BY created_at DESC LIMIT $2`,
      [mint, limit],
    );
    return rows.reverse();
  }
  return requireStore()
    .data.chatMessages.filter((m) => m.mint === mint)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-limit);
}

export async function createChatMessage({ mint, wallet, body }) {
  const row = {
    id: randomUUID(),
    mint,
    wallet,
    body,
    createdAt: new Date().toISOString(),
  };
  if (pool) {
    await pool.query(
      `INSERT INTO chat_messages (id, mint, wallet, body, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [row.id, row.mint, row.wallet, row.body, row.createdAt],
    );
    return row;
  }
  const s = requireStore();
  s.data.chatMessages.push(row);
  await s.save();
  return row;
}

export const VOTE_OPTIONS = [
  { id: 'good_tek', label: 'Good Tek', polarity: 'positive' },
  { id: 'real', label: 'REAL', polarity: 'positive' },
  { id: 'dank_meme', label: 'Dank Meme', polarity: 'positive' },
  { id: 'danger', label: 'Danger', polarity: 'negative' },
  { id: 'larp', label: 'LARP', polarity: 'negative' },
];

export async function upsertVote({ mint, wallet, option, stalkBalance }) {
  const row = {
    id: randomUUID(),
    mint,
    wallet,
    option,
    stalkBalance,
    createdAt: new Date().toISOString(),
  };
  if (pool) {
    await pool.query(
      `INSERT INTO votes (id, mint, wallet, option, stalk_balance, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (mint, wallet) DO UPDATE
       SET option = EXCLUDED.option,
           stalk_balance = EXCLUDED.stalk_balance,
           created_at = EXCLUDED.created_at,
           id = EXCLUDED.id
       RETURNING id`,
      [row.id, mint, wallet, option, stalkBalance, row.createdAt],
    );
    return row;
  }
  const s = requireStore();
  const idx = s.data.votes.findIndex((v) => v.mint === mint && v.wallet === wallet);
  if (idx >= 0) s.data.votes[idx] = row;
  else s.data.votes.push(row);
  await s.save();
  return row;
}

export async function listVotes(mint) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, mint, wallet, option,
              stalk_balance AS "stalkBalance",
              created_at AS "createdAt"
       FROM votes WHERE mint = $1 ORDER BY created_at DESC`,
      [mint],
    );
    return rows.map((r) => ({ ...r, stalkBalance: Number(r.stalkBalance) }));
  }
  return requireStore().data.votes.filter((v) => v.mint === mint);
}

export function tallyVotes(votes) {
  const tallies = Object.fromEntries(VOTE_OPTIONS.map((o) => [o.id, 0]));
  for (const v of votes) {
    if (tallies[v.option] != null) tallies[v.option] += 1;
  }
  return {
    options: VOTE_OPTIONS,
    tallies,
    total: votes.length,
  };
}
