const STONKFUN_API = process.env.STONKFUN_API || 'https://www.stonkfun.xyz/api/public/v1';

async function stonkFetch(path, init) {
  const url = path.startsWith('http') ? path : `${STONKFUN_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Stonkfun ${res.status}`);
    err.status = res.status;
    err.code = body?.error?.code || 'stonkfun_error';
    throw err;
  }
  return body.data ?? body;
}

export async function listTokens(query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return stonkFetch(`/tokens${qs ? `?${qs}` : ''}`);
}

export async function getToken(mint) {
  return stonkFetch(`/tokens/${encodeURIComponent(mint)}`);
}

export function extractMarketSnapshot(tokenPayload) {
  const token = tokenPayload?.token || tokenPayload;
  const market = token?.market || {};
  const price = market.priceUsd ?? token?.priceUsd ?? token?.price ?? null;
  const mcap = market.marketCapUsd ?? token?.marketCapUsd ?? token?.marketCap ?? null;
  return {
    mint: token?.mint || tokenPayload?.mint || null,
    name: token?.name || null,
    symbol: token?.symbol || null,
    logo: token?.imageUrl || token?.logo || token?.image || null,
    priceUsd: price == null ? null : Number(price),
    marketCapUsd: mcap == null ? null : Number(mcap),
    volumeUsd: market.volume24hUsd ?? token?.volume24hUsd ?? null,
    status: token?.status || null,
    raw: token,
  };
}
