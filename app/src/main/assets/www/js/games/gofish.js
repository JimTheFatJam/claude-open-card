/* Go Fish */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const AI_NAMES = ['Ava', 'Ben', 'Cleo'];

  class GoFish {
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
      this.n = nOpp + 1;
      this.names = ['You'].concat(AI_NAMES.slice(0, nOpp));
      const deck = OC.shuffle(OC.makeDeck());
      this.hands = Array.from({ length: this.n }, () => []);
      const size = this.n === 2 ? 7 : 5;
      for (let k = 0; k < size; k++) for (let p = 0; p < this.n; p++) {
        const c = deck.pop();
        c.up = p === 0;
        this.hands[p].push(c);
      }
      this.stock = deck;
      this.books = Array.from({ length: this.n }, () => []);
      this.known = Array.from({ length: this.n }, () => new Set()); // ranks each player is known to hold
      this.said = [];
      this.log = [];
      this.sel = 0;
      this.turn = 0;
      this.over = false;
      this.started = false;
      this.busy = false;
      this.sortMine();
      this.ctx.buttons([]);
      for (let p = 0; p < this.n; p++) this.checkBooks(p, true);
      this.render();
      this.beginTurn();
    }
    sortMine() {
      this.hands[0].sort((a, b) => a.r - b.r || a.s - b.s);
    }
    say(text) {
      this.log.push(text);
      if (this.log.length > 3) this.log.shift();
    }
    status() {
      this.ctx.status(`Books: ${this.names.map((n, k) => `${n} <b>${this.books[k].length}</b>`).join(' · ')} &nbsp;·&nbsp; Pond <b>${this.stock.length}</b>`);
    }
    checkBooks(p, silent) {
      const counts = {};
      for (const c of this.hands[p]) counts[c.r] = (counts[c.r] || 0) + 1;
      for (const r in counts) {
        if (counts[r] === 4) {
          const set = this.hands[p].filter((c) => c.r === +r);
          this.hands[p] = this.hands[p].filter((c) => c.r !== +r);
          set.forEach((c) => (c.up = true));
          this.books[p].push(set);
          this.known.forEach((k) => k.delete(+r));
          this.known[p].delete(+r);
          if (!silent) {
            this.say(`${this.names[p]} completed a book of ${OC.RANK_PLURAL[+r]}!`);
            this.ctx.toast(`${p === 0 ? 'You' : this.names[p]} made a book of ${OC.RANK_PLURAL[+r]}`);
          }
        }
      }
    }
    totalBooks() {
      return this.books.reduce((a, b) => a + b.length, 0);
    }
    draw(p) {
      if (!this.stock.length) return null;
      const c = this.stock.pop();
      c.up = p === 0;
      this.hands[p].push(c);
      if (p === 0) this.sortMine();
      return c;
    }

    async beginTurn() {
      if (this.over) return;
      if (this.totalBooks() === 13) return this.gameOver();
      const p = this.turn;
      if (!this.hands[p].length) {
        if (this.stock.length) {
          this.draw(p);
          this.say(`${this.names[p]} had no cards and drew one.`);
          this.render();
        } else {
          return this.nextPlayer();
        }
      }
      this.status();
      this.render();
      if (p === 0) return this.humanUI();
      this.busy = true;
      this.ctx.actions([{ html: `${this.names[p]} is thinking…` }]);
      await this.ctx.wait(900);
      this.aiTurn(p);
    }
    nextPlayer() {
      if (this.totalBooks() === 13) return this.gameOver();
      for (let k = 1; k <= this.n; k++) {
        const q = (this.turn + k) % this.n;
        if (this.hands[q].length || this.stock.length) {
          this.turn = q;
          return this.beginTurn();
        }
      }
      return this.gameOver();
    }

    /* ----- human ----- */
    humanUI() {
      this.busy = false;
      const hand = this.hands[0];
      if (!hand.some((c) => c.r === this.sel)) this.sel = 0;
      const targets = [];
      for (let q = 1; q < this.n; q++) if (this.hands[q].length) targets.push(q);
      if (!this.sel) {
        this.ctx.actions([{ html: 'Your turn: tap a card to choose which rank to ask for' }]);
      } else {
        const rank = OC.RANK_PLURAL[this.sel];
        this.ctx.actions(targets.map((q) => ({ label: `Ask ${this.names[q]} for ${rank}`, primary: targets.length === 1, onClick: () => this.ask(0, q, this.sel) })));
      }
      this.render();
    }
    tap(p, i) {
      if (this.over || this.busy || this.turn !== 0) return;
      if (p === 'h') {
        this.sel = this.hands[0][i].r;
        this.humanUI();
      } else if (p && p.startsWith('opp') && this.sel) {
        const q = +p.slice(3);
        if (this.hands[q].length) this.ask(0, q, this.sel);
      }
    }

    /* ----- asking ----- */
    async ask(p, q, rank) {
      if (this.over) return;
      this.busy = true;
      this.started = true;
      this.ctx.actions([]);
      const who = (x) => (x === 0 ? 'You' : this.names[x]);
      const rk = OC.RANK_PLURAL[rank];
      this.said = [];
      this.said[p] = `${this.names[q]}, any ${rk}?`;
      this.known[p].add(rank);
      this.render();
      await this.ctx.wait(900);
      const give = this.hands[q].filter((c) => c.r === rank);
      if (give.length) {
        this.hands[q] = this.hands[q].filter((c) => c.r !== rank);
        this.known[q].delete(rank);
        give.forEach((c) => {
          c.up = p === 0;
          this.hands[p].push(c);
        });
        if (p === 0) this.sortMine();
        this.said[q] = `Here${give.length > 1 ? ' are ' + give.length : ''}…`;
        this.say(`${who(q)} gave ${give.length} ${give.length > 1 ? rk : OC.RANK_NAMES[rank]} to ${p === 0 ? 'you' : this.names[p]}.`);
        this.render();
        await this.ctx.wait(700);
        this.checkBooks(p);
        this.render();
        return this.afterAsk(p, true);
      }
      this.said[q] = 'Go fish!';
      this.render();
      await this.ctx.wait(700);
      const c = this.draw(p);
      if (!c) {
        this.say(`${who(p)} couldn't fish — the pond is empty.`);
        return this.afterAsk(p, false);
      }
      const lucky = c.r === rank;
      this.say(lucky ? `${who(p)} fished the ${OC.RANK_NAMES[rank]} ${p === 0 ? 'you' : 'they'} asked for!` : `${who(p)} went fishing.`);
      if (p === 0) this.ctx.toast(`You drew the ${OC.cardName(c)}${lucky ? ' — lucky! Go again.' : ''}`);
      if (lucky) {
        c.up = true;
        this.render();
        await this.ctx.wait(600);
        if (p !== 0) c.up = false;
      }
      this.render();
      await this.ctx.wait(450);
      this.checkBooks(p);
      this.render();
      this.afterAsk(p, lucky);
    }
    afterAsk(p, again) {
      this.status();
      if (this.totalBooks() === 13) return this.gameOver();
      if (again && (this.hands[p].length || this.stock.length)) return this.beginTurn();
      this.turn = p;
      this.nextPlayer();
    }

    /* ----- computer ----- */
    aiTurn(p) {
      const hand = this.hands[p];
      const ranks = [...new Set(hand.map((c) => c.r))];
      const targets = [];
      for (let q = 0; q < this.n; q++) if (q !== p && this.hands[q].length) targets.push(q);
      if (!targets.length) return this.afterAsk(p, false);
      // 1. ask for a rank we know someone has
      for (const r of OC.shuffle(ranks.slice())) {
        const q = targets.find((t) => this.known[t].has(r));
        if (q !== undefined) return this.ask(p, q, r);
      }
      // 2. otherwise the rank we hold most of
      const counts = {};
      hand.forEach((c) => (counts[c.r] = (counts[c.r] || 0) + 1));
      ranks.sort((a, b) => counts[b] - counts[a] || Math.random() - 0.5);
      const q = targets[OC.rand(targets.length)];
      this.ask(p, q, ranks[0]);
    }

    async gameOver() {
      if (this.over) return;
      this.over = true;
      this.turn = -1;
      this.ctx.actions([]);
      this.render();
      await this.ctx.wait(700);
      const counts = this.books.map((b) => b.length);
      const best = Math.max(...counts);
      const won = counts[0] === best;
      const tie = counts.filter((c) => c === best).length > 1;
      const rows = this.names.map((n, k) => `<tr class="${k === 0 ? 'me' : ''}"><td>${n}</td><td>${counts[k]}</td><td>${this.books[k].map((b) => OC.RANKS[b[0].r]).join(' ')}</td></tr>`).join('');
      this.ctx.finish({
        won,
        title: won ? (tie ? 'It’s a tie for first!' : 'You won!') : `${this.names[counts.indexOf(best)]} wins`,
        html: `<table class="score-table"><tr><th>Player</th><th>Books</th><th>Ranks</th></tr>${rows}</table>`,
      });
    }

    render() {
      const T = this.T;
      const { w, h } = T.size();
      const cw = Math.min(w / 11, (h - 30) / (1.4 * 3.6), 105);
      T.setCardWidth(cw);
      const cx = w / 2, cy = h * 0.4 - T.ch / 2;
      T.spawn = { x: cx - T.cw / 2, y: cy };
      T.begin();
      // pond (scattered stock)
      this.stock.forEach((c, i) => {
        const a = (c.id * 47) % 360, rad = ((c.id * 29) % 30) / 30;
        T.card(c, cx - T.cw / 2 + Math.cos(a) * rad * T.cw * 0.6, cy + Math.sin(a) * rad * T.ch * 0.25, { z: i + 1, pile: '' });
      });
      T.label('pond', 0, cy + T.ch + T.ch * 0.25 + 4, `<span class="badge">Pond: ${this.stock.length}</span>`, { w, align: 'center' });
      this.log.forEach((l, k) => T.label('log' + k, 0, cy - 30 - (this.log.length - 1 - k) * 22, `<span class="log-line">${OC.esc(l)}</span>`, { w, align: 'center', z: 950 }));
      for (let k = this.log.length; k < 3; k++) T.label('log' + k, 0, -100, '');
      // opponents
      const seats = OC.oppSeats(this.n - 1, w, h - T.ch - 70, T.cw, T.ch, this.hands.slice(1).map((x) => x.length));
      seats.forEach((st, k) => {
        const p = k + 1;
        this.hands[p].forEach((c, i) => T.card(c, st.x + (st.vertical ? 0 : i * st.step), st.y + (st.vertical ? i * st.step : 0), { z: i + 1, pile: 'opp' + p, idx: i }));
        const cls = this.turn === p ? 'turn' : '';
        const bubble = this.said[p] ? `<br><span class="badge" style="background:#fff;color:#222;text-shadow:none">${OC.esc(this.said[p])}</span>` : '';
        T.label('n' + p, st.lx, st.ly, `<span class="badge">${this.names[p]} · ${this.hands[p].length} cards · ${this.books[p].length} books</span>${bubble}`, { cls, w: 220, align: st.la, pile: 'opp' + p });
      });
      // my books (bottom-left) and hand
      const hand = this.hands[0];
      const step = OC.fanStep(hand.length, T.cw, w - 40, T.cw * 0.62);
      const hw = T.cw + step * Math.max(0, hand.length - 1);
      const hx = (w - hw) / 2, hy = h - T.ch - 14;
      const myTurn = this.turn === 0 && !this.busy && !this.over;
      hand.forEach((c, i) => {
        const sel = this.sel && c.r === this.sel;
        T.card(c, hx + i * step, hy - (sel ? 16 : 0), { z: i + 1, pile: 'h', idx: i, cls: sel ? 'sel' : '' });
      });
      // books shown as small stacks
      this.books.forEach((bs, p) => bs.forEach((b, j) => b.forEach((c, k) => {
        if (p !== 0) return;
        const bx = 10 + j * T.cw * 0.32;
        const by = hy - T.ch * 0.55;
        T.card(c, bx + k * 1.5, by - k * 1.5, { z: 600 + j * 4 + k, up: true, pile: '' });
      })));
      const bubble = this.said[0] ? ` <span class="badge" style="background:#fff;color:#222;text-shadow:none">${OC.esc(this.said[0])}</span>` : '';
      T.label('me', 0, hy - 44, `<span class="badge">You · ${this.books[0].length} books</span>${bubble}`, { w, align: 'center', cls: this.turn === 0 && !this.over ? 'turn' : '' });
      void myTurn;
      T.end();
    }
  }

  OC.registerGame({
    id: 'gofish',
    name: 'Go Fish',
    category: 'Versus Computer',
    players: 'You + 1–3 computer players',
    blurb: 'Ask for cards, collect sets of four, and watch out for the pond.',
    preview: '7C 7H 7S',
    options: [{ key: 'opponents', label: 'Opponents', def: 2, choices: [[1, '1'], [2, '2'], [3, '3']] }],
    create: (ctx) => new GoFish(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Collect the most <b>books</b>. A book is all four cards of one rank:</p>
          <div class="example">${m('QC QD QH QS')}</div>
          <p>Each player starts with 7 cards (5 with 3 or more players). The rest are spread out face down as the <b>pond</b>.</p>`,
      },
      {
        title: 'Asking for cards',
        body: `<p>On your turn, <b>tap a card</b> in your hand to choose its rank, then tap <b>Ask …</b> to ask an opponent for that rank.</p>
          <p>You may only ask for a rank you already hold at least one of.</p>
          <div class="example">${m('7H')} <span class="arrow">→ “Ben, any Sevens?”</span></div>`,
      },
      {
        title: 'Go fish!',
        body: `<ul><li>If they have any, they must give you <b>all</b> of them — and you get <b>another turn</b>.</li>
          <li>If not, they say <b>“Go fish!”</b> and you draw a card from the pond.</li>
          <li>If you fish the exact rank you asked for, you go again! Otherwise, the turn passes.</li></ul>`,
      },
      {
        title: 'Books and the end',
        body: `<p>As soon as you hold all four cards of a rank, they're laid down as a book automatically.</p>
          <p>If you run out of cards, you draw one from the pond on your turn. The game ends when all 13 books have been made. Most books wins!</p>
          <p class="tip">Remember what the other players ask for — if Ava asked for Kings, she has at least one King. The computer players remember too!</p>`,
      },
    ],
  });
})();
