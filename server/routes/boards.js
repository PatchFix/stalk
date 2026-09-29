import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { createBoardPost, listBoardPosts } from '../db.js';
import { isValidPubkey } from '../solana.js';

export const boardsRouter = Router();

function cleanBody(text) {
  const body = String(text || '').trim();
  if (body.length < 1 || body.length > 1000) {
    const err = new Error('Post must be 1–1000 characters');
    err.status = 400;
    err.code = 'invalid_request';
    throw err;
  }
  return body;
}

boardsRouter.get('/:mint', async (req, res, next) => {
  try {
    const mint = req.params.mint;
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    const posts = await listBoardPosts(mint);
    res.json({ data: { posts } });
  } catch (err) {
    next(err);
  }
});

boardsRouter.post('/:mint', requireAuth, async (req, res, next) => {
  try {
    const mint = req.params.mint;
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    const body = cleanBody(req.body?.body);
    const post = await createBoardPost({ mint, wallet: req.wallet, body });
    res.status(201).json({ data: { post } });
  } catch (err) {
    next(err);
  }
});
