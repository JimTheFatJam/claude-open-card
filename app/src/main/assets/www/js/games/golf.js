/* Golf Solitaire */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;

  class Golf extends OC.Solitaire {
    deal() {
      const deck = OC.shuffle(OC.makeDeck());
      const t = [];
      for (let i = 0; i < 7; i++) {
        t.push([]);
        for (let j = 0; j < 5; j++) {
          const c = deck.pop();
          c.up = true;
          t[i].push(c);
        }
      }
      const first = deck.pop();
      first.up = true;
      this.s = { t, stock: deck, waste: [first] };
    }
    canDrag() {
      return null;
    }
    drop() {
      return false;
    }
    fits(c) {
      const top = this.s.waste[this.s.waste.length - 1];
      if (!top) return true;
      if (this.ctx.opts.wrap) return Math.abs(c.r - top.r) === 1 || Math.abs(c.r - top.r) === 12;
      return Math.abs(c.r - top.r) === 1;
    }
    tap(p, idx) {
      const s = this.s;
      if (p === 'stock') {
        if (!s.stock.length) return false;
        this.snapshot();
        const c = s.stock.pop();
        c.up = true;
        s.waste.push(c);
        return true;
      }
      if (p[0] !== 't') return false;
      const col = s.t[+p.slice(1)];
      if (!col.length) return false;
      const c = col[col.length - 1];
      if (idx !== col.length - 1 && idx !== -1) {
        this.table.shake(col[idx]);
        return false;
      }
      if (!this.fits(c)) {
        this.table.shake(c);
        return false;
      }
      this.snapshot();
      col.pop();
      s.waste.push(c);
      return true;
    }
    remaining() {
      return this.s.t.reduce((a, c) => a + c.length, 0);
    }
    isWon() {
      return this.remaining() === 0;
    }
    playable() {
      return this.s.t.map((c, i) => [c[c.length - 1], i]).filter(([c]) => c && this.fits(c));
    }
    findHint() {
      const p = this.playable();
      if (p.length) {
        // prefer a card that keeps a follow-up move available
        let best = p[0];
        for (const cand of p) {
          const after = this.s.t.some((col, i) => {
            const k = i === cand[1] ? col.length - 2 : col.length - 1;
            const c = col[k];
            return c && Math.abs(c.r - cand[0].r) === 1;
          });
          if (after) { best = cand; break; }
        }
        return { cards: [best[0]], text: 'Play ' + OC.cardName(best[0]) + ' onto the waste' };
      }
      if (this.s.stock.length) return { cards: [this.s.stock[this.s.stock.length - 1]], text: 'Nothing fits — draw from the stock' };
      return null;
    }
    onSettled() {
      if (this.over) return;
      if (!this.playable().length && !this.s.stock.length) {
        this.over = true;
        clearInterval(this.timer);
        const left = this.remaining();
        setTimeout(() => this.ctx.alive() && this.ctx.finish({
          won: false,
          title: 'Round over',
          html: `<p>No more moves. Your score is <b>${left}</b> (cards left on the table). Lower is better — 0 is a win!</p>`,
        }), 600);
      }
    }
    noHintText() {
      return 'No moves left';
    }
    extraStatus() {
      return `Cards left <b>${this.remaining()}</b> · Stock <b>${this.s.stock.length}</b>`;
    }
    render() {
      const T = this.table;
      const s = this.s;
      const { w, h } = T.size();
      const cw = Math.min((w - 16) / 7.8, (h - 20) / (1.4 * 3.25));
      T.setCardWidth(cw);
      const gap = (w - 7 * T.cw) / 8;
      const x = (i) => gap + i * (T.cw + gap);
      const top = Math.max(10, gap * 0.4);
      const by = h - T.ch - Math.max(12, gap * 0.5);
      const fan = Math.min(T.ch * 0.3, (by - top - T.ch - 16) / 4);
      T.spawn = { x: w / 2 - T.cw * 1.4, y: by };
      T.begin();
      s.t.forEach((col, i) => {
        T.slot('t' + i, x(i), top, { pile: 't' + i, h: by - top - 10 });
        col.forEach((c, k) => {
          const isTop = k === col.length - 1;
          T.card(c, x(i), top + k * fan, { z: k + 1, pile: 't' + i, idx: k, cls: this.cls(c, isTop ? (this.fits(c) ? '' : '') : '') });
        });
      });
      const sx = w / 2 - T.cw * 1.4;
      T.slot('stock', sx, by, { pile: 'stock', label: '', cls: 'clickable' });
      s.stock.forEach((c, i) => T.card(c, sx - Math.min(i, 8) * 1.2, by, { z: i + 1, pile: 'stock', idx: i, cls: this.cls(c) }));
      const wx = w / 2 + T.cw * 0.4;
      s.waste.forEach((c, i) => T.card(c, wx, by, { z: i + 1, pile: 'w', idx: i }));
      T.label('stockn', sx - 60, by + T.ch / 2 - 12, `<span class="badge">${s.stock.length}</span>`);
      T.end();
    }
  }

  OC.registerGame({
    id: 'golf',
    name: 'Golf',
    category: 'Solitaire',
    players: '1 player',
    blurb: 'Quick and breezy: clear the columns by playing cards one higher or lower.',
    preview: '5D 6C 7H',
    options: [{ key: 'wrap', label: 'King and Ace', def: false, choices: [[false, 'Don’t connect (classic)'], [true, 'Wrap around (easier)']] }],
    create: (ctx) => new Golf(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>35 cards are dealt face up in seven columns of five. Try to move <b>all of them</b> onto the waste pile at the bottom.</p>
          <p>Like real golf, your score is the number of cards you have left — <b>lower is better</b>, and 0 is a win.</p>`,
      },
      {
        title: 'Playing cards',
        body: `<p>Tap the bottom card of any column to move it onto the waste pile. It must be <b>one rank higher or lower</b> than the waste card. Suits don't matter.</p>
          <div class="example">${m('7S')} <span class="arrow">then</span> ${m('8H')} <span class="arrow">or</span> ${m('6D')}</div>
          <p>You can chain up and down: 7, 8, 7, 6, 5…</p>`,
      },
      {
        title: 'Kings and Aces',
        body: `<p>In the classic rules a <b>King</b> only accepts a Queen and an <b>Ace</b> only accepts a 2 — they don't wrap around.</p>
          <p>For an easier game, pick <b>Wrap around</b> from the <b>New</b> menu so that K–A and A–K also connect.</p>`,
      },
      {
        title: 'The stock',
        body: `<p>When nothing fits, tap the <b>stock</b> to flip a new card onto the waste. There is only one pass through the stock, so use it wisely.</p>
          <p class="tip">Look for long chains before you play — sometimes playing a card from a different column keeps a longer run going.</p>`,
      },
    ],
  });
})();
