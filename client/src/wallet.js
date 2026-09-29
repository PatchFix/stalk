/**
 * Phantom connection helpers.
 * Prefers window.solana (extension). Optionally uses @phantom/browser-sdk when VITE_PHANTOM_APP_ID is set.
 */

let sdk;
let connectedAddress = null;

export function getAddress() {
  return connectedAddress;
}

export function shortAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

async function getBrowserSdk() {
  const appId = import.meta.env.VITE_PHANTOM_APP_ID;
  if (!appId) return null;
  if (!sdk) {
    const { BrowserSDK, AddressType } = await import('@phantom/browser-sdk');
    sdk = new BrowserSDK({
      providers: ['injected', 'google', 'apple'],
      appId,
      addressTypes: [AddressType.solana],
      autoConnect: true,
    });
  }
  return sdk;
}

export async function connectWallet() {
  // Extension path (most common for crypto social apps)
  if (window.solana?.isPhantom) {
    const resp = await window.solana.connect();
    connectedAddress = resp.publicKey.toString();
    return connectedAddress;
  }

  const s = await getBrowserSdk();
  if (!s) {
    throw new Error('Phantom extension not found. Install Phantom or set VITE_PHANTOM_APP_ID for embedded wallets.');
  }

  const result = await s.connect({ provider: 'injected' });
  const addresses = result?.addresses || s.accounts || [];
  const sol = Array.isArray(addresses)
    ? addresses.find((a) => String(a.chain || a.addressType || '').toLowerCase().includes('sol')) ||
      addresses[0]
    : null;
  connectedAddress = sol?.address || (typeof sol === 'string' ? sol : null);
  if (!connectedAddress && s.solana?.getPublicKey) {
    connectedAddress = await s.solana.getPublicKey();
  }
  if (!connectedAddress) throw new Error('No Solana address returned');
  return connectedAddress;
}

export async function disconnectWallet() {
  connectedAddress = null;
  try {
    await window.solana?.disconnect?.();
  } catch {
    /* ignore */
  }
  try {
    const s = await getBrowserSdk();
    await s?.disconnect?.();
  } catch {
    /* ignore */
  }
}

export async function signAuthMessage(message) {
  if (window.solana?.signMessage) {
    const encoded = new TextEncoder().encode(message);
    const { signature } = await window.solana.signMessage(encoded, 'utf8');
    return bytesToBase58(signature);
  }

  const s = await getBrowserSdk();
  if (s?.solana?.signMessage) {
    const result = await s.solana.signMessage(message);
    return result.signature || result.rawSignature || result;
  }

  throw new Error('No Solana signer available');
}

function bytesToBase58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const b of bytes) num = (num << 8n) + BigInt(b);
  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    num /= 58n;
    out = alphabet[rem] + out;
  }
  for (const b of bytes) {
    if (b === 0) out = `1${out}`;
    else break;
  }
  return out || '1';
}

export function onWalletEvents(handlers = {}) {
  if (window.solana?.on) {
    if (handlers.connect) window.solana.on('connect', handlers.connect);
    if (handlers.disconnect) window.solana.on('disconnect', handlers.disconnect);
  }
}
