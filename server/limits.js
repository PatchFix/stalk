import { findCallout, latestBoardPostAt, latestChatAt } from './db.js';

export const BOARD_COOLDOWN_MS = Number(process.env.BOARD_COOLDOWN_MS || 30_000);
export const CHAT_COOLDOWN_MS = Number(process.env.CHAT_COOLDOWN_MS || 10_000);

export function assertCooldown(lastAt, windowMs, action) {
  if (!lastAt) return;
  const wait = windowMs - (Date.now() - new Date(lastAt).getTime());
  if (wait <= 0) return;
  const err = new Error(`Wait ${Math.ceil(wait / 1000)}s before you ${action} again`);
  err.status = 429;
  err.code = 'cooldown';
  throw err;
}

export async function assertBoardCooldown(wallet) {
  assertCooldown(await latestBoardPostAt(wallet), BOARD_COOLDOWN_MS, 'post');
}

export async function assertChatCooldown(wallet) {
  assertCooldown(await latestChatAt(wallet), CHAT_COOLDOWN_MS, 'chat');
}

export async function assertOneCallout(mint, wallet) {
  if (await findCallout(mint, wallet)) {
    const err = new Error('You already called this token');
    err.status = 409;
    err.code = 'callout_exists';
    throw err;
  }
}
