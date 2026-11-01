/* Open Card — core engine: cards, table renderer, input, UI helpers, storage. */
(function () {
  'use strict';
  const OC = (window.OpenCard = window.OpenCard || {});

  /* ------------------------------------------------------------------ */
  /* Cards                                                               */
  /* ------------------------------------------------------------------ */
  // Suit index: 0 = spades, 1 = hearts, 2 = diamonds, 3 = clubs
  OC.SUITS = [
    { name: 'Spades', sym: '♠', red: false },
    { name: 'Hearts', sym: '♥', red: true },
    { name: 'Diamonds', sym: '♦', red: true },
    { name: 'Clubs', sym: '♣', red: false },
  ];
  OC.RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  OC.RANK_NAMES = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
  OC.RANK_PLURAL = ['', 'Aces', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings'];

  OC.isRed = (c) => c.s === 1 || c.s === 2;
  OC.cardName = (c) => OC.RANK_NAMES[c.r] + ' of ' + OC.SUITS[c.s].name;
  OC.cardShort = (c) => OC.RANKS[c.r] + OC.SUITS[c.s].sym;

  /** Build `decks` standard 52-card decks. `suits` limits the suits used (for Spider). */
  OC.makeDeck = function (decks = 1, suits = [0, 1, 2, 3]) {
    const out = [];
    let id = 0;
    const total = decks * 4;
    for (let d = 0; d < total; d++) {
      const s = suits[d % suits.length];
      for (let r = 1; r <= 13; r++) out.push({ id: id++, r, s, up: false });
    }
    return out;
  };

  OC.shuffle = function (a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /** Horizontal step for fanning n cards of width cw into maxW (capped at ideal). */
  OC.fanStep = (n, cw, maxW, ideal) => (n <= 1 ? 0 : Math.max(4, Math.min(ideal, (maxW - cw) / (n - 1))));
  /** Sort a hand by suit then rank (Aces high when acesHigh). */
  OC.sortHand = (cards, acesHigh = true, suitOrder = [0, 1, 3, 2]) =>
    cards.sort((a, b) => suitOrder.indexOf(a.s) - suitOrder.indexOf(b.s) || (acesHigh && a.r === 1 ? 14 : a.r) - (acesHigh && b.r === 1 ? 14 : b.r));
  /**
   * Seat positions for computer opponents around the table.
   * Returns [{x, y, step, vertical, lx, ly, la}] — cards start at (x,y) and fan by `step`.
   */
  OC.oppSeats = function (n, w, h, cw, ch, count) {
    const seats = [];
    const sides = n === 1 ? ['top'] : n === 2 ? ['left', 'right'] : ['left', 'top', 'right'];
    const small = 0.5;
    sides.forEach((side, k) => {
      const c = count[k] || 0;
      if (side === 'top') {
        const step = OC.fanStep(c, cw, Math.min(w * 0.5, 480), cw * small);
        const width = cw + step * Math.max(0, c - 1);
        seats.push({ x: (w - width) / 2, y: 10, step, vertical: false, lx: (w + width) / 2 + 10, ly: 16, la: 'left' });
      } else {
        const step = OC.fanStep(c, ch, h * 0.55, ch * 0.18);
        const height = ch + step * Math.max(0, c - 1);
        const x = side === 'left' ? 12 : w - cw - 12;
        seats.push({ x, y: Math.max(10, h * 0.42 - height / 2), step, vertical: true, lx: side === 'left' ? 8 : w - 228, ly: Math.max(10, h * 0.42 - height / 2) + height + 6, la: side === 'left' ? 'left' : 'right' });
      }
    });
    return seats;
  };
  OC.clone = (o) => JSON.parse(JSON.stringify(o));
  OC.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  OC.rand = (n) => Math.floor(Math.random() * n);
  OC.esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /* Pip positions (percent of the pip area) for number cards */
  const PIPS = {
    2: [[50, 0], [50, 100]],
    3: [[50, 0], [50, 50], [50, 100]],
    4: [[0, 0], [100, 0], [0, 100], [100, 100]],
    5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
    6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
    7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
    8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
    9: [[0, 0], [100, 0], [0, 33.3], [100, 33.3], [50, 50], [0, 66.7], [100, 66.7], [0, 100], [100, 100]],
    10: [[0, 0], [100, 0], [50, 16.7], [0, 33.3], [100, 33.3], [0, 66.7], [100, 66.7], [50, 83.3], [0, 100], [100, 100]],
  };

  function faceHTML(r, s) {
    const sym = `<u class="sy">${OC.SUITS[s].sym}</u>`;
    const rk = OC.RANKS[r];
    let center;
    if (r === 1) {
      center = `<div class="ace">${sym}</div>`;
    } else if (r > 10) {
      center = `<div class="court"><b>${rk}</b><i>${sym}</i></div>`;
    } else {
      center = '<div class="pips">' + PIPS[r].map(([x, y]) =>
        `<span style="left:${x}%;top:${y}%"${y > 50 ? ' class="flip"' : ''}>${sym}</span>`).join('') + '</div>';
    }
    return `<div class="corner tl"><b>${rk}</b><i>${sym}</i></div>${center}<div class="corner br"><b>${rk}</b><i>${sym}</i></div>`;
  }

  function makeCardEl(c) {
    const el = document.createElement('div');
    el.className = 'card s' + c.s + (OC.isRed(c) ? ' red' : '');
    el.dataset.id = c.id;
    el.innerHTML = `<div class="inner"><div class="face">${faceHTML(c.r, c.s)}</div><div class="back"></div></div>`;
    return el;
  }

  /** Parse 'AS', '10H', 'QD', 'XX' (face down) into a card object. */
  OC.parseCard = function (t) {
    if (t === 'XX') return { r: 1, s: 0, up: false };
    const sMap = { S: 0, H: 1, D: 2, C: 3 };
    const s = sMap[t.slice(-1)];
    const rs = t.slice(0, -1);
    const r = rs === 'A' ? 1 : rs === 'J' ? 11 : rs === 'Q' ? 12 : rs === 'K' ? 13 : parseInt(rs, 10);
    return { r, s, up: true };
  };

  /** Static inline card for tutorials: OC.mini('AS QH XX') */
  OC.mini = function (list, extra = '') {
    return '<span class="mini-row">' + list.split(/\s+/).filter(Boolean).map((t) => {
      const c = OC.parseCard(t);
      const red = c.s === 1 || c.s === 2;
      return `<span class="card mini s${c.s}${red ? ' red' : ''}${c.up ? ' up' : ''} ${extra}"><span class="inner"><span class="face">${faceHTML(c.r, c.s)}</span><span class="back"></span></span></span>`;
    }).join('') + '</span>';
  };

  /* ------------------------------------------------------------------ */
  /* Table renderer: keyed absolutely positioned elements                */
  /* ------------------------------------------------------------------ */
  class Table {
    constructor(board) {
      this.board = board;
      this.els = new Map();
      this.seen = null;
      this.spawn = null; // default {x,y} new cards fly in from
      this.cw = 60;
      this.ch = 84;
    }
    setCardWidth(cw) {
      cw = Math.max(24, Math.floor(cw));
      this.cw = cw;
      this.ch = Math.round(cw * 1.4);
      this.board.style.setProperty('--cw', cw + 'px');
      this.board.style.setProperty('--ch', this.ch + 'px');
    }
    size() {
      return { w: this.board.clientWidth, h: this.board.clientHeight };
    }
    begin() {
      this.seen = new Set();
    }
    _get(key, make) {
      let el = this.els.get(key);
      let fresh = false;
      if (!el) {
        el = make();
        this.els.set(key, el);
        this.board.appendChild(el);
        fresh = true;
      }
      this.seen.add(key);
      return [el, fresh];
    }
    _place(el, x, y, z, fresh, from, delay) {
      if (el._dragging) {
        // Never move or re-stack a card the player is holding; just remember its home.
        el._z = z;
        return;
      }
      x = Math.round(x);
      y = Math.round(y);
      if (fresh) {
        el.classList.add('notrans');
        const f = from || null;
        el.style.transform = `translate(${f ? f.x : x}px,${f ? f.y : y}px)`;
        el.style.zIndex = f ? z + 500 : z;
        void el.offsetWidth;
        el.classList.remove('notrans');
        if (!f) {
          el._x = x; el._y = y; el._z = z;
          return;
        }
      }
      const moved = el._x !== x || el._y !== y;
      el._z = z;
      if (delay) {
        el.style.transitionDelay = delay + 'ms';
        clearTimeout(el._dt);
        el._dt = setTimeout(() => (el.style.transitionDelay = ''), delay + 400);
      }
      if (moved) {
        el.style.zIndex = z + 500;
        clearTimeout(el._zt);
        el._zt = setTimeout(() => {
          el._zt = null;
          el.style.zIndex = el._z;
        }, 330 + (delay || 0));
      } else if (!el._zt) {
        el.style.zIndex = z;
      }
      el._x = x; el._y = y;
      el.style.transform = `translate(${x}px,${y}px)`;
    }
    /** Draw a card. o: {z, pile, idx, up, cls, from, delay} */
    card(c, x, y, o = {}) {
      const [el, fresh] = this._get('c' + c.id, () => makeCardEl(c));
      const up = o.up !== undefined ? o.up : c.up;
      el.classList.toggle('up', !!up);
      el.dataset.pile = o.pile !== undefined ? o.pile : '';
      el.dataset.idx = o.idx !== undefined ? o.idx : '';
      const flags = (o.cls || '').split(' ').filter(Boolean);
      for (const f of ['sel', 'hint', 'dim', 'glow', 'small']) el.classList.toggle(f, flags.includes(f));
      this._place(el, x, y, o.z || 0, fresh, o.from || this.spawn, o.delay);
      return el;
    }
    /** Empty pile marker / drop zone. o: {pile, label, h, w, cls, outline} */
    slot(key, x, y, o = {}) {
      const [el] = this._get('s' + key, () => {
        const d = document.createElement('div');
        d.className = 'slot';
        return d;
      });
      el.dataset.pile = o.pile !== undefined ? o.pile : key;
      el.dataset.idx = -1;
      el.className = 'slot' + (o.outline === false ? ' bare' : '') + (o.cls ? ' ' + o.cls : '');
      el.style.width = (o.w || this.cw) + 'px';
      el.style.height = (o.h || this.ch) + 'px';
      el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      el.style.zIndex = 0;
      el.innerHTML = o.label ? `<span>${o.label}</span>` : '';
      return el;
    }
    /** Floating text label. o: {cls, w, align, pile} */
    label(key, x, y, html, o = {}) {
      const [el] = this._get('l' + key, () => {
        const d = document.createElement('div');
        d.className = 'tlabel';
        return d;
      });
      el.className = 'tlabel' + (o.cls ? ' ' + o.cls : '');
      if (o.pile !== undefined) el.dataset.pile = o.pile; else delete el.dataset.pile;
      el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      el.style.width = o.w ? o.w + 'px' : '';
      el.style.textAlign = o.align || '';
      el.style.zIndex = o.z || 900;
      if (el._html !== html) {
        el.innerHTML = html;
        el._html = html;
      }
      return el;
    }
    end() {
      for (const [k, el] of this.els) {
        if (!this.seen.has(k)) {
          el.remove();
          this.els.delete(k);
        }
      }
      this.seen = null;
    }
    clear() {
      for (const el of this.els.values()) el.remove();
      this.els.clear();
    }
    elOf(card) {
      return this.els.get('c' + card.id);
    }
    /** Briefly shake a card element (illegal move feedback) */
    shake(card) {
      const el = this.elOf(card);
      if (!el) return;
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 400);
    }
  }
  OC.Table = Table;

  /* ------------------------------------------------------------------ */
  /* Pointer input: tap + drag for any game                              */
  /* ------------------------------------------------------------------ */
  /**
   * handlers:
   *  canDrag(pile, idx) -> array of card objects to drag (top-most last) or null
   *  onDrop(pile, idx, destPile) -> handled (game re-renders)
   *  onTap(pile, idx, target)
   */
  OC.attachInput = function (table, h) {
    const board = table.board;
    let st = null;
    const findTarget = (e) => {
      const t = e.target.closest('[data-pile]');
      if (!t || !board.contains(t) || t.dataset.pile === '') return null;
      return t;
    };
    const release = (el) => {
      el._dragging = false;
      el.classList.remove('drag');
      el._x = NaN; // force re-place (and keep it on top while it flies home)
    };
    const down = (e) => {
      if (st || (e.button !== undefined && e.button > 0)) return;
      const t = findTarget(e);
      if (!t) {
        if (h.onTap) h.onTap(null, -1, null);
        return;
      }
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, pile: t.dataset.pile, idx: +t.dataset.idx, t, drag: null };
      try { board.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const move = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.drag) {
        if (Math.hypot(dx, dy) < 10 || !h.canDrag) return;
        const cards = h.canDrag(st.pile, st.idx);
        if (!cards || !cards.length) { st.nodrag = true; return; }
        st.drag = cards.map((c, i) => {
          const el = table.elOf(c);
          clearTimeout(el._zt);
          el._zt = null;
          el._dragging = true;
          el.classList.add('drag');
          el.style.setProperty('--dz', i);
          el.style.zIndex = 5000 + i;
          // start from where the card is drawn right now (it may still be animating)
          const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
          return { el, x: m ? +m[1] : el._x, y: m ? +m[2] : el._y };
        });
      }
      for (const d of st.drag) d.el.style.transform = `translate(${d.x + dx}px,${d.y + dy}px)`;
    };
    const up = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st;
      st = null;
      if (s.drag) {
        let dest = null;
        const probe = (cx, cy) => {
          const el = document.elementFromPoint(cx, cy);
          const t = el && el.closest('[data-pile]');
          return t && board.contains(t) && t.dataset.pile !== '' ? t.dataset.pile : null;
        };
        dest = probe(e.clientX, e.clientY);
        if (!dest || dest === s.pile) {
          // try centre of the first dragged card
          const r = s.drag[0].el.getBoundingClientRect();
          const alt = probe(r.left + r.width / 2, r.top + r.height / 2);
          if (alt) dest = alt;
        }
        for (const d of s.drag) release(d.el);
        const ok = dest && dest !== s.pile && h.onDrop && h.onDrop(s.pile, s.idx, dest);
        if (!ok && h.onDragCancel) h.onDragCancel();
      } else if (!s.nodrag || Math.hypot(e.clientX - s.x, e.clientY - s.y) < 14) {
        if (h.onTap) h.onTap(s.pile, s.idx, s.t);
      }
    };
    const cancel = (e) => {
      if (!st || e.pointerId !== st.id) return;
      if (st.drag) {
        for (const d of st.drag) release(d.el);
        if (h.onDragCancel) h.onDragCancel();
      }
      st = null;
    };
    board.addEventListener('pointerdown', down);
    board.addEventListener('pointermove', move);
    board.addEventListener('pointerup', up);
    board.addEventListener('pointercancel', cancel);
    return () => {
      board.removeEventListener('pointerdown', down);
      board.removeEventListener('pointermove', move);
      board.removeEventListener('pointerup', up);
      board.removeEventListener('pointercancel', cancel);
    };
  };

  /* ------------------------------------------------------------------ */
  /* Storage, stats, settings                                            */
  /* ------------------------------------------------------------------ */
  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem('oc.' + k);
        return v === null ? def : JSON.parse(v);
      } catch (_) {
        return def;
      }
    },
    set(k, v) {
      try { localStorage.setItem('oc.' + k, JSON.stringify(v)); } catch (_) {}
    },
  };
  OC.store = store;

  OC.stats = {
    all() { return store.get('stats', {}); },
    get(id) {
      return Object.assign({ played: 0, won: 0, streak: 0, best: 0 }, this.all()[id] || {});
    },
    record(id, won) {
      const all = this.all();
      const s = Object.assign({ played: 0, won: 0, streak: 0, best: 0 }, all[id] || {});
      s.played++;
      if (won) {
        s.won++;
        s.streak++;
        s.best = Math.max(s.best, s.streak);
      } else s.streak = 0;
      all[id] = s;
      store.set('stats', all);
      return s;
    },
    reset() { store.set('stats', {}); },
  };

  OC.settings = Object.assign({ style: 'pixel', music: true, volume: 'medium', back: 'blue', felt: 'green', fourColor: false, autoFoundation: true, speed: 'normal' }, store.get('settings', {}));
  OC.applySettings = function () {
    const b = document.body;
    b.dataset.back = OC.settings.back;
    b.dataset.felt = OC.settings.felt;
    b.classList.toggle('four-color', !!OC.settings.fourColor);
    b.dataset.speed = OC.settings.speed;
    b.classList.toggle('pixel', OC.settings.style === 'pixel');
  };
  /* 9x9 pixel-art suit sprites for the pixel style (used as CSS masks) */
  const SPRITES = [
    ['....#....', '...###...', '..#####..', '.#######.', '#########', '#########', '.##.#.##.', '....#....', '...###...'], // spades
    ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....', '.........'], // hearts
    ['....#....', '...###...', '..#####..', '.#######.', '#########', '.#######.', '..#####..', '...###...', '....#....'], // diamonds
    ['...###...', '..#####..', '..#####..', '##.###.##', '#########', '#########', '##.#.#.##', '....#....', '...###...'], // clubs
    ['...######', '...######', '...#....#', '...#....#', '...#....#', '.###..###', '####.####', '####.####', '.##...##.'], // music note
  ];
  (function installSprites() {
    const root = document.documentElement.style;
    SPRITES.forEach((rows, s) => {
      let rects = '';
      rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') rects += `<rect x='${x}' y='${y}' width='1.02' height='1.02'/>`; }));
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 9' shape-rendering='crispEdges'>${rects}</svg>`;
      root.setProperty(s === 4 ? '--px-note' : '--px-s' + s, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    });
  })();

  OC.saveSettings = function () {
    store.set('settings', OC.settings);
    OC.applySettings();
    if (OC.music) {
      OC.music.sync();
      OC.music.setVolume();
    }
  };
  /** Delay multiplier for computer players */
  OC.pace = (ms) => ms * ({ fast: 0.45, normal: 1, slow: 1.7 }[OC.settings.speed] || 1);

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                          */
  /* ------------------------------------------------------------------ */
  const ui = (OC.ui = {});
  const modalStack = [];

  /** Show a modal dialog. Resolves with the clicked button's value (or null when dismissed). */
  ui.dialog = function ({ title = '', html = '', buttons = [{ label: 'OK', value: true, primary: true }], dismissible = true, cls = '' }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal ${cls}"><div class="modal-head"><h2>${title}</h2>${dismissible ? '<button class="x" aria-label="Close">✕</button>' : ''}</div><div class="modal-body">${html}</div><div class="modal-foot"></div></div>`;
      const foot = wrap.querySelector('.modal-foot');
      const close = (v) => {
        const i = modalStack.indexOf(entry);
        if (i >= 0) modalStack.splice(i, 1);
        wrap.remove();
        resolve(v);
      };
      const entry = { close: () => (dismissible ? (close(null), true) : true), el: wrap };
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = 'btn' + (b.primary ? ' primary' : '');
        btn.textContent = b.label;
        btn.onclick = () => close(b.value);
        foot.appendChild(btn);
      }
      if (!buttons.length) foot.remove();
      if (dismissible) {
        wrap.querySelector('.x').onclick = () => close(null);
        wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(null); });
      }
      modalStack.push(entry);
      document.body.appendChild(wrap);
      if (ui.onDialogMount) ui.onDialogMount(wrap);
      entry.body = wrap.querySelector('.modal-body');
      wrap._entry = entry;
      ui._lastDialog = wrap;
    });
  };
  ui.closeTopModal = function () {
    const m = modalStack[modalStack.length - 1];
    if (!m) return false;
    return m.close();
  };
  ui.hasModal = () => modalStack.length > 0;

  let toastTimer = null;
  ui.toast = function (msg, ms = 1800) {
    let t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  };

  /** Ask the player to pick a suit (Crazy Eights). Resolves with suit index. */
  ui.pickSuit = function (title = 'Choose a suit') {
    return ui.dialog({
      title,
      cls: 'suit-dialog',
      html: '<p>Pick the suit the next player must follow.</p>',
      buttons: OC.SUITS.map((s, i) => ({ label: s.sym + ' ' + s.name, value: i })),
      dismissible: false,
    });
  };

  /** Tutorial viewer for a game. */
  ui.tutorial = function (game, onPlay) {
    const pages = game.tutorial;
    let i = 0;
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal tutorial"><div class="modal-head"><h2>How to play ${OC.esc(game.name)}</h2><button class="x" aria-label="Close">✕</button></div>
      <div class="modal-body"><div class="tut-step"></div><h3 class="tut-title"></h3><div class="tut-body"></div></div>
      <div class="modal-foot"><div class="dots"></div><span class="grow"></span><button class="btn prev">Back</button><button class="btn primary next">Next</button></div></div>`;
    const entry = { close: () => { done(); return true; } };
    const done = () => {
      const k = modalStack.indexOf(entry);
      if (k >= 0) modalStack.splice(k, 1);
      wrap.remove();
    };
    const dots = wrap.querySelector('.dots');
    dots.innerHTML = pages.map(() => '<i></i>').join('');
    const show = () => {
      const p = pages[i];
      wrap.querySelector('.tut-step').textContent = `Step ${i + 1} of ${pages.length}`;
      wrap.querySelector('.tut-title').textContent = p.title;
      wrap.querySelector('.tut-body').innerHTML = p.body;
      wrap.querySelector('.modal-body').scrollTop = 0;
      dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
      wrap.querySelector('.prev').style.visibility = i === 0 ? 'hidden' : 'visible';
      wrap.querySelector('.next').textContent = i === pages.length - 1 ? (onPlay ? 'Play now' : 'Done') : 'Next';
    };
    wrap.querySelector('.x').onclick = done;
    wrap.querySelector('.prev').onclick = () => { if (i > 0) { i--; show(); } };
    wrap.querySelector('.next').onclick = () => {
      if (i < pages.length - 1) { i++; show(); } else { done(); if (onPlay) onPlay(); }
    };
    dots.querySelectorAll('i').forEach((d, k) => (d.onclick = () => { i = k; show(); }));
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) done(); });
    modalStack.push(entry);
    document.body.appendChild(wrap);
    show();
  };

  /* ------------------------------------------------------------------ */
  /* Poker hand evaluation (shared by Video Poker and Texas Hold'em)     */
  /* ------------------------------------------------------------------ */
  const HAND_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];
  OC.poker = {
    HAND_NAMES,
    /** Evaluate exactly 5 cards. Returns {cat, score, name}. Higher score wins. */
    eval5(cards) {
      const vals = cards.map((c) => (c.r === 1 ? 14 : c.r)).sort((a, b) => b - a);
      const flush = cards.every((c) => c.s === cards[0].s);
      const counts = {};
      for (const v of vals) counts[v] = (counts[v] || 0) + 1;
      const groups = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || b - a);
      const uniq = groups.length;
      let straightHigh = 0;
      if (uniq === 5) {
        if (vals[0] - vals[4] === 4) straightHigh = vals[0];
        else if (vals[0] === 14 && vals[1] === 5) straightHigh = 5; // wheel A-2-3-4-5
      }
      let cat, kick;
      if (straightHigh && flush) { cat = straightHigh === 14 ? 9 : 8; kick = [straightHigh]; }
      else if (counts[groups[0]] === 4) { cat = 7; kick = groups; }
      else if (counts[groups[0]] === 3 && counts[groups[1]] === 2) { cat = 6; kick = groups; }
      else if (flush) { cat = 5; kick = vals; }
      else if (straightHigh) { cat = 4; kick = [straightHigh]; }
      else if (counts[groups[0]] === 3) { cat = 3; kick = groups; }
      else if (counts[groups[0]] === 2 && counts[groups[1]] === 2) { cat = 2; kick = groups; }
      else if (counts[groups[0]] === 2) { cat = 1; kick = groups; }
      else { cat = 0; kick = vals; }
      let score = cat;
      for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] || 0);
      return { cat, score, name: HAND_NAMES[cat], pairRank: cat === 1 ? groups[0] : 0 };
    },
    /** Best 5-card hand from 5-7 cards. */
    best(cards) {
      if (cards.length === 5) return Object.assign(this.eval5(cards), { cards });
      let best = null;
      const n = cards.length;
      const pick = [];
      const rec = (start) => {
        if (pick.length === 5) {
          const hand = pick.map((i) => cards[i]);
          const e = this.eval5(hand);
          if (!best || e.score > best.score) best = Object.assign(e, { cards: hand });
          return;
        }
        for (let i = start; i <= n - (5 - pick.length); i++) {
          pick.push(i);
          rec(i + 1);
          pick.pop();
        }
      };
      rec(0);
      return best;
    },
  };
})();
