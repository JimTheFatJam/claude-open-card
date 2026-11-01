/* FreeCell */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const P = OC.pileOf;
  const m = OC.mini;

  class FreeCell extends OC.Solitaire {
    deal() {
      const deck = OC.shuffle(OC.makeDeck());
      const s = { cells: [null, null, null, null], f: [[], [], [], []], t: [[], [], [], [], [], [], [], []] };
      deck.forEach((c, i) => {
        c.up = true;
        s.t[i % 8].push(c);
      });
      this.s = s;
    }

    pile(p) {
      const { t, n } = P(p);
      if (t === 't') return this.s.t[n];
      if (t === 'f') return this.s.f[n];
      return null;
    }

    isRun(cards) {
      for (let i = 1; i < cards.length; i++) {
        const a = cards[i - 1], b = cards[i];
        if (a.r !== b.r + 1 || OC.isRed(a) === OC.isRed(b)) return false;
      }
      return true;
    }
    /** Max cards movable at once ("supermove"). */
    maxMove(toEmpty) {
      const freeCells = this.s.cells.filter((c) => !c).length;
      let empty = this.s.t.filter((c) => !c.length).length;
      if (toEmpty) empty--;
      return (freeCells + 1) * Math.pow(2, Math.max(0, empty));
    }

    cardsAt(p, idx) {
      const { t, n } = P(p);
      if (t === 'c') return this.s.cells[n] ? [this.s.cells[n]] : null;
      if (t === 'f') {
        const f = this.s.f[n];
        return f.length ? [f[f.length - 1]] : null;
      }
      if (t === 't') {
        const col = this.s.t[n];
        if (!col.length) return null;
        if (idx < 0) idx = col.length - 1;
        const run = col.slice(idx);
        return this.isRun(run) ? run : null;
      }
      return null;
    }
    canDrag(p, idx) {
      return this.cardsAt(p, idx);
    }

    canPlace(cards, dest) {
      const { t, n } = P(dest);
      const c = cards[0];
      if (t === 'c') return cards.length === 1 && !this.s.cells[n];
      if (t === 'f') {
        if (cards.length !== 1) return false;
        const f = this.s.f[n];
        return f.length ? f[f.length - 1].s === c.s && f[f.length - 1].r === c.r - 1 : c.r === 1;
      }
      if (t === 't') {
        const col = this.s.t[n];
        if (!col.length) return cards.length <= this.maxMove(true);
        const top = col[col.length - 1];
        return OC.isRed(top) !== OC.isRed(c) && top.r === c.r + 1 && cards.length <= this.maxMove(false);
      }
      return false;
    }

    removeFrom(p, count) {
      const { t, n } = P(p);
      if (t === 'c') this.s.cells[n] = null;
      else this.pile(p).splice(-count);
    }
    addTo(dest, cards) {
      const { t, n } = P(dest);
      if (t === 'c') this.s.cells[n] = cards[0];
      else this.pile(dest).push(...cards);
    }

    move(src, idx, dest) {
      const cards = this.cardsAt(src, idx);
      if (!cards || src === dest) return false;
      if (!this.canPlace(cards, dest)) {
        if (P(dest).t === 't' && cards.length > 1) {
          const fits = this.s.t[P(dest).n].length
            ? OC.isRed(this.s.t[P(dest).n].slice(-1)[0]) !== OC.isRed(cards[0]) && this.s.t[P(dest).n].slice(-1)[0].r === cards[0].r + 1
            : true;
          if (fits) this.ctx.toast(`Not enough free space to move ${cards.length} cards (max ${this.maxMove(!this.s.t[P(dest).n].length)})`);
        }
        return false;
      }
      this.snapshot();
      this.removeFrom(src, cards.length);
      this.addTo(dest, cards);
      return true;
    }

    drop(src, idx, dest) {
      return this.move(src, idx, dest);
    }

    tap(p, idx) {
      const cards = this.cardsAt(p, idx);
      if (!cards) return false;
      const { t } = P(p);
      const tries = [];
      if (cards.length === 1 && t !== 'f') for (let i = 0; i < 4; i++) tries.push('f' + i);
      const nonEmpty = [], empty = [];
      for (let i = 0; i < 8; i++) {
        if ('t' + i === p) continue;
        (this.s.t[i].length ? nonEmpty : empty).push('t' + i);
      }
      tries.push(...nonEmpty);
      const isWholeColumn = t === 't' && cards.length === this.s.t[P(p).n].length;
      if (!isWholeColumn) tries.push(...empty);
      if (cards.length === 1 && t !== 'c') for (let i = 0; i < 4; i++) tries.push('c' + i);
      for (const d of tries) if (this.canPlace(cards, d)) return this.move(p, idx, d);
      this.table.shake(cards[0]);
      return false;
    }

    isWon() {
      return this.s.f.every((f) => f.length === 13);
    }

    safeAuto() {
      const s = this.s;
      const fr = (suit) => {
        const f = s.f.find((p) => p.length && p[0].s === suit);
        return f ? f.length : 0;
      };
      const safe = (c) => c.r <= 2 || (OC.isRed(c) ? [0, 3] : [1, 2]).every((o) => fr(o) >= c.r - 1);
      const sources = [];
      for (let i = 0; i < 4; i++) if (s.cells[i]) sources.push(['c' + i, s.cells[i]]);
      for (let i = 0; i < 8; i++) if (s.t[i].length) sources.push(['t' + i, s.t[i][s.t[i].length - 1]]);
      for (const [p, c] of sources) {
        if (!safe(c)) continue;
        for (let k = 0; k < 4; k++) {
          if (this.canPlace([c], 'f' + k)) {
            return () => {
              this.removeFrom(p, 1);
              s.f[k].push(c);
            };
          }
        }
      }
      return null;
    }

    findHint() {
      const s = this.s;
      const srcs = [];
      for (let i = 0; i < 4; i++) if (s.cells[i]) srcs.push('c' + i);
      for (let i = 0; i < 8; i++) if (s.t[i].length) srcs.push('t' + i);
      // to foundation
      for (const p of srcs) {
        const c = this.cardsAt(p, -1)[0];
        for (let k = 0; k < 4; k++) if (this.canPlace([c], 'f' + k)) return { cards: [c], slot: 'f' + k, text: 'Move ' + OC.cardName(c) + ' to the foundation' };
      }
      // cell -> tableau (non-empty)
      for (let i = 0; i < 4; i++) {
        const c = s.cells[i];
        if (!c) continue;
        for (let j = 0; j < 8; j++) if (s.t[j].length && this.canPlace([c], 't' + j)) return { cards: [c], slot: 't' + j, text: 'Move ' + OC.cardName(c) + ' from the free cell onto column ' + (j + 1) };
      }
      // tableau runs onto non-empty columns (longest run first)
      for (let i = 0; i < 8; i++) {
        const col = s.t[i];
        for (let k = 0; k < col.length; k++) {
          const run = col.slice(k);
          if (!this.isRun(run)) continue;
          for (let j = 0; j < 8; j++) {
            if (j === i || !s.t[j].length) continue;
            if (this.canPlace(run, 't' + j)) return { cards: run, slot: 't' + j, text: 'Move ' + OC.cardName(run[0]) + (run.length > 1 ? ' and the cards below it' : '') + ' onto column ' + (j + 1) };
          }
        }
      }
      // something to a free cell / empty column
      const freeCell = s.cells.findIndex((c) => !c);
      const emptyCol = s.t.findIndex((c) => !c.length);
      if (freeCell >= 0 || emptyCol >= 0) {
        // pick the column with the fewest cards above a low card
        let bestI = -1, bestScore = 1e9;
        for (let i = 0; i < 8; i++) {
          const col = s.t[i];
          if (col.length <= 1 && emptyCol >= 0) continue;
          if (!col.length) continue;
          const minPos = col.reduce((a, c, k) => (c.r < col[a].r ? k : a), 0);
          const score = (col.length - minPos) * 13 + col[minPos].r;
          if (score < bestScore) { bestScore = score; bestI = i; }
        }
        if (bestI >= 0) {
          const c = s.t[bestI][s.t[bestI].length - 1];
          return freeCell >= 0
            ? { cards: [c], slot: 'c' + freeCell, text: 'Park ' + OC.cardName(c) + ' in a free cell' }
            : { cards: [c], slot: 't' + emptyCol, text: 'Move ' + OC.cardName(c) + ' into the empty column' };
        }
      }
      return null;
    }

    extraStatus() {
      return 'Can move <b>' + this.maxMove(false) + '</b>';
    }

    render() {
      const T = this.table;
      const s = this.s;
      const { w, h } = T.size();
      const cw = Math.min((w - 16) / 8.6, (h - 16) / (1.4 * 3.4));
      T.setCardWidth(cw);
      const gap = (w - 8 * T.cw) / 9;
      const x = (i) => gap + i * (T.cw + gap);
      const top = Math.max(8, gap * 0.5);
      const ty = top + T.ch + Math.max(12, T.ch * 0.16);
      T.spawn = null;
      T.begin();
      for (let i = 0; i < 4; i++) {
        T.slot('c' + i, x(i), top, { pile: 'c' + i, label: 'free<br>cell', cls: this.slotCls('c' + i, 'solid cell') });
        const c = s.cells[i];
        if (c) T.card(c, x(i), top, { z: 1, pile: 'c' + i, idx: 0, cls: this.cls(c) });
      }
      for (let i = 0; i < 4; i++) {
        T.slot('f' + i, x(4 + i), top, { pile: 'f' + i, label: 'A', cls: this.slotCls('f' + i) });
        s.f[i].forEach((c, k) => T.card(c, x(4 + i), top, { z: k + 1, pile: 'f' + i, idx: k, cls: this.cls(c) }));
      }
      for (let i = 0; i < 8; i++) {
        const col = s.t[i];
        T.slot('t' + i, x(i), ty, { pile: 't' + i, h: h - ty, cls: this.slotCls('t' + i) });
        const ys = OC.fanOffsets(col, T.ch, h - ty - 6, 0.13, 0.27);
        col.forEach((c, k) => T.card(c, x(i), ty + ys[k], { z: k + 1, pile: 't' + i, idx: k, cls: this.cls(c) }));
      }
      T.end();
    }
  }

  OC.registerGame({
    id: 'freecell',
    name: 'FreeCell',
    category: 'Solitaire',
    players: '1 player',
    blurb: 'Every card is face up. Use four free cells to untangle the columns.',
    preview: '7D 6S 5H',
    create: (ctx) => new FreeCell(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Build all four <b>foundations</b> (top right) up by suit from Ace to King.</p>
          <div class="example">${m('AS 2S 3S')} <span class="arrow">→ … →</span> ${m('KS')}</div>
          <p>Unlike Klondike, <b>every card is dealt face up</b> into eight columns — there is no stock. Almost every deal can be solved with careful planning!</p>`,
      },
      {
        title: 'Free cells',
        body: `<p>The four spaces at the top left are <b>free cells</b>. Each can hold <b>one card</b> of any kind, temporarily.</p>
          <p>Use them to park cards that are in the way, but don't fill them all up — a full set of free cells leaves you stuck.</p>`,
      },
      {
        title: 'Building columns',
        body: `<p>In the columns, place a card on one that is <b>one rank higher</b> and the <b>opposite colour</b>:</p>
          <div class="example">${m('QC JD 10S 9H')}</div>
          <p>Any card can go into an <b>empty column</b>.</p>`,
      },
      {
        title: 'Moving several cards',
        body: `<p>Officially you move one card at a time, but the game lets you move a whole ordered run at once if you have enough empty space to do it card by card.</p>
          <p>The number you can move is <b>(free cells + 1) × 2<sup>empty columns</sup></b>. It's shown as <b>Can move</b> in the bar at the top.</p>`,
      },
      {
        title: 'Controls & tips',
        body: `<ul><li><b>Drag</b> cards to move them, or <b>tap</b> a card to send it to the best spot (foundation, then a column, then a free cell).</li>
          <li><b>Undo</b> as often as you like; <b>Hint</b> suggests a move.</li></ul>
          <p class="tip">Tips: free up Aces and twos early, try to empty a whole column (it's worth more than a free cell), and think a few moves ahead before using a free cell.</p>`,
      },
    ],
  });
})();
