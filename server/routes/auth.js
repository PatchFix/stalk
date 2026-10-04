import { Router } from 'express';
import {
  authenticateWallet,
  clearSessionCookie,
  getSessionWallet,
  issueNonce,
  requireAuth,
  setSessionCookie,
} from '../auth.js';
import { isValidPubkey, getStalkBalance } from '../solana.js';
import { getUser, setNickname } from '../db.js';

export const authRouter = Router();

authRouter.get('/nonce', async (req, res, next) => {
  try {
    const wallet = String(req.query.wallet || '');
    if (!isValidPubkey(wallet)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid wallet' } });
    }
    const payload = await issueNonce(wallet);
    res.json({ data: payload });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/verify', async (req, res, next) => {
  try {
    const { wallet, signature, message } = req.body || {};
    if (!wallet || !signature || !message || !isValidPubkey(wallet)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'wallet, signature, message required' } });
    }
    const result = await authenticateWallet({ wallet, signature, message });
    setSessionCookie(res, result.wallet);
    const [stalk, user] = await Promise.all([getStalkBalance(result.wallet), getUser(result.wallet)]);
    res.json({ data: { wallet: result.wallet, nickname: user.nickname, stalk } });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', async (req, res, next) => {
  try {
    const wallet = getSessionWallet(req);
    if (!wallet) {
      return res.json({ data: { wallet: null } });
    }
    const [stalk, user] = await Promise.all([getStalkBalance(wallet), getUser(wallet)]);
    res.json({ data: { wallet, nickname: user.nickname, stalk } });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/nickname', requireAuth, async (req, res, next) => {
  try {
    const user = await setNickname(req.wallet, req.body?.nickname);
    res.json({ data: { wallet: user.wallet, nickname: user.nickname } });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, (req, res) => {
  clearSessionCookie(res);
  res.json({ data: { ok: true } });
});
