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
    list.querySelectorAll('[data-play]').forEach((b) => (b.onclick = () => openGame(b.dataset.play)));
    list.querySelectorAll('[data-learn]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const g = games.find((x) => x.id === b.dataset.learn);
      OC.ui.tutorial(g, () => openGame(g.id));
    }));
  }

  function tileHTML(g) {
    const st = OC.stats.get(g.id);
    const rec = st.played ? `<span class="rec">${st.won}/${st.played} won</span>` : '<span class="rec new">New</span>';
    return `<div class="tile" data-play="${g.id}">
      <div class="tile-art">${OC.mini(g.preview)}</div>
      <div class="tile-info"><h3>${OC.esc(g.name)}</h3><p>${OC.esc(g.blurb)}</p>
      <div class="tile-meta"><span>${OC.esc(g.players)}</span>${rec}</div></div>
      <div class="tile-btns"><button class="btn small" data-learn="${g.id}">How to play</button><button class="btn small primary" data-play="${g.id}">Play</button></div>
    </div>`;
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

  function openGame(id) {
    const def = games.find((g) => g.id === id);
    if (!def) return;
    closeGame(true);
    showScreen('game-screen');
    $('#game-title').textContent = def.name;
    const board = $('#board');
    board.innerHTML = '';
    board.className = 'board g-' + def.id;
    const table = new OC.Table(board);
    let alive = true;
    const ctx = {
      def,
      board,
      table,
      opts: optsFor(def),
      alive: () => alive,
      wait: (ms) => new Promise((res) => setTimeout(() => { if (alive) res(); }, OC.pace(ms))),
      status(html) { $('#game-status').innerHTML = html; },
      buttons(list) { setTopButtons(list); },
      actions(list) { setActions(list); },
      toast: OC.ui.toast,
      dialog: OC.ui.dialog,
      record(won) { return OC.stats.record(def.id, won); },
      /** Standard end-of-game dialog. */
      async finish({ won, title, html = '', record = true }) {
        let st = null;
        if (record) st = OC.stats.record(def.id, won);
        if (won) celebrate();
        const statLine = st ? `<p class="statline">Won ${st.won} of ${st.played} · current streak ${st.streak} · best ${st.best}</p>` : '';
        const v = await OC.ui.dialog({
          title: title || (won ? 'You won!' : 'Game over'),
          html: html + statLine,
          buttons: [{ label: 'Menu', value: 'menu' }, { label: 'Play again', value: 'again', primary: true }],
        });
        if (!alive) return;
        if (v === 'menu') goHome();
        else if (v === 'again') inst.start();
      },
    };
    const inst = def.create(ctx);
    current = { def, inst, ctx, kill: () => { alive = false; } };
    setActions([]);
    setTopButtons([]);
    ctx.status('');
    requestAnimationFrame(() => {
      if (!alive) return;
      current.started = true;
      inst.start();
    });
  }

  function closeGame(silent) {
    if (!current) return;
    const { inst, def, kill } = current;
    if (inst.inProgress && inst.inProgress()) OC.stats.record(def.id, false);
    kill();
    if (inst.destroy) inst.destroy();
    current = null;
    $('#board').innerHTML = '';
    if (!silent) renderHome();
  }

  function goHome() {
    closeGame();
    showScreen('home-screen');
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
    if (current && current.started && current.inst.render) requestAnimationFrame(() => current && current.started && current.inst.render());
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
      if (inst.inProgress && inst.inProgress()) OC.stats.record(def.id, false);
      inst.start();
    }
  }

  function optionsDialog(def, opts) {
    const sel = Object.assign({}, opts);
    const html = def.options.map((o) => `<div class="opt-row"><label>${o.label}</label><div class="chips" data-key="${o.key}">${
      o.choices.map(([v, l]) => `<button class="chip${sel[o.key] === v ? ' on' : ''}" data-v='${JSON.stringify(v)}'>${l}</button>`).join('')}</div></div>`).join('') +
      '<p class="note">Starting a new game ends the current one.</p>';
    const p = OC.ui.dialog({
      title: 'New game',
      html,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Deal', value: 'deal', primary: true }],
    });
    const wrap = OC.ui._lastDialog;
    wrap.querySelectorAll('.chips').forEach((row) => {
      row.querySelectorAll('.chip').forEach((c) => (c.onclick = () => {
        row.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        c.classList.add('on');
        sel[row.dataset.key] = JSON.parse(c.dataset.v);
      }));
    });
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
      rt = setTimeout(() => current && current.started && current.inst.render && current.inst.render(), 80);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') OC.back();
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  OC.openGame = openGame;
  OC.current = () => current;
  OC.goHome = goHome;
  document.addEventListener('DOMContentLoaded', boot);
})();
