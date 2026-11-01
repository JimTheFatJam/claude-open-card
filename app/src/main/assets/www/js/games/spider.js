/* Spider Solitaire (two decks) */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const P = OC.pileOf;
  const m = OC.mini;

  class Spider extends OC.Solitaire {
    deal() {
      const suits = { 1: [0], 2: [0, 1], 4: [0, 1, 2, 3] }[this.ctx.opts.suits];
      const deck = OC.shuffle(OC.makeDeck(2, suits));
      const s = { stock: [], done: [], t: Array.from({ length: 10 }, () => []) };
      for (let i = 0; i < 54; i++) {
        const c = deck.pop();
        s.t[i % 10].push(c);
      }
      s.t.forEach((col) => (col[col.length - 1].up = true));
      s.stock = deck;
      this.s = s;
    }

    isRun(cards) {
      for (let i = 1; i < cards.length; i++) if (cards[i - 1].s !== cards[i].s || cards[i - 1].r !== cards[i].r + 1) return false;
      return cards.every((c) => c.up);
    }
    canDrag(p, idx) {
      const { t, n } = P(p);
      if (t !== 't') return null;
      const col = this.s.t[n];
      if (idx < 0 || !col[idx] || !col[idx].up) return null;
      const run = col.slice(idx);
      return this.isRun(run) ? run : null;
    }
    canPlace(cards, dest) {
      const { t, n } = P(dest);
      if (t !== 't') return false;
      const col = this.s.t[n];
      return !col.length || col[col.length - 1].r === cards[0].r + 1;
    }
    move(src, idx, dest) {
      const cards = this.canDrag(src, idx);
      if (!cards || src === dest || !this.canPlace(cards, dest)) return false;
      this.snapshot();
      this.s.t[P(src).n].splice(idx);
      this.s.t[P(dest).n].push(...cards);
      this.cleanup();
      return true;
    }
    /** Flip exposed cards and remove completed K..A runs. */
    cleanup() {
      for (const col of this.s.t) {
        if (col.length >= 13) {
          const run = col.slice(-13);
          if (run[0].r === 13 && this.isRun(run)) {
            col.splice(-13);
            this.s.done.push(run);
          }
        }
        if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
      }
    }
    drop(src, idx, dest) {
      return this.move(src, idx, dest);
    }
    dealRow() {
      const s = this.s;
      if (!s.stock.length) return false;
      if (s.t.some((c) => !c.length)) {
        this.ctx.toast('Fill every empty column before dealing a new row');
        return false;
      }
      this.snapshot();
      for (let i = 0; i < 10; i++) {
        const c = s.stock.pop();
        c.up = true;
        s.t[i].push(c);
      }
      this.cleanup();
      return true;
    }
    tap(p, idx) {
      const { t } = P(p);
      if (t === 'stock') return this.dealRow();
      const cards = this.canDrag(p, idx);
      if (!cards) {
        const col = t === 't' ? this.s.t[P(p).n] : null;
        if (col && col[idx]) this.table.shake(col[idx]);
        return false;
      }
      // best target: same suit match, then any match, then empty column
      let any = null, empty = null;
      for (let i = 0; i < 10; i++) {
        const d = 't' + i;
        if (d === p) continue;
        const col = this.s.t[i];
        if (!col.length) {
          if (!empty && idx > 0) empty = d;
          continue;
        }
        if (!this.canPlace(cards, d)) continue;
        if (col[col.length - 1].s === cards[0].s) return this.move(p, idx, d);
        if (!any) any = d;
      }
      const d = any || empty;
      if (d) return this.move(p, idx, d);
      this.table.shake(cards[0]);
      return false;
    }
    isWon() {
      return this.s.done.length === 8;
    }
    findHint() {
      const s = this.s;
      let fallback = null;
      for (let i = 0; i < 10; i++) {
        const col = s.t[i];
        for (let k = 0; k < col.length; k++) {
          const run = this.canDrag('t' + i, k);
          if (!run) continue;
          for (let j = 0; j < 10; j++) {
            if (j === i || !s.t[j].length || !this.canPlace(run, 't' + j)) continue;
            const destTop = s.t[j][s.t[j].length - 1];
            const below = col[k - 1];
            // skip moves that just shuffle between equal positions
            const sameSuit = destTop.s === run[0].s;
            const breaksRun = below && below.up && below.s === run[0].s && below.r === run[0].r + 1;
            if (breaksRun && !sameSuit) continue;
            if (breaksRun) continue;
            const hint = { cards: run, slot: 't' + j, text: 'Move ' + OC.cardName(run[0]) + (run.length > 1 ? ' run' : '') + ' onto column ' + (j + 1) };
            if (sameSuit || (below && !below.up) || k === 0) return hint;
            if (!fallback) fallback = hint;
          }
          break; // only the longest run from each column
        }
      }
      if (fallback) return fallback;
      if (s.stock.length) return { cards: [s.stock[s.stock.length - 1]], slot: 'stock', text: 'Deal a new row from the stock' };
      return null;
    }
    extraStatus() {
      return `Sets <b>${this.s.done.length}/8</b> · Deals left <b>${this.s.stock.length / 10}</b>`;
    }
    render() {
      const T = this.table;
      const s = this.s;
      const { w, h } = T.size();
      const cw = Math.min((w - 16) / 10.8, (h - 16) / (1.4 * 3.2));
      T.setCardWidth(cw);
      const gap = (w - 10 * T.cw) / 11;
      const x = (i) => gap + i * (T.cw + gap);
      const top = Math.max(8, gap * 0.5);
      const bottomY = h - T.ch - 8;
      T.spawn = { x: x(9), y: bottomY };
      T.begin();
      for (let i = 0; i < 10; i++) {
        const col = s.t[i];
        T.slot('t' + i, x(i), top, { pile: 't' + i, h: bottomY - top - 6, cls: this.slotCls('t' + i) });
        const ys = OC.fanOffsets(col, T.ch, bottomY - top - 10, 0.1, 0.25);
        col.forEach((c, k) => T.card(c, x(i), top + ys[k], { z: k + 1, pile: 't' + i, idx: k, cls: this.cls(c) }));
      }
      // completed sets bottom-left
      s.done.forEach((run, k) => run.forEach((c, j) => T.card(c, x(0) + k * T.cw * 0.25, bottomY, { z: 100 + k * 13 + j, up: true, pile: '' })));
      // stock bottom-right, one stack per remaining deal
      const deals = s.stock.length / 10;
      T.slot('stock', x(9), bottomY, { pile: 'stock', outline: deals === 0, cls: this.slotCls('stock') });
      s.stock.forEach((c, i) => {
        const d = Math.floor(i / 10);
        T.card(c, x(9) - (deals - 1 - d) * T.cw * 0.22, bottomY, { z: 200 + i, pile: 'stock', idx: i, cls: this.cls(c) });
      });
      T.end();
    }
  }

  OC.registerGame({
    id: 'spider',
    name: 'Spider',
    category: 'Solitaire',
    players: '1 player',
    blurb: 'Two decks, ten columns. Assemble full King-to-Ace runs of one suit.',
    preview: '10S 9S 8S',
    options: [{ key: 'suits', label: 'Difficulty', def: 1, choices: [[1, '1 suit (beginner)'], [2, '2 suits (medium)'], [4, '4 suits (expert)']] }],
    create: (ctx) => new Spider(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Spider uses <b>two decks</b> (104 cards) dealt into ten columns. Your goal is to build eight complete runs from <b>King down to Ace in a single suit</b>.</p>
          <div class="example">${m('KS QS JS 10S')} <span class="arrow">…</span> ${m('2S AS')}</div>
          <p>As soon as a full run is completed, it is removed from the table automatically.</p>`,
      },
      {
        title: 'Moving cards',
        body: `<p>Any card can be placed on a card <b>one rank higher</b>, whatever its suit:</p>
          <div class="example">${m('8H 7S')}</div>
          <p>But you can only move a <b>group</b> of cards together if they are in sequence and <b>all the same suit</b>:</p>
          <div class="example">${m('9D 8D 7D')} <span class="arrow">← can move together</span></div>
          <p>Any card or same-suit run can go into an empty column.</p>`,
      },
      {
        title: 'Dealing new rows',
        body: `<p>When you run out of moves, tap the <b>stock</b> in the bottom-right corner. It deals one new face-up card onto <b>every</b> column (five deals in total).</p>
          <p>You can only deal when <b>no column is empty</b>.</p>`,
      },
      {
        title: 'Difficulty',
        body: `<p>Choose the number of suits from the <b>New</b> button:</p>
          <ul><li><b>1 suit</b> — all spades. Great for learning.</li>
          <li><b>2 suits</b> — spades and hearts.</li>
          <li><b>4 suits</b> — the full challenge.</li></ul>`,
      },
      {
        title: 'Tips',
        body: `<ul><li>Whenever you can, build on a card of the <b>same suit</b> — mixed-suit stacks can't be moved together.</li>
          <li>Turn over face-down cards as early as possible.</li>
          <li>Empty columns are extremely valuable: use them to re-order runs.</li>
          <li><b>Tap</b> a card to auto-move it, <b>drag</b> for precision, and use <b>Undo</b> freely.</li></ul>`,
      },
    ],
  });
})();
