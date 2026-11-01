/* Pyramid Solitaire */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const val = (c) => c.r; // J=11 Q=12 K=13

  class Pyramid extends OC.Solitaire {
    deal() {
      const deck = OC.shuffle(OC.makeDeck());
      const pyr = [];
      for (let r = 0; r < 7; r++) {
        const row = [];
        for (let i = 0; i <= r; i++) {
          const c = deck.pop();
          c.up = true;
          row.push(c);
        }
        pyr.push(row);
      }
      this.s = { pyr, stock: deck, waste: [], gone: [], round: 1, sel: null };
    }
    get maxRounds() {
      return 3;
    }
    /** a pyramid card is free when both cards below it are gone */
    isFree(r, i) {
      const P = this.s.pyr;
      if (!P[r][i]) return false;
      if (r === 6) return true;
      return !P[r + 1][i] && !P[r + 1][i + 1];
    }
    cardAt(p, idx) {
      const s = this.s;
      if (p === 'w') return s.waste.length ? s.waste[s.waste.length - 1] : null;
      if (p === 'stock') return null;
      const r = +p.slice(1);
      return s.pyr[r] ? s.pyr[r][idx] : null;
    }
    free(p, idx) {
      if (p === 'w') return !!this.cardAt('w');
      if (p[0] === 'p') return this.isFree(+p.slice(1), idx);
      return false;
    }
    canDrag() {
      return null;
    }
    drop() {
      return false;
    }
    remove(p, idx) {
      const s = this.s;
      let c;
      if (p === 'w') c = s.waste.pop();
      else {
        const r = +p.slice(1);
        c = s.pyr[r][idx];
        s.pyr[r][idx] = null;
      }
      s.gone.push(c);
    }
    tap(p, idx) {
      const s = this.s;
      if (p === 'stock') {
        s.sel = null;
        if (s.stock.length) {
          this.snapshot();
          const c = s.stock.pop();
          c.up = true;
          s.waste.push(c);
          return true;
        }
        if (s.round < this.maxRounds && s.waste.length) {
          this.snapshot();
          s.stock = s.waste.reverse().map((c) => ((c.up = false), c));
          s.waste = [];
          s.round++;
          return true;
        }
        this.ctx.toast('No more passes through the stock');
        return false;
      }
      const c = this.cardAt(p, idx);
      if (!c) return false;
      if (!this.free(p, idx)) {
        this.table.shake(c);
        s.sel = null;
        return 'render';
      }
      if (val(c) === 13) {
        this.snapshot();
        s.sel = null;
        this.remove(p, idx);
        return true;
      }
      if (!s.sel) {
        s.sel = { p, idx, id: c.id };
        return 'render';
      }
      if (s.sel.id === c.id) {
        s.sel = null;
        return 'render';
      }
      const a = this.cardAt(s.sel.p, s.sel.idx);
      if (a && val(a) + val(c) === 13) {
        this.snapshot();
        const first = s.sel;
        s.sel = null;
        // remove deeper one first so indices stay valid (different piles anyway)
        this.remove(first.p, first.idx);
        this.remove(p, idx);
        return true;
      }
      s.sel = { p, idx, id: c.id };
      this.ctx.toast('Those two cards add up to ' + (val(a) + val(c)) + ', not 13');
      return 'render';
    }
    isWon() {
      return this.s.pyr.every((row) => row.every((c) => !c));
    }
    freeCards() {
      const out = [];
      this.s.pyr.forEach((row, r) => row.forEach((c, i) => { if (c && this.isFree(r, i)) out.push(['p' + r, i, c]); }));
      if (this.s.waste.length) out.push(['w', -1, this.s.waste[this.s.waste.length - 1]]);
      return out;
    }
    findHint() {
      const fc = this.freeCards();
      for (const [, , c] of fc) if (c.r === 13) return { cards: [c], text: 'Tap the King to remove it' };
      for (let a = 0; a < fc.length; a++)
        for (let b = a + 1; b < fc.length; b++)
          if (val(fc[a][2]) + val(fc[b][2]) === 13) return { cards: [fc[a][2], fc[b][2]], text: `${OC.cardShort(fc[a][2])} + ${OC.cardShort(fc[b][2])} = 13` };
      if (this.s.stock.length) return { cards: [this.s.stock[this.s.stock.length - 1]], text: 'Draw a card from the stock' };
      if (this.s.round < this.maxRounds && this.s.waste.length) return { cards: [], slot: 'stock', text: 'Turn the waste over for another pass' };
      return null;
    }
    onSettled() {
      if (this.over) return;
      if (!this.findHint()) {
        this.over = true;
        clearInterval(this.timer);
        const left = this.s.pyr.flat().filter(Boolean).length;
        setTimeout(() => this.ctx.alive() && this.ctx.finish({ won: false, title: 'No more moves', html: `<p><b>${left}</b> card${left === 1 ? '' : 's'} left in the pyramid.</p>` }), 600);
      }
    }
    noHintText() {
      return 'No moves left';
    }
    extraStatus() {
      return `Pass <b>${this.s.round}/${this.maxRounds}</b>`;
    }
    render() {
      const T = this.table;
      const s = this.s;
      const { w, h } = T.size();
      const cw = Math.min((w - 20) / 10.2, (h - 20) / (1.4 * 4.2));
      T.setCardWidth(cw);
      const gapX = T.cw * 0.12;
      const rowH = T.ch * 0.52;
      const pyrW = 7 * T.cw + 6 * gapX;
      const leftW = T.cw * 2.4;
      const x0 = Math.max(leftW + 10, (w - pyrW) / 2);
      const y0 = Math.max(10, (h - (6 * rowH + T.ch)) / 2);
      const sx = Math.max(8, x0 - leftW - T.cw * 0.6);
      T.spawn = { x: sx, y: y0 };
      T.begin();
      s.pyr.forEach((row, r) => {
        const rx = x0 + (6 - r) * (T.cw + gapX) / 2;
        row.forEach((c, i) => {
          if (!c) return;
          const free = this.isFree(r, i);
          let cls = s.sel && s.sel.id === c.id ? 'sel' : free ? '' : 'dim';
          T.card(c, rx + i * (T.cw + gapX), y0 + r * rowH, { z: r * 10 + i + 1, pile: 'p' + r, idx: i, cls: this.cls(c, cls) });
        });
      });
      // stock & waste on the left
      T.slot('stock', sx, y0, { pile: 'stock', label: s.round < this.maxRounds ? '↻' : '✕', cls: this.slotCls('stock', 'clickable') });
      s.stock.forEach((c, i) => T.card(c, sx, y0, { z: i + 1, pile: 'stock', idx: i, cls: this.cls(c) }));
      const wy = y0 + T.ch + 18;
      T.slot('w', sx, wy, { pile: 'w', label: '' });
      s.waste.forEach((c, i) => {
        const top = i === s.waste.length - 1;
        T.card(c, sx, wy, { z: i + 1, pile: 'w', idx: i, cls: this.cls(c, top && s.sel && s.sel.id === c.id ? 'sel' : '') });
      });
      // removed pile, bottom-right
      s.gone.forEach((c, i) => T.card(c, w - T.cw - 12, h - T.ch - 12, { z: i + 1, pile: '', cls: 'dim' }));
      T.label('pstock', sx, y0 - 22 < 0 ? y0 + T.ch + 2 : y0 - 22, `<span class="badge">${s.stock.length}</span>`);
      T.end();
    }
  }

  OC.registerGame({
    id: 'pyramid',
    name: 'Pyramid',
    category: 'Solitaire',
    players: '1 player',
    blurb: 'Clear the pyramid by pairing cards that add up to 13.',
    preview: '6C 7H KS',
    create: (ctx) => new Pyramid(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>28 cards are dealt in a pyramid of seven rows. Remove every card from the pyramid by pairing cards whose values <b>add up to 13</b>.</p>
          <p>Card values: <b>Ace = 1</b>, number cards = their number, <b>Jack = 11</b>, <b>Queen = 12</b>, <b>King = 13</b>.</p>`,
      },
      {
        title: 'Making pairs',
        body: `<p>Tap one card, then tap another. If they add up to 13, both are removed:</p>
          <div class="example">${m('6C 7H')} <span class="arrow">6 + 7 = 13</span></div>
          <div class="example">${m('QS AD')} <span class="arrow">12 + 1 = 13</span></div>
          <div class="example">${m('JD 2C')} <span class="arrow">11 + 2 = 13</span></div>
          <p>A <b>King</b> is worth 13 on its own — just tap it to remove it.</p>`,
      },
      {
        title: 'Free cards',
        body: `<p>You can only use a card that is <b>not covered</b> by any card in the row below it. Covered cards are shown darker.</p>
          <p>At the start, only the bottom row of seven cards is free.</p>`,
      },
      {
        title: 'The stock',
        body: `<p>Tap the <b>stock</b> (left side) to turn a card onto the waste pile. The top waste card can be paired with a free pyramid card.</p>
          <p>When the stock runs out, tap its empty space to turn the waste back over. You get <b>3 passes</b> in total.</p>
          <p class="tip">Think before drawing: sometimes it's better to wait for a card that frees more of the pyramid.</p>`,
      },
    ],
  });
})();
