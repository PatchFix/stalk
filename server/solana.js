import bs58 from 'bs58';

export function isValidPubkey(value) {
  try {
    const bytes = bs58.decode(String(value));
    return bytes.length === 32;
  } catch {
    return false;
  }
}

export function pubkeyBytes(value) {
  return bs58.decode(String(value));
}

async function rpc(method, params) {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) {
    const err = new Error(body.error.message || 'Solana RPC error');
    err.status = 502;
    err.code = 'rpc_error';
    throw err;
  }
  return body.result;
}

/**
 * Balance of `mint` for `owner`.
 * getTokenAccountsByOwner accepts either `{ mint }` or `{ programId }`, never both.
 * A mint filter resolves the owning program (SPL Token or Token-2022) from the mint account.
 */
export async function getTokenBalanceUi(walletAddress, mintAddress) {
  const result = await rpc('getTokenAccountsByOwner', [
    walletAddress,
    { mint: mintAddress },
    { encoding: 'jsonParsed' },
  ]);
  let total = 0;
  let decimals = 0;
  for (const item of result?.value || []) {
    const amount = item.account?.data?.parsed?.info?.tokenAmount;
    if (!amount) continue;
    total += Number(amount.uiAmount || 0);
    decimals = amount.decimals;
  }
  return { uiAmount: total, decimals };
}

export async function holdsToken(walletAddress, mintAddress, minUi = 0) {
  const { uiAmount } = await getTokenBalanceUi(walletAddress, mintAddress);
  return { holds: uiAmount > minUi, balance: uiAmount };
}

export async function getStalkBalance(walletAddress) {
  const mint = process.env.STALK_MINT;
  if (!mint) return { balance: 0, configured: false };
  const { uiAmount } = await getTokenBalanceUi(walletAddress, mint);
  return { balance: uiAmount, configured: true };
}

export function voteThreshold() {
  return Number(process.env.STALK_VOTE_THRESHOLD || 500_000);
}
