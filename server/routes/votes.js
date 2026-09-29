import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { listVotes, tallyVotes, upsertVote, VOTE_OPTIONS } from '../db.js';
import { getStalkBalance, isValidPubkey, voteThreshold } from '../solana.js';

export const votesRouter = Router();

votesRouter.get('/options', (_req, res) => {
  res.json({ data: { options: VOTE_OPTIONS, threshold: voteThreshold() } });
});

votesRouter.get('/:mint', async (req, res, next) => {
  try {
    const mint = req.params.mint;
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    const votes = await listVotes(mint);
    res.json({ data: tallyVotes(votes) });
  } catch (err) {
    next(err);
  }
});

votesRouter.post('/:mint', requireAuth, async (req, res, next) => {
  try {
    const mint = req.params.mint;
    const option = String(req.body?.option || '');
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    if (!VOTE_OPTIONS.some((o) => o.id === option)) {
      return res.status(400).json({
        error: {
          code: 'invalid_request',
          message: `option must be one of: ${VOTE_OPTIONS.map((o) => o.id).join(', ')}`,
        },
      });
    }

    const stalk = await getStalkBalance(req.wallet);
    if (!stalk.configured) {
      return res.status(503).json({
        error: {
          code: 'service_unavailable',
          message: 'STALK_MINT is not configured on the server yet',
        },
      });
    }
    const threshold = voteThreshold();
    if (stalk.balance < threshold) {
      return res.status(403).json({
        error: {
          code: 'forbidden',
          message: `Need ${threshold.toLocaleString()} $STALK to vote (you have ${stalk.balance.toLocaleString()})`,
        },
      });
    }

    await upsertVote({
      mint,
      wallet: req.wallet,
      option,
      stalkBalance: stalk.balance,
    });
    const votes = await listVotes(mint);
    res.json({ data: tallyVotes(votes) });
  } catch (err) {
    next(err);
  }
});
