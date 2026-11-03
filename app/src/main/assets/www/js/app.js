/* Open Card — app shell: home screen, game screen, settings, statistics, back handling. */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const games = [];
  OC.games = games;
  OC.registerGame = (g) => games.push(g);

  const $ = (sel, root = document) => root.querySelector(sel);
  let current = null; // { def, inst, ctx }

  /* ------------------------------------------------------------------ */
  /* Home                                                                */
  /* ------------------------------------------------------------------ */
  const CATEGORIES = [
    ['Solitaire', 'Play alone against the deck'],
    ['Casino', 'Beat the dealer or the pay table'],
    ['Versus Computer', 'Play against computer opponents'],
  ];

  function renderHome() {
    const list = $('#game-list');
    list.innerHTML = CATEGORIES.map(([cat, sub]) => {
      const gs = games.filter((g) => g.category === cat);
      if (!gs.length) return '';
      return `<section><h2>${cat}<small>${sub}</small></h2><div class="tiles">${gs.map(tileHTML).join('')}</div></section>`;
    }).join('');
    list.querySelectorAll('.tile[data-open]').forEach((t) => (t.onclick = () => gamePanel(t.dataset.open)));
  }

  function tileHTML(g) {
    const st = OC.stats.get(g.id);
    const rec = st.played ? `<span class="rec">${st.won}/${st.played} won</span>` : '<span class="rec new">New</span>';
    const going = canContinue(g.id) ? '<span class="rec going">In progress</span>' : '';
    return `<div class="tile" data-open="${g.id}" role="button" tabindex="0">
      <div class="tile-art">${OC.mini(g.preview)}</div>
      <div class="tile-info"><h3>${OC.esc(g.name)}</h3><p>${OC.esc(g.blurb)}</p>
      <div class="tile-meta"><span>${OC.esc(g.players)}</span>${rec}${going}</div></div>
      <div class="tile-go" aria-hidden="true">▶</div>
    </div>`;
  }

  /** Can this game be resumed (paused in memory, or saved on the device)? */
  function canContinue(id) {
    const sess = sessions[id];
    if (sess && sess.started && isInProgress(sess)) return true;
    return !!OC.store.get('save.' + id, null);
  }
  function isInProgress(sess) {
    try { return !!(sess.inst.inProgress && sess.inst.inProgress()); } catch (_) { return false; }
  }

  function wireChips(wrap, sel) {
    wrap.querySelectorAll('.chips').forEach((row) => {
      row.querySelectorAll('.chip').forEach((c) => (c.onclick = () => {
        row.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        c.classList.add('on');
        sel[row.dataset.key] = JSON.parse(c.dataset.v);
      }));
    });
  }
  function optionChips(def, sel) {
    return (def.options || []).map((o) => `<div class="opt-row"><label>${o.label}</label><div class="chips" data-key="${o.key}">${
      o.choices.map(([v, l]) => `<button class="chip${sel[o.key] === v ? ' on' : ''}" data-v="${OC.esc(JSON.stringify(v))}">${l}</button>`).join('')}</div></div>`).join('');
  }

  /** The game's panel: stats, options, How to play, New game and Continue. */
  async function gamePanel(id) {
    const def = games.find((g) => g.id === id);
    if (!def) return;
    const sess = sessions[id];
    const live = !!(sess && sess.started && isInProgress(sess));
    const saved = live ? null : OC.store.get('save.' + id, null);
    const resumable = live || !!saved;
    let progress = '';
    if (live) {
      let txt = '';
      try { txt = sess.inst.progressText ? sess.inst.progressText() : ''; } catch (_) {}
      progress = 'Paused game' + (txt ? ': ' + txt : '');
    } else if (saved) progress = 'Saved game' + (saved.summary ? ': ' + saved.summary : '');
    const st = OC.stats.get(id);
    const sel = optsFor(def);
    const statTxt = st.played ? `Won ${st.won} of ${st.played} · best streak ${st.best}` : 'Not played yet';
    const html = `<div class="panel-top"><div class="tile-art">${OC.mini(def.preview)}</div>
        <div><p>${OC.esc(def.blurb)}</p><p class="note">${OC.esc(def.players)} · ${statTxt}</p></div></div>
      ${progress ? `<div class="panel-progress">▶ ${OC.esc(progress)}</div>` : ''}
      ${def.options && def.options.length ? `<h3 class="panel-h">${resumable ? 'Options for a new game' : 'Options'}</h3>${optionChips(def, sel)}` : ''}`;
    const buttons = [{ label: 'How to play', value: 'learn' }, { label: resumable ? 'New game' : 'Play', value: 'new', primary: !resumable }];
    if (resumable) buttons.push({ label: 'Continue', value: 'continue', primary: true });
    const p = OC.ui.dialog({ title: def.name, html, buttons, cls: 'game-panel' });
    wireChips(OC.ui._lastDialog, sel);
    const v = await p;
    if (v === 'learn') return OC.ui.tutorial(def, () => gamePanel(id));
    if (v === 'continue') return launch(id, 'continue');
    if (v === 'new') {
      if (resumable) {
        const ok = await OC.ui.dialog({
          title: 'Start a new game?',
          html: `<p>Your ${live ? 'paused' : 'saved'} ${OC.esc(def.name)} game will be thrown away and count as a loss.</p>`,
          buttons: [{ label: 'Cancel', value: false }, { label: 'New game', value: true, primary: true }],
        });
        if (!ok) return gamePanel(id);
      }
      OC.store.set('opts.' + id, sel);
      launch(id, 'new', sel);
    }
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }

  /* ------------------------------------------------------------------ */
  /* Game screen                                                         */
  /* ------------------------------------------------------------------ */
  function optsFor(def) {
    const saved = OC.store.get('opts.' + def.id, {});
    const o = {};
    for (const opt of def.options || []) {
      const ok = opt.choices.some(([v]) => v === saved[opt.key]);
      o[opt.key] = ok ? saved[opt.key] : opt.def;
    }
    return o;
  }

  const sessions = {}; // game id -> session (kept while a game is paused)

  function createSession(def, opts) {
    const board = document.createElement('div');
    board.className = 'board g-' + def.id;
    $('#boards').appendChild(board);
    const table = new OC.Table(board);
    const sess = { def, board, ui: { status: '', buttons: [], actions: [] }, alive: true, suspended: false, started: false };
    const isCur = () => current === sess;
    const ctx = {
      def,
      board,
      table,
      opts,
      alive: () => sess.alive,
      // Computer turns pause while the game is paused, and continue when you come back.
      wait: (ms) => new Promise((res) => {
        const tick = () => {
          if (!sess.alive) return;
          if (sess.suspended) return setTimeout(tick, 150);
          res();
        };
        setTimeout(tick, OC.pace(ms));
      }),
      status(html) { sess.ui.status = html; if (isCur()) $('#game-status').innerHTML = html; },
      buttons(list) { sess.ui.buttons = list; if (isCur()) setTopButtons(list); },
      actions(list) { sess.ui.actions = list; if (isCur()) setActions(list); },
      toast: (msg, ms) => { if (isCur()) OC.ui.toast(msg, ms); },
      // never pop a game's dialog over the menu: wait until the game is on screen again
      dialog: async (o) => {
        while (sess.alive && sess.suspended) await OC.sleep(150);
        return OC.ui.dialog(o);
      },
      record(won) { return OC.stats.record(def.id, won); },
      /** Standard end-of-game dialog. */
      async finish({ won, title, html = '', record = true }) {
        OC.store.set('save.' + def.id, null);
        let st = null;
        if (record) st = OC.stats.record(def.id, won);
        if (won) celebrate();
        const statLine = st ? `<p class="statline">Won ${st.won} of ${st.played} · current streak ${st.streak} · best ${st.best}</p>` : '';
        const v = await ctx.dialog({
          title: title || (won ? 'You won!' : 'Game over'),
          html: html + statLine,
          buttons: [{ label: 'Menu', value: 'menu' }, { label: 'Play again', value: 'again', primary: true }],
        });
        if (!sess.alive) return;
        if (v === 'menu') goHome();
        else if (v === 'again') guard(() => sess.inst.start(), sess);
      },
    };
    sess.ctx = ctx;
    sess.inst = def.create(ctx);
    sessions[def.id] = sess;
    return sess;
  }

  /** Run game code; if it throws, keep the app alive and tell the player. */
  function guard(fn, sess) {
    try {
      return fn();
    } catch (e) {
      console.error(e);
      OC.ui.toast('Something went wrong — try starting a new game');
      return undefined;
    }
  }

  function showSession(sess) {
    current = sess;
    showScreen('game-screen');
    $('#game-title').textContent = sess.def.name;
    for (const b of $('#boards').children) b.style.display = b === sess.board ? '' : 'none';
    setTopButtons(sess.ui.buttons);
    setActions(sess.ui.actions);
    $('#game-status').innerHTML = sess.ui.status;
  }

  function destroySession(sess, abandon) {
    if (abandon && sess.started && isInProgress(sess)) OC.stats.record(sess.def.id, false);
    sess.alive = false;
    try { if (sess.inst.destroy) sess.inst.destroy(); } catch (e) { console.error(e); }
    sess.board.remove();
    if (sessions[sess.def.id] === sess) delete sessions[sess.def.id];
    if (current === sess) current = null;
  }

  /** Open a game: mode 'continue' resumes a paused/saved game, 'new' deals a fresh one. */
  function launch(id, mode, opts) {
    const def = games.find((g) => g.id === id);
    if (!def) return;
    let sess = sessions[id];
    if (mode === 'continue' && sess && sess.started && isInProgress(sess)) {
      sess.suspended = false;
      showSession(sess);
      guard(() => sess.inst.resume && sess.inst.resume(), sess);
      requestAnimationFrame(() => sess.alive && guard(() => sess.inst.render && sess.inst.render(), sess));
      return;
    }
    const saved = mode === 'continue' && !sess ? OC.store.get('save.' + id, null) : null;
    const hadSession = !!sess;
    if (sess) destroySession(sess, true); // counts the loss if it was in progress
    if (mode === 'new' && OC.store.get('save.' + id, null)) {
      // a game saved from an earlier session (not open now) is being abandoned
      if (!hadSession) OC.stats.record(id, false);
      OC.store.set('save.' + id, null);
    }
    sess = createSession(def, saved && saved.opts ? saved.opts : opts || optsFor(def));
    showSession(sess);
    requestAnimationFrame(() => {
      if (!sess.alive) return;
      sess.started = true;
      try {
        if (saved && sess.inst.restore) sess.inst.restore(saved);
        else sess.inst.start();
      } catch (e) {
        console.error(e);
        OC.store.set('save.' + id, null);
        try {
          sess.inst.start();
          OC.ui.toast('That saved game couldn’t be restored, so here’s a new deal');
        } catch (e2) {
          console.error(e2);
          destroySession(sess);
          goHome();
          OC.ui.toast('Sorry, this game couldn’t start');
        }
      }
    });
  }
  /** Kept for older callers: open a game, continuing it if possible. */
  function openGame(id) {
    launch(id, canContinue(id) ? 'continue' : 'new');
  }

  /** Leave the game screen. A game still in progress is paused, not thrown away. */
  function goHome() {
    const sess = current;
    if (sess) {
      if (sess.started && isInProgress(sess)) {
        sess.suspended = true;
        guard(() => sess.inst.suspend && sess.inst.suspend(), sess);
        sess.board.style.display = 'none';
      } else {
        destroySession(sess);
      }
      current = null;
    }
    showScreen('home-screen');
    renderHome();
  }

  function setTopButtons(list) {
    const box = $('#game-buttons');
    box.innerHTML = '';
    const all = (list || []).concat([
      { label: 'New', title: 'New game', onClick: newGameClicked },
      { label: '?', title: 'How to play', cls: 'round', onClick: () => OC.ui.tutorial(current.def) },
    ]);
    for (const b of all) {
      const btn = document.createElement('button');
      btn.className = 'btn top' + (b.cls ? ' ' + b.cls : '');
      btn.textContent = b.label;
      btn.title = b.title || b.label;
      btn.disabled = !!b.disabled;
      btn.onclick = () => b.onClick();
      box.appendChild(btn);
    }
  }

  function setActions(list) {
    const bar = $('#action-bar');
    bar.innerHTML = '';
    bar.classList.toggle('empty', !list || !list.length);
    for (const b of list || []) {
      if (b.html) {
        const span = document.createElement('span');
        span.className = 'action-text';
        span.innerHTML = b.html;
        bar.appendChild(span);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'btn action' + (b.primary ? ' primary' : '') + (b.cls ? ' ' + b.cls : '');
      btn.innerHTML = b.label;
      btn.disabled = !!b.disabled;
      btn.onclick = () => b.onClick();
      bar.appendChild(btn);
    }
    if (current && current.started && current.inst.render) requestAnimationFrame(() => current && current.started && guard(() => current.inst.render()));
  }

  async function newGameClicked() {
    if (!current) return;
    const { def, inst, ctx } = current;
    if (def.options && def.options.length) {
      const chosen = await optionsDialog(def, ctx.opts);
      if (!chosen) return;
      ctx.opts = chosen;
      OC.store.set('opts.' + def.id, chosen);
    } else if (inst.inProgress && inst.inProgress()) {
      const v = await OC.ui.dialog({
        title: 'Start a new game?',
        html: '<p>The current game will count as a loss.</p>',
        buttons: [{ label: 'Cancel', value: false }, { label: 'New game', value: true, primary: true }],
      });
      if (!v) return;
    }
    if (current !== null && current.inst === inst) {
      // Start from a fresh game object: any animation or computer turn still running in the
      // old one is stopped cleanly instead of carrying on into the new game.
      OC.store.set('save.' + def.id, null);
      launch(def.id, 'new', ctx.opts); // counts the old game as a loss if it was in progress
    }
  }

  function optionsDialog(def, opts) {
    const sel = Object.assign({}, opts);
    const p = OC.ui.dialog({
      title: 'New game',
      html: optionChips(def, sel) + '<p class="note">Starting a new game ends the current one.</p>',
      buttons: [{ label: 'Cancel', value: null }, { label: 'Deal', value: 'deal', primary: true }],
    });
    wireChips(OC.ui._lastDialog, sel);
    return p.then((v) => (v === 'deal' ? sel : null));
  }

  function celebrate() {
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#ffd54f', '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.8 + 's';
      p.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4000);
  }

  /* ------------------------------------------------------------------ */
  /* Settings & stats                                                    */
  /* ------------------------------------------------------------------ */
  function settingsDialog() {
    const S = OC.settings;
    const rows = [
      ['music', 'Background music', [[true, 'On'], [false, 'Off']]],
      ['volume', 'Music volume', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]],
      ['back', 'Card back', [['blue', 'Blue'], ['red', 'Red'], ['green', 'Green'], ['purple', 'Purple'], ['black', 'Black']]],
      ['felt', 'Table colour', [['green', 'Green'], ['blue', 'Blue'], ['red', 'Red'], ['gray', 'Charcoal'], ['brown', 'Wood']]],
      ['fourColor', 'Suit colours', [[false, 'Two colours'], [true, 'Four colours']]],
      ['autoFoundation', 'Solitaire auto-play', [[true, 'Move safe cards home'], [false, 'Off']]],
      ['speed', 'Computer speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']]],
    ];
    const html = rows.map(([k, l, ch]) => `<div class="opt-row"><label>${l}</label><div class="chips" data-key="${k}">${
      ch.map(([v, t]) => `<button class="chip${S[k] === v ? ' on' : ''}" data-v='${JSON.stringify(v)}'>${t}</button>`).join('')}</div></div>`).join('') +
      `<div class="opt-row"><label>Preview</label>${OC.mini('AS KH QD 10C XX')}</div>`;
    OC.ui.dialog({ title: 'Settings', html, buttons: [{ label: 'Done', value: true, primary: true }] });
    const wrap = OC.ui._lastDialog;
    wrap.querySelectorAll('.chips').forEach((row) => {
      row.querySelectorAll('.chip').forEach((c) => (c.onclick = () => {
        row.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        c.classList.add('on');
        S[row.dataset.key] = JSON.parse(c.dataset.v);
        OC.saveSettings();
      }));
    });
  }

  function statsDialog() {
    const rows = games.map((g) => {
      const s = OC.stats.get(g.id);
      const pct = s.played ? Math.round((100 * s.won) / s.played) + '%' : '–';
      return `<tr><td>${OC.esc(g.name)}</td><td>${s.played}</td><td>${s.won}</td><td>${pct}</td><td>${s.best}</td></tr>`;
    }).join('');
    const html = `<table class="stats"><thead><tr><th>Game</th><th>Played</th><th>Won</th><th>Win %</th><th>Best streak</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Casino games count each hand or round. Chip balances are saved separately.</p>`;
    OC.ui.dialog({
      title: 'Statistics',
      html,
      buttons: [{ label: 'Reset all', value: 'reset' }, { label: 'Close', value: true, primary: true }],
    }).then(async (v) => {
      if (v !== 'reset') return;
      const ok = await OC.ui.dialog({
        title: 'Reset statistics?',
        html: '<p>This clears the win/loss record for every game.</p>',
        buttons: [{ label: 'Cancel', value: false }, { label: 'Reset', value: true, primary: true }],
      });
      if (ok) {
        OC.stats.reset();
        renderHome();
        OC.ui.toast('Statistics cleared');
      }
    });
  }

  function aboutDialog() {
    OC.ui.dialog({
      title: 'About Open Card',
      html: `<p><b>Open Card</b> is a free collection of ${games.length} classic games played with a standard 52-card deck.</p>
        <p>Every game has a step-by-step tutorial: tap <b>How to play</b> on the menu, or the <b>?</b> button while playing.</p>
        <p>Everything runs on your device — no internet, no ads, no accounts.</p>`,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Back button (called by the Android wrapper)                         */
  /* ------------------------------------------------------------------ */
  OC.back = function () {
    if (OC.ui.hasModal()) return OC.ui.closeTopModal();
    if (current) {
      goHome();
      return true;
    }
    return false;
  };

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  // Last line of defence: report unexpected errors without breaking the app.
  let lastErr = 0;
  const onErr = (e) => {
    console.error(e);
    if (Date.now() - lastErr > 4000 && OC.ui && OC.ui.toast) {
      lastErr = Date.now();
      OC.ui.toast('Something went wrong \u2014 your games are still here');
    }
  };
  window.addEventListener('error', (e) => onErr(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => onErr(e.reason));

  function boot() {
    OC.applySettings();
    renderHome();
    $('#btn-settings').onclick = settingsDialog;
    $('#btn-stats').onclick = statsDialog;
    $('#btn-about').onclick = aboutDialog;
    $('#btn-home').onclick = goHome;
    document.querySelectorAll('.music-btn').forEach((b) => (b.onclick = () => OC.music.toggle()));
    OC.music.sync();
    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => current && current.started && current.inst.render && guard(() => current.inst.render()), 80);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') OC.back();
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  OC.openGame = openGame;
  OC.launch = launch;
  OC.gamePanel = gamePanel;
  OC.current = () => current;
  OC.goHome = goHome;
  document.addEventListener('DOMContentLoaded', boot);
})();
