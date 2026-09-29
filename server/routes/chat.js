import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { createChatMessage, listChat } from '../db.js';
import { getTokenBalanceUi, isValidPubkey } from '../solana.js';

export const chatRouter = Router();

chatRouter.get('/:mint', requireAuth, async (req, res, next) => {
  try {
    const mint = req.params.mint;
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    const { uiAmount } = await getTokenBalanceUi(req.wallet, mint);
    if (uiAmount <= 0) {
      return res.status(403).json({
        error: { code: 'forbidden', message: 'Holder chat is for token holders only' },
      });
    }
    const messages = await listChat(mint);
    res.json({ data: { messages, balance: uiAmount } });
  } catch (err) {
    next(err);
  }
});

chatRouter.post('/:mint', requireAuth, async (req, res, next) => {
  try {
    const mint = req.params.mint;
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    const body = String(req.body?.body || '').trim();
    if (body.length < 1 || body.length > 500) {
      return res
        .status(400)
        .json({ error: { code: 'invalid_request', message: 'Message must be 1–500 characters' } });
    }
    const { uiAmount } = await getTokenBalanceUi(req.wallet, mint);
    if (uiAmount <= 0) {
      return res.status(403).json({
        error: { code: 'forbidden', message: 'Holder chat is for token holders only' },
      });
    }
    const message = await createChatMessage({ mint, wallet: req.wallet, body });
    res.status(201).json({ data: { message } });
  } catch (err) {
    next(err);
  }
});
