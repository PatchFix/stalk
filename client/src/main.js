import './styles.css';
import { api, formatPct, formatUsd, timeAgo } from './api.js';
import { connectChatSocket, disconnectChatSocket } from './chatSocket.js';
import {
  connectWallet,
  disconnectWallet,
  getAddress,
  onWalletEvents,
  shortAddr,
  signAuthMessage,
} from './wallet.js';

const app = document.getElementById('app');
let session = { wallet: null, nickname: null, stalk: null };
let toastTimer;
let activeChatMint = null;

function toast(msg) {
  clearTimeout(toastTimer);
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  toastTimer = setTimeout(() => el.remove(), 3200);
}

function leaveActiveChat() {
  if (!activeChatMint) return;
  try {
    const socket = connectChatSocket();
    socket.emit('chat:leave', { mint: activeChatMint });
    socket.off('chat:message');
  } catch {
    /* ignore */
  }
  activeChatMint = null;
}

function route() {
  leaveActiveChat();
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  if (path === '/' || path === '') return renderHome();
  if (path === '/browse') return renderBrowse(params);
  if (path === '/callouts') return renderCalloutsFeed();
  if (path.startsWith('/token/')) return renderToken(path.slice('/token/'.length));
  return renderHome();
}

function layout(content, { hero = false } = {}) {
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand-link brand" href="#/">STALK<span>.</span></a>
        <nav class="nav-tabs" style="margin:0;flex:1;justify-content:center">
          <a href="#/browse" class="${location.hash.startsWith('#/browse') || location.hash.startsWith('#/token') ? 'active' : ''}">Tokens</a>
          <a href="#/callouts" class="${location.hash.startsWith('#/callouts') ? 'active' : ''}">Callouts</a>
        </nav>
        <div class="wallet-box" id="wallet-box"></div>
      </header>
      <main>${content}</main>
    </div>
  `;
  renderWalletBox();
  if (!hero) window.scrollTo({ top: 0, behavior: 'instant' });
}

async function refreshSession() {
  try {
    session = await api('/api/auth/me');
  } catch {
    session = { wallet: null, nickname: null, stalk: null };
  }
  renderWalletBox();
}

function openNickForm() {
  const pill = document.getElementById('btn-nick');
  if (!pill) return;
  const form = document.createElement('form');
  form.className = 'nick-form';
  form.innerHTML = `
    <input name="nickname" maxlength="16" placeholder="nickname" value="${escapeAttr(session.nickname || '')}" autocomplete="off" spellcheck="false" />
    <button type="submit">Save</button>
    <button class="ghost" type="button" id="nick-cancel">Cancel</button>
  `;
  pill.replaceWith(form);
  form.nickname.focus();
  form.nickname.select();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = new FormData(form).get('nickname');
    try {
      const data = await api('/api/auth/nickname', {
        method: 'POST',
        body: JSON.stringify({ nickname }),
      });
      session.nickname = data.nickname;
      toast(data.nickname ? `Nickname set to ${data.nickname}` : 'Nickname cleared');
      route();
    } catch (err) {
      toast(err.message);
    }
  });
  form.querySelector('#nick-cancel')?.addEventListener('click', () => renderWalletBox());
}

function whoName(person) {
  return person?.nickname || shortAddr(person?.wallet);
}

function renderWalletBox() {
  const box = document.getElementById('wallet-box');
  if (!box) return;
  if (session.wallet) {
    const stalkBit =
      session.stalk?.configured === false
        ? `<span class="pill">$STALK mint TBD</span>`
        : `<span class="pill live">${Number(session.stalk?.balance || 0).toLocaleString()} $STALK</span>`;
    const nameControl = session.nickname
      ? `<button class="pill nick-pill" type="button" id="btn-nick" title="${escapeAttr(session.wallet)}">${escapeHtml(session.nickname)}</button>`
      : `<span class="pill" title="${escapeAttr(session.wallet)}">${escapeHtml(shortAddr(session.wallet))}</span>
         <button class="ghost" type="button" id="btn-nick">Set nickname</button>`;
    box.innerHTML = `
      ${stalkBit}
      ${nameControl}
      <button class="ghost" type="button" id="btn-logout">Disconnect</button>
    `;
    box.querySelector('#btn-nick')?.addEventListener('click', () => openNickForm());
    box.querySelector('#btn-logout')?.addEventListener('click', async () => {
      leaveActiveChat();
      disconnectChatSocket();
      try {
        await api('/api/auth/logout', { method: 'POST', body: '{}' });
      } catch {
        /* ignore */
      }
      await disconnectWallet();
      session = { wallet: null, nickname: null, stalk: null };
      toast('Disconnected');
      route();
    });
    return;
  }
  box.innerHTML = `<button type="button" id="btn-connect">Connect Phantom</button>`;
  box.querySelector('#btn-connect')?.addEventListener('click', () => doConnect());
}

async function doConnect() {
  try {
    const address = await connectWallet();
    if (!address) throw new Error('No Solana address returned');
    const { nonce, message } = await api(`/api/auth/nonce?wallet=${encodeURIComponent(address)}`);
    void nonce;
    const signature = await signAuthMessage(message);
    session = await api('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ wallet: address, signature, message }),
    });
    toast(`Signed in as ${session.nickname || shortAddr(address)}`);
    route();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Connect failed');
  }
}

function renderHome() {
  layout(
    `
    <section class="hero">
      <h1 class="hero-brand">ST<em>A</em>LK</h1>
      <p>The social layer for Stonkfun. Call out tokens, talk with holders, and vote with $STALK — performance tracked from the moment you speak.</p>
      <div class="hero-actions">
        <button type="button" id="cta-browse">Browse tokens</button>
        <button class="ghost" type="button" id="cta-connect">${session.wallet ? 'Open callouts' : 'Connect Phantom'}</button>
      </div>
    </section>
  `,
    { hero: true },
  );
  document.getElementById('cta-browse')?.addEventListener('click', () => {
    location.hash = '#/browse';
  });
  document.getElementById('cta-connect')?.addEventListener('click', () => {
    if (session.wallet) location.hash = '#/callouts';
    else doConnect();
  });
}

async function renderBrowse(params = {}) {
  layout(`
    <section class="section">
      <div class="section-head">
        <div>
          <h2>Community tokens</h2>
          <p>Live from Stonkfun. Open a board, drop a callout, or enter holder chat.</p>
        </div>
      </div>
      <div class="toolbar">
        <input id="q" placeholder="Search name, ticker, mint…" value="${escapeAttr(params.q || '')}" />
        <button type="button" id="search">Search</button>
        <button class="ghost" type="button" data-sort="newest">Newest</button>
        <button class="ghost" type="button" data-sort="marketCap">Market cap</button>
        <button class="ghost" type="button" data-sort="volume">Volume</button>
      </div>
      <div id="token-grid" class="grid"><p class="empty">Loading…</p></div>
    </section>
  `);

  const load = async (sort = params.sort || 'newest', q = params.q || '') => {
    const grid = document.getElementById('token-grid');
    grid.innerHTML = `<p class="empty">Loading…</p>`;
    try {
      const qs = new URLSearchParams({ sort, pageSize: '24' });
      if (q) qs.set('q', q);
      const data = await api(`/api/tokens?${qs}`);
      const tokens = normalizeTokenList(data);
      if (!tokens.length) {
        grid.innerHTML = `<p class="empty">No tokens found.</p>`;
        return;
      }
      grid.innerHTML = tokens
        .map((t) => {
          const mint = t.mint || t.address;
          const mcap = t.market?.marketCapUsd ?? t.marketCapUsd ?? t.marketCap;
          const vol = t.market?.volume24hUsd ?? t.volumeUsd ?? t.volume24h;
          return `
            <a class="token-tile" href="#/token/${mint}">
              <div class="sym">$${escapeHtml(t.symbol || '???')}</div>
              <div class="name">${escapeHtml(t.name || '')}</div>
              <div class="meta">
                <span>${formatUsd(mcap)} mcap</span>
                <span>${formatUsd(vol)} vol</span>
              </div>
            </a>`;
        })
        .join('');
    } catch (err) {
      grid.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  };

  document.getElementById('search')?.addEventListener('click', () => {
    const q = document.getElementById('q').value.trim();
    location.hash = `#/browse?q=${encodeURIComponent(q)}`;
  });
  document.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = document.getElementById('q').value.trim();
      location.hash = `#/browse?sort=${btn.dataset.sort}&q=${encodeURIComponent(q)}`;
    });
  });
  await load(params.sort || 'newest', params.q || '');
}

function normalizeTokenList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tokens)) return data.tokens;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function renderCalloutsFeed() {
  layout(`
    <section class="section">
      <div class="section-head">
        <div>
          <h2>Callouts</h2>
          <p>Public calls with performance tracked from the moment they were made. Holders only.</p>
        </div>
      </div>
      <div id="feed" class="feed"><p class="empty">Loading…</p></div>
    </section>
  `);
  try {
    const { callouts } = await api('/api/callouts?limit=40');
    const feed = document.getElementById('feed');
    if (!callouts?.length) {
      feed.innerHTML = `<p class="empty">No callouts yet. Open a token and make the first move.</p>`;
      return;
    }
    feed.innerHTML = callouts
      .map((c) => {
        const pct = c.performance?.mcapChangePct ?? c.performance?.priceChangePct;
        const cls = pct > 0 ? 'perf-up' : pct < 0 ? 'perf-down' : '';
        const sym = c.live?.symbol || c.mint.slice(0, 6);
        return `
          <article class="feed-item">
            <div class="who">
              <a href="#/token/${c.mint}">$${escapeHtml(sym)}</a>
              · ${escapeHtml(whoName(c))}
              <span class="when">${timeAgo(c.createdAt)}</span>
              <span class="${cls}" style="margin-left:0.6rem">${formatPct(pct)}</span>
            </div>
            <div class="body">${escapeHtml(c.thesis)}</div>
          </article>`;
      })
      .join('');
  } catch (err) {
    document.getElementById('feed').innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

async function renderToken(mint) {
  layout(`
    <section class="token-page">
      <div id="token-head"><p class="empty">Loading token…</p></div>
      <div class="panels">
        <div class="panel" id="board-panel"></div>
        <div class="panel" id="callout-panel"></div>
        <div class="panel" id="vote-panel"></div>
        <div class="panel" id="chat-panel"></div>
      </div>
    </section>
  `);

  let detail;
  try {
    detail = await api(`/api/tokens/${mint}`);
  } catch (err) {
    document.getElementById('token-head').innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    return;
  }

  const snap = detail.snapshot || {};
  const raw = detail.token?.token || detail.token || {};
  const symbol = snap.symbol || raw.symbol || 'TOKEN';
  const name = snap.name || raw.name || '';

  document.getElementById('token-head').innerHTML = `
    <div class="token-hero">
      <h1>$${escapeHtml(symbol)}</h1>
      <div class="sub">${escapeHtml(name)} · ${escapeHtml(mint)}</div>
      <div class="stats">
        <div><strong>Price</strong>${formatUsd(snap.priceUsd)}</div>
        <div><strong>Market cap</strong>${formatUsd(snap.marketCapUsd)}</div>
        <div><strong>Your bag</strong>${detail.holdings ? Number(detail.holdings.balance).toLocaleString() : '—'}</div>
      </div>
    </div>
  `;

  await Promise.all([
    mountBoard(mint),
    mountCallouts(mint, detail),
    mountVotes(mint, detail),
    mountChat(mint, detail),
  ]);
}

async function mountBoard(mint) {
  const panel = document.getElementById('board-panel');
  panel.innerHTML = `
    <h3>Board</h3>
    <p class="hint">Open discussion — anyone signed in can post. 30 seconds between posts.</p>
    <div class="feed" id="board-feed"></div>
    <form class="composer" id="board-form">
      <textarea name="body" rows="3" placeholder="Say something about this token…" ${session.wallet ? '' : 'disabled'}></textarea>
      <button type="submit" ${session.wallet ? '' : 'disabled'}>Post</button>
    </form>
  `;
  const refresh = async () => {
    const { posts } = await api(`/api/boards/${mint}`);
    const feed = document.getElementById('board-feed');
    feed.innerHTML = posts?.length
      ? posts
          .map(
            (p) => `
        <article class="feed-item">
          <div class="who" title="${escapeAttr(p.wallet)}">${escapeHtml(whoName(p))}<span class="when">${timeAgo(p.createdAt)}</span></div>
          <div class="body">${escapeHtml(p.body)}</div>
        </article>`,
          )
          .join('')
      : `<p class="empty">No posts yet.</p>`;
  };
  await refresh();
  panel.querySelector('#board-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = new FormData(e.target).get('body');
    try {
      await api(`/api/boards/${mint}`, { method: 'POST', body: JSON.stringify({ body }) });
      e.target.reset();
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });
}

async function mountCallouts(mint, detail) {
  const panel = document.getElementById('callout-panel');
  const canCall = session.wallet && detail.holdings?.balance > 0;
  panel.innerHTML = `
    <h3>Callouts</h3>
    <p class="hint">One call per wallet on this token. Must hold it — price and mcap are snapshotted when you call.</p>
    <div class="feed" id="callout-feed"></div>
    <form class="composer" id="callout-form">
      <textarea name="thesis" rows="3" placeholder="Your call — thesis in one take…" ${canCall ? '' : 'disabled'}></textarea>
      <button type="submit" ${canCall ? '' : 'disabled'}>${canCall ? 'Call it' : session.wallet ? 'Hold to callout' : 'Connect to callout'}</button>
    </form>
  `;
  const refresh = async () => {
    const { callouts } = await api(`/api/callouts?mint=${mint}`);
    const alreadyCalled = session.wallet && callouts?.some((c) => c.wallet === session.wallet);
    const textarea = panel.querySelector('textarea');
    const button = panel.querySelector('button[type="submit"]');
    if (alreadyCalled && textarea && button) {
      textarea.disabled = true;
      button.disabled = true;
      button.textContent = 'Already called';
    }
    const feed = document.getElementById('callout-feed');
    feed.innerHTML = callouts?.length
      ? callouts
          .map((c) => {
            const pct = c.performance?.mcapChangePct ?? c.performance?.priceChangePct;
            const cls = pct > 0 ? 'perf-up' : pct < 0 ? 'perf-down' : '';
            return `
          <article class="feed-item">
            <div class="who" title="${escapeAttr(c.wallet)}">${escapeHtml(whoName(c))}<span class="when">${timeAgo(c.createdAt)}</span>
              <span class="${cls}" style="margin-left:0.6rem">${formatPct(pct)}</span>
            </div>
            <div class="body">${escapeHtml(c.thesis)}</div>
          </article>`;
          })
          .join('')
      : `<p class="empty">No callouts yet.</p>`;
  };
  await refresh();
  panel.querySelector('#callout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const thesis = new FormData(e.target).get('thesis');
    try {
      await api('/api/callouts', {
        method: 'POST',
        body: JSON.stringify({ mint, thesis }),
      });
      e.target.reset();
      toast('Callout locked in');
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  });
}

async function mountVotes(mint, detail) {
  const panel = document.getElementById('vote-panel');
  const threshold = detail.voteThreshold || 500000;
  const canVote = detail.canVote;
  panel.innerHTML = `
    <h3>Votes</h3>
    <p class="hint">Need ${threshold.toLocaleString()} $STALK. One vote per wallet — changeable.</p>
    <div class="vote-row" id="vote-buttons"></div>
    <div class="tally" id="vote-tally"></div>
  `;

  const renderTally = (data) => {
    const total = data.total || 1;
    document.getElementById('vote-tally').innerHTML = data.options
      .map((o) => {
        const count = data.tallies[o.id] || 0;
        const pct = Math.round((count / total) * 100);
        return `
          <div class="tally-row">
            <span>${escapeHtml(o.label)}</span>
            <div class="bar ${o.polarity === 'negative' ? 'neg' : ''}"><i style="width:${pct}%"></i></div>
            <span>${count}</span>
          </div>`;
      })
      .join('');
  };

  const buttons = document.getElementById('vote-buttons');
  buttons.innerHTML = (detail.votes?.options || [])
    .map(
      (o) =>
        `<button type="button" class="vote-btn ${o.polarity}" data-option="${o.id}" ${canVote ? '' : 'disabled'}>${escapeHtml(o.label)}</button>`,
    )
    .join('');
  renderTally(detail.votes || { options: [], tallies: {}, total: 0 });

  buttons.querySelectorAll('[data-option]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const data = await api(`/api/votes/${mint}`, {
          method: 'POST',
          body: JSON.stringify({ option: btn.dataset.option }),
        });
        renderTally(data);
        toast(`Voted ${btn.textContent}`);
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function renderChatMessages(messages) {
  const feed = document.getElementById('chat-feed');
  if (!feed) return;
  feed.innerHTML = messages?.length
    ? messages
        .map(
          (m) => `
      <article class="feed-item" data-id="${escapeAttr(m.id)}">
        <div class="who" title="${escapeAttr(m.wallet)}">${escapeHtml(whoName(m))}<span class="when">${timeAgo(m.createdAt)}</span></div>
        <div class="body">${escapeHtml(m.body)}</div>
      </article>`,
        )
        .join('')
    : `<p class="empty">Quiet so far. Break the ice.</p>`;
  feed.scrollTop = feed.scrollHeight;
}

function appendChatMessage(message) {
  const feed = document.getElementById('chat-feed');
  if (!feed) return;
  if (feed.querySelector(`[data-id="${CSS.escape(message.id)}"]`)) return;
  const empty = feed.querySelector('.empty');
  if (empty) empty.remove();
  const article = document.createElement('article');
  article.className = 'feed-item';
  article.dataset.id = message.id;
  article.innerHTML = `
    <div class="who" title="${escapeAttr(message.wallet)}">${escapeHtml(whoName(message))}<span class="when">${timeAgo(message.createdAt)}</span></div>
    <div class="body">${escapeHtml(message.body)}</div>`;
  feed.appendChild(article);
  feed.scrollTop = feed.scrollHeight;
}

async function mountChat(mint, detail) {
  const panel = document.getElementById('chat-panel');
  const isHolder = detail.holdings?.balance > 0;
  panel.innerHTML = `
    <h3>Holder chat</h3>
    <p class="hint">Live · holders only · 10 seconds between messages.</p>
    <div class="feed" id="chat-feed"><p class="empty">Connecting…</p></div>
    <form class="composer" id="chat-form">
      <textarea name="body" rows="2" placeholder="Holder-only channel…" ${isHolder ? '' : 'disabled'}></textarea>
      <button type="submit" ${isHolder ? '' : 'disabled'}>${isHolder ? 'Send' : 'Hold to chat'}</button>
    </form>
  `;

  if (!session.wallet) {
    document.getElementById('chat-feed').innerHTML = `<p class="empty">Connect wallet to enter holder chat.</p>`;
    return;
  }
  if (!isHolder) {
    document.getElementById('chat-feed').innerHTML = `<p class="empty">You need a bag of this token to chat here.</p>`;
    return;
  }

  const socket = connectChatSocket();
  activeChatMint = mint;

  const onMessage = (message) => {
    if (message?.mint === mint) appendChatMessage(message);
  };
  socket.off('chat:message');
  socket.on('chat:message', onMessage);

  const join = () =>
    new Promise((resolve) => {
      socket.emit('chat:join', { mint }, (res) => resolve(res));
    });

  const ensureJoined = async () => {
    try {
      if (!socket.connected) {
        await new Promise((resolve, reject) => {
          const onConnect = () => {
            cleanup();
            resolve();
          };
          const onError = (err) => {
            cleanup();
            reject(err instanceof Error ? err : new Error(err?.message || 'Socket auth failed'));
          };
          const cleanup = () => {
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
          };
          socket.once('connect', onConnect);
          socket.once('connect_error', onError);
          socket.connect();
        });
      }
      const res = await join();
      if (!res?.ok) throw new Error(res?.error || 'Could not join chat');
      renderChatMessages(res.messages || []);
    } catch (err) {
      const feed = document.getElementById('chat-feed');
      if (feed) feed.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      toast(err.message);
    }
  };

  await ensureJoined();

  panel.querySelector('#chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = String(new FormData(e.target).get('body') || '').trim();
    if (!body) return;
    socket.emit('chat:send', { mint, body }, (res) => {
      if (!res?.ok) {
        toast(res?.error || 'Send failed');
        return;
      }
      e.target.reset();
      // message also arrives via chat:message broadcast
    });
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", '&#39;');
}

onWalletEvents({
  connect: () => refreshSession(),
  disconnect: () => {
    session = { wallet: null, nickname: null, stalk: null };
    renderWalletBox();
  },
});

window.addEventListener('hashchange', route);

(async () => {
  await refreshSession();
  route();
})();
