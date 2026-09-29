import { Router } from 'express';
import { getToken, listTokens, extractMarketSnapshot } from '../stonkfun.js';
import { getSessionWallet } from '../auth.js';
import { getStalkBalance, getTokenBalanceUi, isValidPubkey, voteThreshold } from '../solana.js';
import { listVotes, tallyVotes } from '../db.js';

export const tokensRouter = Router();

tokensRouter.get('/', async (req, res, next) => {
  try {
    const data = await listTokens({
      q: req.query.q,
      sort: req.query.sort || 'newest',
      mode: req.query.mode,
      status: req.query.status,
      page: req.query.page || 1,
      pageSize: req.query.pageSize || 24,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

tokensRouter.get('/:mint', async (req, res, next) => {
  try {
    const mint = req.params.mint;
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    const token = await getToken(mint);
    const snapshot = extractMarketSnapshot(token);
    const votes = await listVotes(mint);
    const wallet = getSessionWallet(req);
    let holdings = null;
    let stalk = null;
    if (wallet) {
      const bal = await getTokenBalanceUi(wallet, mint);
      holdings = { balance: bal.uiAmount };
      stalk = await getStalkBalance(wallet);
    }
    res.json({
      data: {
        token,
        snapshot,
        votes: tallyVotes(votes),
        holdings,
        stalk,
        canVote: stalk ? stalk.balance >= voteThreshold() : false,
        voteThreshold: voteThreshold(),
      },
    });
  } catch (err) {
    next(err);
  }
});
