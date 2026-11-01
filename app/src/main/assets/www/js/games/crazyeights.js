/* Crazy Eights */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const AI_NAMES = ['Ava', 'Ben', 'Cleo'];

  class CrazyEights {
    constructor(ctx) {
      this.ctx = ctx;
      this.T = ctx.table;
      this.detach = OC.attachInput(this.T, { onTap: (p, i) => this.tap(p, i) });
    }
    destroy() {
      this.detach();
    }
    inProgress() {
      return this.started && !this.over;
    }
    start() {
      this.T.clear();
      const nOpp = this.ctx.opts.opponents;
      this.names = ['You'].concat(AI_NAMES.slice(0, nOpp));
      this.n = nOpp + 1;
      const deck = OC.shuffle(OC.makeDeck());
      this.hands = Array.from({ length: this.n }, () => []);
      const size = this.n === 2 ? 7 : 5;
      for (let k = 0; k < size; k++) for (let p = 0; p < this.n; p++) {
        const c = deck.pop();
        c.up = p === 0;
        this.hands[p].push(c);
      }
      OC.sortHand(this.hands[0], false);
      // starter can't be an 8
      let start = deck.pop();
      while (start.r === 8) {
        deck.unshift(start);
        start = deck.pop();
      }
      start.up = true;
      this.discard = [start];
      this.stock = deck;
      this.suit = start.s;
      this.turn = 0;
      this.passes = 0;
      this.over = false;
      this.started = false;
      this.busy = false;
      this.drewThisTurn = 0;
      this.said = [];
      this.ctx.buttons([]);
      this.render();
      this.humanTurn();
    }
    top() {
      return this.discard[this.discard.length - 1];
    }
    legal(c) {
      return c.r === 8 || c.s === this.suit || c.r === this.top().r;
    }
    status() {
      const sym = OC.SUITS[this.suit];
      this.ctx.status(`Suit to follow: <b style="color:${sym.red ? '#ff8a80' : '#fff'}">${sym.sym} ${sym.name}</b> &nbsp;·&nbsp; Stock <b>${this.stock.length}</b>`);
    }
    refill() {
      if (this.stock.length) return true;
      if (this.discard.length <= 1) return false;
      const top = this.discard.pop();
      this.stock = OC.shuffle(this.discard.map((c) => ((c.up = false), c)));
      this.discard = [top];
      this.ctx.toast('Discard pile reshuffled into the stock');
      return true;
    }
    drawFor(p) {
      if (!this.refill()) return null;
      const c = this.stock.pop();
      c.up = p === 0;
      this.hands[p].push(c);
      if (p === 0) OC.sortHand(this.hands[0], false);
      return c;
    }

    /* ----- human ----- */
    humanTurn() {
      if (this.over) return;
      this.turn = 0;
      this.busy = false;
      this.status();
      const can = this.hands[0].some((c) => this.legal(c));
      if (can) {
        this.ctx.actions([{ html: this.drewThisTurn ? 'You can play now — tap a highlighted card' : 'Your turn — tap a card to play it' }]);
      } else if (this.stock.length || this.discard.length > 1) {
        this.ctx.actions([{ html: 'No playable card — tap the stock to draw' }, { label: 'Draw', primary: true, onClick: () => this.humanDraw() }]);
      } else {
        this.ctx.actions([{ html: 'No playable card and no cards left to draw' }, { label: 'Pass', primary: true, onClick: () => this.endTurn(true) }]);
      }
      this.render();
    }
    humanDraw() {
      if (this.turn !== 0 || this.busy || this.over) return;
      if (this.hands[0].some((c) => this.legal(c))) {
        this.ctx.toast('You have a card you can play');
        return;
      }
      const c = this.drawFor(0);
      if (!c) return this.humanTurn();
      this.started = true;
      this.drewThisTurn++;
      this.humanTurn();
    }
    async tap(p, i) {
      if (this.over || this.busy || this.turn !== 0) return;
      if (p === 'stock') return this.humanDraw();
      if (p !== 'h') return;
      const c = this.hands[0][i];
      if (!c) return;
      if (!this.legal(c)) {
        this.T.shake(c);
        this.ctx.toast(`Play a ${OC.SUITS[this.suit].sym}, a ${OC.RANKS[this.top().r]}, or an 8`);
        return;
      }
      this.busy = true;
      this.started = true;
      this.ctx.actions([]);
      this.hands[0].splice(i, 1);
      this.discard.push(c);
      this.suit = c.s;
      this.render();
      if (c.r === 8 && this.hands[0].length) {
        await this.ctx.wait(250);
        this.suit = await OC.ui.pickSuit('You played an 8 — choose the new suit');
        this.said[0] = 'Chose ' + OC.SUITS[this.suit].sym;
      }
      this.endTurn(false);
    }

    /* ----- turn flow ----- */
    async endTurn(passed) {
      this.passes = passed ? this.passes + 1 : 0;
      this.drewThisTurn = 0;
      this.render();
      const p = this.turn;
      if (!this.hands[p].length) return this.gameOver(p);
      if (this.passes >= this.n) return this.gameOver(-1);
      this.turn = (p + 1) % this.n;
      this.status();
      if (this.turn === 0) return this.humanTurn();
      this.busy = true;
      this.ctx.actions([{ html: `${this.names[this.turn]} is thinking…` }]);
      this.render();
      await this.ctx.wait(750);
      this.aiTurn(this.turn);
    }
    async aiTurn(p) {
      const hand = this.hands[p];
      let drew = 0;
      let choice = this.aiChoose(hand);
      while (!choice) {
        const c = this.drawFor(p);
        if (!c) break;
        drew++;
        this.said[p] = 'Drew ' + drew;
        this.render();
        await this.ctx.wait(330);
        choice = this.aiChoose(hand);
      }
      if (!choice) {
        this.said[p] = 'Passed';
        return this.endTurn(true);
      }
      hand.splice(hand.indexOf(choice), 1);
      choice.up = true;
      this.discard.push(choice);
      this.suit = choice.s;
      this.said[p] = drew ? `Drew ${drew}, played` : 'Played';
      if (choice.r === 8 && hand.length) {
        const counts = [0, 0, 0, 0];
        hand.forEach((c) => c.r !== 8 && counts[c.s]++);
        this.suit = counts.indexOf(Math.max(...counts));
        this.said[p] = (drew ? `Drew ${drew}, ` : '') + 'Eight! Suit is now ' + OC.SUITS[this.suit].sym;
        this.ctx.toast(`${this.names[p]} played an 8 and chose ${OC.SUITS[this.suit].name}`);
      }
      this.render();
      await this.ctx.wait(450);
      this.endTurn(false);
    }
    aiChoose(hand) {
      const legal = hand.filter((c) => this.legal(c));
      if (!legal.length) return null;
      const nonEight = legal.filter((c) => c.r !== 8);
      if (nonEight.length) {
        // play from the suit we hold most of, high cards first
        const counts = [0, 0, 0, 0];
        hand.forEach((c) => counts[c.s]++);
        nonEight.sort((a, b) => counts[b.s] - counts[a.s] || b.r - a.r);
        return nonEight[0];
      }
      return legal[0];
    }
    async gameOver(winner) {
      this.over = true;
      this.turn = -1;
      this.ctx.actions([]);
      this.hands.forEach((h) => h.forEach((c) => (c.up = true)));
      this.render();
      await this.ctx.wait(900);
      let w = winner;
      if (w < 0) {
        const sizes = this.hands.map((h) => h.length);
        w = sizes.indexOf(Math.min(...sizes));
      }
      const pts = this.hands.map((h) => h.reduce((a, c) => a + (c.r === 8 ? 50 : c.r > 10 ? 10 : c.r), 0));
      const rows = this.names.map((n, k) => `<tr class="${k === 0 ? 'me' : ''}"><td>${n}</td><td>${this.hands[k].length}</td><td>${pts[k]}</td></tr>`).join('');
      this.ctx.finish({
        won: w === 0,
        title: w === 0 ? 'You won!' : `${this.names[w]} wins`,
        html: `${winner < 0 ? '<p>Nobody could play, so the fewest cards wins.</p>' : ''}<table class="score-table"><tr><th>Player</th><th>Cards left</th><th>Penalty points</th></tr>${rows}</table>`,
      });
    }

    render() {
      const T = this.T;
      const { w, h } = T.size();
      const cw = Math.min(w / 10, (h - 30) / (1.4 * 3.5), 110);
      T.setCardWidth(cw);
      T.spawn = { x: w / 2 - T.cw * 1.25, y: h * 0.42 - T.ch / 2 };
      T.begin();
      // center
      const cx = w / 2, cy = h * 0.42 - T.ch / 2;
      T.slot('stock', cx - T.cw * 1.25, cy, { pile: 'stock', label: '↻', cls: 'clickable' });
      this.stock.forEach((c, i) => T.card(c, cx - T.cw * 1.25 - Math.min(i, 10) * 0.6, cy - Math.min(i, 10) * 0.6, { z: i + 1, pile: 'stock', idx: i }));
      const dl = this.discard.length;
      this.discard.forEach((c, i) => {
        if (i < dl - 6) return T.card(c, cx + T.cw * 0.25, cy, { z: i + 1, pile: '' });
        const jitter = ((c.id * 37) % 9) - 4;
        T.card(c, cx + T.cw * 0.25 + jitter, cy + (((c.id * 53) % 7) - 3), { z: i + 1, pile: '' });
      });
      const s = OC.SUITS[this.suit];
      T.label('suit', cx + T.cw * 1.35, cy + T.ch / 2 - 18, `<span class="badge" style="font-size:22px;color:${s.red ? '#ff8a80' : '#fff'}">${s.sym}</span>`);
      T.label('stockn', cx - T.cw * 1.25, cy + T.ch + 6, `<span class="badge">${this.stock.length}</span>`, { w: T.cw, align: 'center' });
      // opponents
      const seats = OC.oppSeats(this.n - 1, w, h - T.ch - 60, T.cw, T.ch, this.hands.slice(1).map((x) => x.length));
      seats.forEach((st, k) => {
        const p = k + 1;
        this.hands[p].forEach((c, i) => T.card(c, st.x + (st.vertical ? 0 : i * st.step), st.y + (st.vertical ? i * st.step : 0), { z: i + 1, pile: '' }));
        const cls = this.turn === p ? 'turn' : '';
        T.label('n' + p, st.lx, st.ly, `<span class="badge">${this.names[p]} · ${this.hands[p].length}</span>${this.said[p] ? `<br><span class="badge">${OC.esc(this.said[p])}</span>` : ''}`, { cls, w: 220, align: st.la });
      });
      // my hand
      const hand = this.hands[0];
      const step = OC.fanStep(hand.length, T.cw, w - 40, T.cw * 0.75);
      const hw = T.cw + step * Math.max(0, hand.length - 1);
      const hx = (w - hw) / 2, hy = h - T.ch - 14;
      const myTurn = this.turn === 0 && !this.busy && !this.over;
      hand.forEach((c, i) => {
        const ok = this.legal(c);
        T.card(c, hx + i * step, hy - (myTurn && ok ? 14 : 0), { z: i + 1, pile: 'h', idx: i, cls: myTurn ? (ok ? 'glow' : 'dim') : '' });
      });
      T.label('me', 0, hy - 40, `<span class="badge">You · ${hand.length} card${hand.length === 1 ? '' : 's'}</span>`, { w, align: 'center', cls: this.turn === 0 ? 'turn' : '' });
      T.end();
    }
  }

  OC.registerGame({
    id: 'crazyeights',
    name: 'Crazy Eights',
    category: 'Versus Computer',
    players: 'You + 1–3 computer players',
    blurb: 'Match the suit or rank and be first to empty your hand. Eights are wild!',
    preview: '8S 8H 8D',
    options: [{ key: 'opponents', label: 'Opponents', def: 2, choices: [[1, '1'], [2, '2'], [3, '3']] }],
    create: (ctx) => new CrazyEights(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Be the first player to get rid of <b>all your cards</b>.</p>
          <p>Each player gets 7 cards (5 cards with 3 or more players). One card is turned face up to start the discard pile.</p>`,
      },
      {
        title: 'Playing a card',
        body: `<p>On your turn, play one card onto the discard pile that matches the top card's <b>suit</b> or <b>rank</b>:</p>
          <div class="example">${m('9H')} <span class="arrow">→ you can play</span> ${m('3H 9C')}</div>
          <p>Your playable cards are raised and highlighted.</p>`,
      },
      {
        title: 'Eights are wild',
        body: `<p>An <b>8</b> can be played on anything. When you play one, you choose the suit the next player must follow.</p>
          <div class="example">${m('KD')} <span class="arrow">→</span> ${m('8S')} <span class="arrow">→ “Clubs!”</span></div>
          <p>The current suit is always shown next to the discard pile and at the top of the screen.</p>`,
      },
      {
        title: 'Can’t play?',
        body: `<p>If you have no playable card, tap the <b>stock</b> (or the Draw button) to draw one card at a time until you can play.</p>
          <p>If the stock runs out, the discard pile is reshuffled. If there's nothing left to draw, you pass.</p>`,
      },
      {
        title: 'Tips',
        body: `<ul><li>Save your 8s for when you're stuck — they're your get-out-of-jail cards.</li>
          <li>When you play an 8, pick the suit you hold the most of.</li>
          <li>Watch how many cards opponents have left and try to change the suit when they're close to winning.</li></ul>`,
      },
    ],
  });
})();
