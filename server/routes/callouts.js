import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { createCallout, listCallouts, withNicknames } from '../db.js';
import { assertOneCallout } from '../limits.js';
import { extractMarketSnapshot, getToken } from '../stonkfun.js';
import { getTokenBalanceUi, isValidPubkey } from '../solana.js';

export const calloutsRouter = Router();

calloutsRouter.get('/', async (req, res, next) => {
  try {
    const mint = req.query.mint ? String(req.query.mint) : undefined;
    const wallet = req.query.wallet ? String(req.query.wallet) : undefined;
    if (mint && !isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    const callouts = await withNicknames(
      await listCallouts({ mint, wallet, limit: Number(req.query.limit) || 50 }),
    );

    // Enrich with live performance vs callout snapshot
    const enriched = await Promise.all(
      callouts.map(async (c) => {
        try {
          const token = await getToken(c.mint);
          const live = extractMarketSnapshot(token);
          const priceChange =
            c.priceAtCall && live.priceUsd != null
              ? ((live.priceUsd - c.priceAtCall) / c.priceAtCall) * 100
              : null;
          const mcapChange =
            c.mcapAtCall && live.marketCapUsd != null
              ? ((live.marketCapUsd - c.mcapAtCall) / c.mcapAtCall) * 100
              : null;
          return {
            ...c,
            live,
            performance: { priceChangePct: priceChange, mcapChangePct: mcapChange },
          };
        } catch {
          return { ...c, live: null, performance: { priceChangePct: null, mcapChangePct: null } };
        }
      }),
    );

    res.json({ data: { callouts: enriched } });
  } catch (err) {
    next(err);
  }
});

calloutsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const mint = String(req.body?.mint || '');
    const thesis = String(req.body?.thesis || '').trim();
    if (!isValidPubkey(mint)) {
      return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid mint' } });
    }
    if (thesis.length < 3 || thesis.length > 500) {
      return res
        .status(400)
        .json({ error: { code: 'invalid_request', message: 'Thesis must be 3–500 characters' } });
    }

    const { uiAmount } = await getTokenBalanceUi(req.wallet, mint);
    if (uiAmount <= 0) {
      return res.status(403).json({
        error: {
          code: 'forbidden',
          message: 'You must hold this token to make a callout',
        },
      });
    }

    await assertOneCallout(mint, req.wallet);
    const token = await getToken(mint);
    const snap = extractMarketSnapshot(token);
    const [callout] = await withNicknames([
      await createCallout({
        mint,
        wallet: req.wallet,
        thesis,
        priceAtCall: snap.priceUsd,
        mcapAtCall: snap.marketCapUsd,
        holderBalance: uiAmount,
      }),
    ]);

    res.status(201).json({
      data: {
        callout: {
          ...callout,
          live: snap,
          performance: { priceChangePct: 0, mcapChangePct: 0 },
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
