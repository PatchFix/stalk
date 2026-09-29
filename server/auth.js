import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { consumeNonce, setNonce, upsertUser } from './db.js';
import { pubkeyBytes } from './solana.js';

const SESSION_COOKIE = 'stalk_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sessionSecret() {
  return process.env.SESSION_SECRET || 'dev-stalk-secret-change-me';
}

export function buildSignMessage(wallet, nonce) {
  return [
    'Sign in to STALK',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    'This proves you control this wallet. No transaction will be sent.',
  ].join('\n');
}

export async function issueNonce(wallet) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await setNonce(wallet, nonce, expiresAt);
  return { nonce, message: buildSignMessage(wallet, nonce), expiresAt };
}

export function verifyWalletSignature(message, signature, walletAddress) {
  try {
    const messageBytes = new TextEncoder().encode(message);
    let signatureBytes;
    try {
      signatureBytes = bs58.decode(signature);
    } catch {
      signatureBytes = Buffer.from(signature, 'base64');
    }
    if (signatureBytes.length === 64) {
      // ok
    } else if (signatureBytes.length > 64) {
      signatureBytes = signatureBytes.slice(0, 64);
    } else {
      return false;
    }
    const pubkey = pubkeyBytes(walletAddress);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkey);
  } catch {
    return false;
  }
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.wallet || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, wallet) {
  const token = signSession({ wallet, exp: Date.now() + SESSION_TTL_MS });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    signed: false,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE);
}

export function getSessionWallet(req) {
  const raw = req.cookies?.[SESSION_COOKIE];
  const session = readSession(raw);
  return session?.wallet || null;
}

/** Parse stalk_session from a raw Cookie header (Socket.IO handshake). */
export function getWalletFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== SESSION_COOKIE) continue;
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    return readSession(value)?.wallet || null;
  }
  return null;
}

export function requireAuth(req, res, next) {
  const wallet = getSessionWallet(req);
  if (!wallet) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Connect wallet first' } });
  }
  req.wallet = wallet;
  next();
}

export async function authenticateWallet({ wallet, signature, message }) {
  const stored = await consumeNonce(wallet);
  if (!stored) {
    const err = new Error('Nonce missing or already used');
    err.status = 401;
    err.code = 'invalid_nonce';
    throw err;
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    const err = new Error('Nonce expired — request a new one');
    err.status = 401;
    err.code = 'nonce_expired';
    throw err;
  }
  const expected = buildSignMessage(wallet, stored.nonce);
  if (message !== expected) {
    const err = new Error('Message mismatch');
    err.status = 401;
    err.code = 'message_mismatch';
    throw err;
  }
  if (!verifyWalletSignature(message, signature, wallet)) {
    const err = new Error('Invalid signature');
    err.status = 401;
    err.code = 'invalid_signature';
    throw err;
  }
  await upsertUser(wallet);
  return { wallet };
}
