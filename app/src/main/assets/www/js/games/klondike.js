/* Klondike Solitaire */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const P = OC.pileOf;
  const m = OC.mini;

  class Klondike extends OC.Solitaire {
    deal() {
      const deck = OC.shuffle(OC.makeDeck());
      const s = { stock: [], waste: [], f: [[], [], [], []], t: [[], [], [], [], [], [], []], passes: 0 };
      for (let i = 0; i < 7; i++) {
        for (let j = i; j < 7; j++) {
          const c = deck.pop();
          c.up = j === i;
          s.t[j].push(c);
        }
      }
      s.stock = deck;
      this.s = s;
      this.draw = this.ctx.opts.draw;
      this.blockedKey = null;
    }

    pile(p) {
      const { t, n } = P(p);
      if (t === 't') return this.s.t[n];
      if (t === 'f') return this.s.f[n];
      if (t === 'w') return this.s.waste;
      if (t === 'stock') return this.s.stock;
      return null;
    }

    canDrag(p, idx) {
      const { t } = P(p);
      const pile = this.pile(p);
      if (!pile || !pile.length) return null;
      if (t === 'w' || t === 'f') return [pile[pile.length - 1]];
      if (t === 't' && idx >= 0 && pile[idx] && pile[idx].up) return pile.slice(idx);
      return null;
    }

    canPlace(cards, dest) {
      const { t, n } = P(dest);
      const c = cards[0];
      if (t === 'f') {
        if (cards.length !== 1) return false;
        const f = this.s.f[n];
        return f.length ? f[f.length - 1].s === c.s && f[f.length - 1].r === c.r - 1 : c.r === 1;
      }
      if (t === 't') {
        const col = this.s.t[n];
        if (!col.length) return c.r === 13;
        const top = col[col.length - 1];
        return top.up && OC.isRed(top) !== OC.isRed(c) && top.r === c.r + 1;
      }
      return false;
    }

    move(src, idx, dest) {
      const pile = this.pile(src);
      const { t } = P(src);
      const from = t === 't' ? idx : pile.length - 1;
      const cards = pile.slice(from);
      if (!this.canPlace(cards, dest)) return false;
      this.snapshot();
      pile.splice(from);
      this.pile(dest).push(...cards);
      this.flipTops();
      return true;
    }
    flipTops() {
      for (const col of this.s.t) if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
    }

    drop(src, idx, dest) {
      const { t } = P(dest);
      if (t === 'w' || t === 'stock') return false;
      return this.move(src, idx, dest);
    }

    drawStock() {
      const s = this.s;
      if (!s.stock.length) {
        if (!s.waste.length) return false;
        this.snapshot();
        s.stock = s.waste.reverse().map((c) => ((c.up = false), c));
        s.waste = [];
        s.passes++;
        return true;
      }
      this.snapshot();
      for (let i = 0; i < this.draw && s.stock.length; i++) {
        const c = s.stock.pop();
        c.up = true;
        s.waste.push(c);
      }
      return true;
    }

    /** Best destination for a tapped card (foundation first, then tableau). */
    autoDest(src, idx) {
      const cards = this.canDrag(src, idx);
      if (!cards) return null;
      if (cards.length === 1 && P(src).t !== 'f') {
        for (let i = 0; i < 4; i++) if (this.canPlace(cards, 'f' + i)) return 'f' + i;
      }
      // prefer non-empty columns, then empty ones (avoid pointless king shuffles)
      const isKingAtBase = P(src).t === 't' && idx === 0;
      let empty = null;
      for (let i = 0; i < 7; i++) {
        const d = 't' + i;
        if (d === src) continue;
        if (!this.canPlace(cards, d)) continue;
        if (this.s.t[i].length) return d;
        if (!isKingAtBase && empty === null) empty = d;
      }
      return empty;
    }

    tap(p, idx) {
      const { t } = P(p);
      if (t === 'stock') return this.drawStock();
      const dest = this.autoDest(p, idx);
      if (dest) return this.move(p, idx, dest);
      const pile = this.pile(p);
      if (pile && pile.length && (idx < 0 ? pile[pile.length - 1] : pile[idx])) this.table.shake(idx < 0 ? pile[pile.length - 1] : pile[idx]);
      return false;
    }

    isWon() {
      return this.s.f.every((f) => f.length === 13);
    }

    /** Safe auto-moves to the foundation: card is only needed by lower opposite-colour cards already home. */
    safeAuto() {
      const s = this.s;
      const fr = (suit) => {
        const f = s.f.find((p) => p.length && p[0].s === suit);
        return f ? f.length : 0;
      };
      const safe = (c) => {
        if (c.r <= 2) return true;
        const opp = OC.isRed(c) ? [0, 3] : [1, 2];
        return opp.every((o) => fr(o) >= c.r - 1);
      };
      const tryPile = (p) => {
        const pile = this.pile(p);
        if (!pile.length) return null;
        const c = pile[pile.length - 1];
        if (!c.up || !safe(c)) return null;
        for (let i = 0; i < 4; i++) {
          if (this.canPlace([c], 'f' + i)) {
            return () => {
              pile.pop();
              s.f[i].push(c);
              this.flipTops();
            };
          }
        }
        return null;
      };
      for (let i = 0; i < 7; i++) {
        const mv = tryPile('t' + i);
        if (mv) return mv;
      }
      return tryPile('w');
    }

    canAutoFinish() {
      const s = this.s;
      return !this.over && !s.stock.length && !s.waste.length && s.t.every((c) => c.every((x) => x.up));
    }
    onSettled() {
      this.ctx.actions(this.canAutoFinish() ? [{ label: 'Auto finish', primary: true, onClick: () => this.autoFinish() }] : []);
      this.checkBlocked();
    }

    /** Every card that will be on top of the waste during a full trip through the stock (with no other moves). */
    reachableStockCards() {
      const s = this.s;
      const out = new Set();
      if (s.waste.length) out.add(s.waste[s.waste.length - 1]);
      let stock = s.stock.slice(), waste = s.waste.slice();
      const total = stock.length + waste.length;
      for (let step = 0; step < 2 * (total + 2); step++) {
        if (!stock.length) {
          if (!waste.length) break;
          stock = waste.reverse();
          waste = [];
          continue;
        }
        for (let i = 0; i < this.draw && stock.length; i++) waste.push(stock.pop());
        out.add(waste[waste.length - 1]);
      }
      return [...out];
    }

    /** True when some move can still make progress (cycling the stock alone never does). */
    hasUsefulMove() {
      const s = this.s;
      const avail = this.reachableStockCards();
      const fits = (c, top) => top.up && OC.isRed(top) !== OC.isRed(c) && top.r === c.r + 1;
      const toFoundation = (c) => [0, 1, 2, 3].some((i) => this.canPlace([c], 'f' + i));
      // cards that go home, or stock cards that can be played on the table
      for (const col of s.t) if (col.length && col[col.length - 1].up && toFoundation(col[col.length - 1])) return true;
      for (const c of avail) {
        if (toFoundation(c)) return true;
        for (let j = 0; j < 7; j++) if (this.canPlace([c], 't' + j)) return true;
      }
      const kingWaiting = avail.some((c) => c.r === 13) || s.t.some((col) => col.some((c, k) => c.up && c.r === 13 && k > 0));
      // tableau moves that reveal a card, free a useful empty column, or open a spot for another card
      for (let i = 0; i < 7; i++) {
        const col = s.t[i];
        const first = col.findIndex((c) => c.up);
        if (first < 0) continue;
        for (let k = first; k < col.length; k++) {
          const run = col.slice(k);
          let canMove = false;
          for (let j = 0; j < 7 && !canMove; j++) if (j !== i && s.t[j].length && this.canPlace(run, 't' + j)) canMove = true;
          if (!canMove) continue;
          if (k === first && k > 0) return true; // turns over a face-down card
          if (k === 0 && kingWaiting) return true; // empties a column for a King
          if (k > first) {
            const exposed = col[k - 1];
            if (toFoundation(exposed)) return true;
            if (avail.some((c) => fits(c, exposed))) return true;
            // ...or lets another column's run move there, uncovering a face-down card
            for (let j = 0; j < 7; j++) {
              if (j === i) continue;
              const f2 = s.t[j].findIndex((c) => c.up);
              if (f2 > 0 && fits(s.t[j][f2], exposed)) return true;
            }
          }
        }
      }
      // taking a card back from a foundation to make room for another card
      for (const f of s.f) {
        if (!f.length) continue;
        const top = f[f.length - 1];
        if (!s.t.some((col) => col.length && fits(top, col[col.length - 1]))) continue;
        const asTop = Object.assign({}, top, { up: true });
        if (avail.some((c) => fits(c, asTop))) return true;
        for (const col of s.t) {
          const first = col.findIndex((c) => c.up);
          if (first > 0 && fits(col[first], asTop)) return true;
        }
      }
      return false;
    }

    /** Tell the player when the deal is blocked instead of letting them cycle the stock forever. */
    async checkBlocked() {
      if (this.over || this.isWon() || this.canAutoFinish() || this.hasUsefulMove()) return;
      const key = JSON.stringify([this.s.t.map((c) => c.map((x) => x.id + (x.up ? 'u' : ''))), this.s.f.map((f) => f.length)]);
      if (this.blockedKey === key) return; // already told them about this position
      this.blockedKey = key;
      const v = await this.ctx.dialog({
        title: 'No more moves',
        html: `<p>None of the cards left in the stock can be played, and there are no useful moves on the table. Going through the stock again would only repeat the same cards.</p>
          <p>This game is <b>blocked</b> and can't be won from here. That's normal in Klondike: not every deal can be solved.</p>
          <p class="note">You can undo some moves and try a different path, or start a new deal.</p>`,
        buttons: [{ label: 'Keep looking', value: 'keep' }, { label: 'Undo a move', value: 'undo' }, { label: 'New game', value: 'new', primary: true }],
      });
      if (!this.ctx.alive()) return;
      if (v === 'undo') this.undo();
      else if (v === 'new') {
        if (this.inProgress()) this.ctx.record(false);
        this.start();
      }
    }
    async autoFinish() {
      this.ctx.actions([]);
      this.snapshot();
      this.busy = true;
      while (this.ctx.alive() && !this.isWon()) {
        let done = false;
        for (let i = 0; i < 7 && !done; i++) {
          const col = this.s.t[i];
          if (!col.length) continue;
          const c = col[col.length - 1];
          for (let k = 0; k < 4; k++) {
            if (this.canPlace([c], 'f' + k)) {
              col.pop();
              this.s.f[k].push(c);
              done = true;
              break;
            }
          }
        }
        if (!done) break;
        this.moves++;
        this.render();
        await this.ctx.wait(90);
      }
      this.busy = false;
      if (this.isWon()) this.won();
    }

    findHint() {
      const s = this.s;
      // 1. to foundation
      for (const p of ['w', 't0', 't1', 't2', 't3', 't4', 't5', 't6']) {
        const pile = this.pile(p);
        if (!pile.length) continue;
        const c = pile[pile.length - 1];
        for (let i = 0; i < 4; i++) if (this.canPlace([c], 'f' + i)) return { cards: [c], slot: 'f' + i, text: 'Move ' + OC.cardName(c) + ' to the foundation' };
      }
      // 2. tableau moves that reveal a face-down card or empty a column usefully
      for (let i = 0; i < 7; i++) {
        const col = s.t[i];
        const k = col.findIndex((c) => c.up);
        if (k < 0) continue;
        if (k === 0 && col[0].r === 13) continue;
        const cards = col.slice(k);
        for (let j = 0; j < 7; j++) {
          if (j === i || !this.canPlace(cards, 't' + j)) continue;
          if (!s.t[j].length && k === 0) continue;
          return { cards, slot: 't' + j, text: 'Move the ' + OC.cardName(cards[0]) + (cards.length > 1 ? ' stack' : '') + ' onto column ' + (j + 1) };
        }
      }
      // 3. waste to tableau
      if (s.waste.length) {
        const c = s.waste[s.waste.length - 1];
        for (let j = 0; j < 7; j++) if (this.canPlace([c], 't' + j)) return { cards: [c], slot: 't' + j, text: 'Play ' + OC.cardName(c) + ' onto column ' + (j + 1) };
      }
      if (!this.hasUsefulMove()) return null; // cycling the stock can't help any more
      if (s.stock.length || s.waste.length) return { cards: s.stock.length ? [s.stock[s.stock.length - 1]] : [], slot: 'stock', text: s.stock.length ? 'Draw from the stock' : 'Turn the waste back over to the stock' };
      return null;
    }

    noHintText() {
      return 'No useful moves left \u2014 this deal is blocked. Undo some moves or start a new game.';
    }

    extraStatus() {
      return 'Draw ' + this.draw;
    }

    render() {
      const T = this.table;
      const s = this.s;
      const { w, h } = T.size();
      const cw = Math.min((w - 16) / 7.5, (h - 16) / (1.4 * 3.6));
      T.setCardWidth(cw);
      const gap = (w - 7 * T.cw) / 8;
      const x = (i) => gap + i * (T.cw + gap);
      const top = Math.max(8, gap * 0.6);
      const ty = top + T.ch + Math.max(12, T.ch * 0.18);
      T.spawn = { x: x(0), y: top };
      T.begin();
      // stock
      T.slot('stock', x(0), top, { pile: 'stock', label: s.stock.length ? '' : '↻', cls: this.slotCls('stock', 'clickable') });
      s.stock.forEach((c, i) => T.card(c, x(0) + Math.min(i, 3) * -0.5, top - Math.min(i, 3) * 0.5, { z: i + 1, pile: 'stock', idx: i, cls: this.cls(c) }));
      // waste (fan last 3 in draw-3)
      T.slot('w', x(1), top, { pile: 'w', outline: false });
      const wl = s.waste.length;
      const fanN = this.draw === 3 ? Math.min(3, wl) : 1;
      s.waste.forEach((c, i) => {
        const off = i >= wl - fanN ? i - (wl - fanN) : 0;
        T.card(c, x(1) + off * T.cw * 0.3, top, { z: i + 1, pile: 'w', idx: i, cls: this.cls(c) });
      });
      // foundations
      for (let i = 0; i < 4; i++) {
        const f = s.f[i];
        T.slot('f' + i, x(3 + i), top, { pile: 'f' + i, label: 'A', cls: this.slotCls('f' + i) });
        f.forEach((c, k) => T.card(c, x(3 + i), top, { z: k + 1, pile: 'f' + i, idx: k, cls: this.cls(c) }));
      }
      // tableau
      for (let i = 0; i < 7; i++) {
        const col = s.t[i];
        T.slot('t' + i, x(i), ty, { pile: 't' + i, label: 'K', h: h - ty, cls: this.slotCls('t' + i) });
        const ys = OC.fanOffsets(col, T.ch, h - ty - 6);
        col.forEach((c, k) => T.card(c, x(i), ty + ys[k], { z: k + 1, pile: 't' + i, idx: k, cls: this.cls(c) }));
      }
      T.end();
    }
  }

  OC.registerGame({
    id: 'klondike',
    name: 'Klondike',
    category: 'Solitaire',
    players: '1 player',
    blurb: 'The classic patience game. Build four suit piles from Ace to King.',
    preview: 'KS QH JS',
    options: [{ key: 'draw', label: 'Cards drawn from stock', def: 1, choices: [[1, 'Draw 1 (easier)'], [3, 'Draw 3 (classic)']] }],
    create: (ctx) => new Klondike(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Move all 52 cards onto the four <b>foundations</b> at the top right. Each foundation is built <b>up by suit</b>, starting with the Ace:</p>
          <div class="example">${m('AH 2H 3H 4H')} <span class="arrow">→ … →</span> ${m('KH')}</div>
          <p>When all four foundations reach the King, you win.</p>`,
      },
      {
        title: 'The layout',
        body: `<ul><li><b>Tableau</b> — the seven columns. Only the bottom card of each column starts face up.</li>
          <li><b>Stock</b> — the face-down pile at the top left. Tap it to draw cards.</li>
          <li><b>Waste</b> — drawn cards land here, next to the stock. The top waste card can be played.</li>
          <li><b>Foundations</b> — the four empty spaces at the top right.</li></ul>`,
      },
      {
        title: 'Building columns',
        body: `<p>In the tableau, place cards in <b>descending order</b> and <b>alternating colours</b> — red on black, black on red.</p>
          <div class="example">${m('9S 8H 7C 6D')}</div>
          <p>You can move a whole face-up run at once, as long as its top card fits the destination.</p>
          <p class="tip">When you move the last face-up card off a face-down card, the face-down card is turned over automatically.</p>`,
      },
      {
        title: 'Empty columns',
        body: `<p>Only a <b>King</b> (or a run starting with a King) can be placed in an empty column.</p>
          <div class="example">${m('KD QS JH')}</div>
          <p>Freeing columns and uncovering face-down cards is the key to winning.</p>`,
      },
      {
        title: 'The stock',
        body: `<p>Tap the stock to turn over cards onto the waste: <b>1 card</b> at a time in Draw 1, or <b>3 cards</b> in Draw 3 (only the top one is playable).</p>
          <p>When the stock runs out, tap the empty space to turn the waste back over and go through it again.</p>
          <p>Change the draw mode with the <b>New</b> button.</p>`,
      },
      {
        title: 'Controls',
        body: `<ul><li><b>Drag</b> a card or run to move it.</li>
          <li><b>Tap</b> a card to send it to the best legal spot automatically.</li>
          <li><b>Undo</b> takes back moves; <b>Hint</b> highlights a suggested move.</li>
          <li>Cards that are safe to send home are moved to the foundations for you (turn this off in Settings).</li>
          <li>Once every card is face up, tap <b>Auto finish</b>.</li></ul>
          <p class="tip">Strategy: uncover face-down cards in the longest columns first, and don't rush cards to the foundations if you still need them to build on.</p>`,
      },
    ],
  });
})();
