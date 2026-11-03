/* Hearts — you vs three computer players */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const NAMES = ['You', 'Ava', 'Ben', 'Cleo'];
  const HEARTS = 1, SPADES = 0, CLUBS = 3;
  const hv = (c) => (c.r === 1 ? 14 : c.r); // ace high
  const isQS = (c) => c.s === SPADES && c.r === 12;
  const points = (c) => (c.s === HEARTS ? 1 : isQS(c) ? 13 : 0);
  const PASS_DIR = [1, 3, 2, 0]; // left, right, across, hold
  const PASS_NAME = ['to the left', 'to the right', 'across', ''];

  class Hearts {
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
    progressText() {
      return `round ${this.round} \u00b7 your score ${this.scores[0]}`;
    }
    start() {
      this.T.clear();
      this.scores = [0, 0, 0, 0];
      this.round = 0;
      this.over = false;
      this.started = false;
      this.target = this.ctx.opts.target;
      this.ctx.buttons([{ label: 'Scores', onClick: () => this.showScores(false) }]);
      this.history = [];
      this.newRound();
    }
    status() {
      this.ctx.status(`Round <b>${this.round}</b> &nbsp;·&nbsp; ${NAMES.map((n, k) => `${n} <b>${this.scores[k]}</b>`).join(' · ')} &nbsp;·&nbsp; to ${this.target}`);
    }
    newRound() {
      this.round++;
      const deck = OC.shuffle(OC.makeDeck());
      this.hands = [[], [], [], []];
      deck.forEach((c, i) => {
        c.up = i % 4 === 0;
        this.hands[i % 4].push(c);
      });
      this.hands.forEach((h) => OC.sortHand(h));
      this.taken = [0, 0, 0, 0];
      this.trick = [];
      this.broken = false;
      this.trickNo = 0;
      this.sel = new Set();
      this.received = new Set();
      this.turn = -1;
      this.lastWinner = -1;
      this.passDir = PASS_DIR[(this.round - 1) % 4];
      this.status();
      this.render();
      if (this.passDir) this.passPhase();
      else this.playPhase();
    }

    /* ----- passing ----- */
    passPhase() {
      this.phase = 'pass';
      this.passUI();
      this.render();
    }
    passUI() {
      const n = this.sel.size;
      this.ctx.actions([
        { html: `Choose 3 cards to pass <b>${PASS_NAME[(this.round - 1) % 4]}</b> to ${NAMES[this.passDir]}` },
        { label: n === 3 ? 'Pass cards' : `Selected ${n}/3`, primary: true, disabled: n !== 3, onClick: () => this.doPass() },
      ]);
    }
    aiPassPick(hand) {
      const spades = hand.filter((c) => c.s === SPADES).length;
      const score = (c) => {
        if (isQS(c)) return spades >= 5 ? 20 : 100;
        if (c.s === SPADES && hv(c) > 12) return spades >= 5 ? 15 : 90;
        if (c.s === HEARTS) return 30 + hv(c) * 2;
        const suitLen = hand.filter((x) => x.s === c.s).length;
        return hv(c) * 2 + (suitLen <= 2 ? 12 : 0);
      };
      return hand.slice().sort((a, b) => score(b) - score(a)).slice(0, 3);
    }
    async doPass() {
      if (this.sel.size !== 3) return;
      this.ctx.actions([]);
      this.started = true;
      const give = [];
      give[0] = this.hands[0].filter((c) => this.sel.has(c.id));
      for (let p = 1; p < 4; p++) give[p] = this.aiPassPick(this.hands[p]);
      for (let p = 0; p < 4; p++) this.hands[p] = this.hands[p].filter((c) => !give[p].includes(c));
      this.received = new Set();
      for (let p = 0; p < 4; p++) {
        const to = (p + this.passDir) % 4;
        give[p].forEach((c) => {
          c.up = to === 0;
          this.hands[to].push(c);
          if (to === 0) this.received.add(c.id);
        });
      }
      this.hands.forEach((h) => OC.sortHand(h));
      this.sel.clear();
      this.render();
      this.ctx.toast('You received the highlighted cards');
      await this.ctx.wait(1400);
      this.received.clear();
      this.playPhase();
    }

    /* ----- play ----- */
    playPhase() {
      this.phase = 'play';
      const lead = this.hands.findIndex((h) => h.some((c) => c.s === CLUBS && c.r === 2));
      this.turn = lead;
      this.render();
      this.nextTurn();
    }
    legal(p, c) {
      const hand = this.hands[p];
      if (!this.trick.length) {
        if (this.trickNo === 0) return c.s === CLUBS && c.r === 2;
        if (c.s === HEARTS && !this.broken) return hand.every((x) => x.s === HEARTS);
        return true;
      }
      const led = this.trick[0].card.s;
      if (hand.some((x) => x.s === led)) return c.s === led;
      if (this.trickNo === 0 && points(c) > 0) return hand.every((x) => points(x) > 0);
      return true;
    }
    winnerOf(trick) {
      const led = trick[0].card.s;
      let best = trick[0];
      for (const t of trick) if (t.card.s === led && hv(t.card) > hv(best.card)) best = t;
      return best.p;
    }
    async nextTurn() {
      if (this.over || !this.ctx.alive()) return;
      this.render();
      if (this.turn === 0) {
        this.ctx.actions([{ html: this.trick.length ? 'Your turn — follow suit if you can' : this.trickNo === 0 ? 'You lead the 2♣' : 'Your lead — tap a card' }]);
        return;
      }
      this.ctx.actions([{ html: `${NAMES[this.turn]} is playing…` }]);
      await this.ctx.wait(650);
      const c = this.aiPick(this.turn);
      this.play(this.turn, c);
    }
    tap(p, i) {
      if (this.over) return;
      if (p !== 'h') return;
      const c = this.hands[0][i];
      if (!c) return;
      if (this.phase === 'pass') {
        if (this.sel.has(c.id)) this.sel.delete(c.id);
        else if (this.sel.size < 3) this.sel.add(c.id);
        else this.ctx.toast('You can only pass 3 cards');
        this.passUI();
        this.render();
        return;
      }
      if (this.phase !== 'play' || this.turn !== 0 || this.trick.length >= 4) return;
      if (!this.legal(0, c)) {
        this.T.shake(c);
        this.ctx.toast(this.whyIllegal(c));
        return;
      }
      this.play(0, c);
    }
    whyIllegal(c) {
      if (!this.trick.length) {
        if (this.trickNo === 0) return 'The first trick must be led with the 2 of Clubs';
        return 'Hearts haven’t been broken yet — lead another suit';
      }
      const led = this.trick[0].card.s;
      if (this.hands[0].some((x) => x.s === led)) return `You must follow suit: play a ${OC.SUITS[led].name.slice(0, -1).toLowerCase()}`;
      return 'No points may be played on the first trick';
    }
    async play(p, c) {
      const hand = this.hands[p];
      hand.splice(hand.indexOf(c), 1);
      c.up = true;
      this.trick.push({ p, card: c });
      if (c.s === HEARTS && !this.broken) {
        this.broken = true;
        if (this.trickNo > 0 || this.trick.length > 1) this.ctx.toast('Hearts are broken!');
      }
      this.turn = this.trick.length < 4 ? (p + 1) % 4 : -1;
      this.render();
      if (this.trick.length < 4) return this.nextTurn();
      this.ctx.actions([]);
      await this.ctx.wait(1000);
      const w = this.winnerOf(this.trick);
      const pts = this.trick.reduce((a, t) => a + points(t.card), 0);
      this.taken[w] += pts;
      this.lastWinner = w;
      this.collecting = w;
      this.render();
      await this.ctx.wait(450);
      this.collecting = -1;
      this.trick = [];
      this.trickNo++;
      if (this.trickNo === 13) return this.endRound();
      this.turn = w;
      this.nextTurn();
    }

    /* ----- AI ----- */
    aiPick(p) {
      const hand = this.hands[p];
      const legal = hand.filter((c) => this.legal(p, c));
      if (legal.length === 1) return legal[0];
      const byLow = legal.slice().sort((a, b) => hv(a) - hv(b));
      const byHigh = byLow.slice().reverse();
      const qsOut = !this.hands[p].some(isQS) && this.trick.every((t) => !isQS(t.card));
      if (!this.trick.length) {
        // lead: avoid leading high spades / hearts, prefer short suits low cards
        const holdsQS = hand.some(isQS);
        const scored = legal.map((c) => {
          let s = hv(c);
          if (c.s === HEARTS) s += 8;
          if (c.s === SPADES && (hv(c) >= 12 || holdsQS)) s += 20;
          if (c.s === SPADES && hv(c) < 12 && !holdsQS) s -= 3; // flush out the queen
          s += hand.filter((x) => x.s === c.s).length * 0.5;
          return [s, c];
        });
        scored.sort((a, b) => a[0] - b[0]);
        return scored[0][1];
      }
      const led = this.trick[0].card.s;
      const following = legal[0].s === led;
      const winning = this.trick.reduce((b, t) => (t.card.s === led && hv(t.card) > hv(b.card) ? t : b), this.trick[0]).card;
      const trickPts = this.trick.reduce((a, t) => a + points(t.card), 0);
      const last = this.trick.length === 3;
      if (following) {
        const under = byHigh.filter((c) => hv(c) < hv(winning));
        if (led === SPADES) {
          const qs = legal.find(isQS);
          if (qs && hv(winning) > 12) return qs; // dump the queen under K/A
          const safe = under.filter((c) => !isQS(c));
          if (safe.length) return safe[0];
        }
        if (last && trickPts === 0 && !(this.trickNo === 0)) {
          const noQ = byHigh.filter((c) => !isQS(c));
          if (noQ.length) return noQ[0];
        }
        if (under.length) return under[0];
        if (this.trickNo === 0) return byHigh[0];
        // must win: if last play highest, otherwise lowest
        const noQ = (last ? byHigh : byLow).filter((c) => !isQS(c));
        return noQ.length ? noQ[0] : byLow[0];
      }
      // void: dump dangerous cards
      const qs = legal.find(isQS);
      if (qs) return qs;
      const bigSpade = byHigh.find((c) => c.s === SPADES && hv(c) > 12 && !qsOut);
      if (bigSpade) return bigSpade;
      const hearts = byHigh.filter((c) => c.s === HEARTS);
      if (hearts.length) return hearts[0];
      return byHigh[0];
    }

    /* ----- scoring ----- */
    async endRound() {
      const shooter = this.taken.findIndex((t) => t === 26);
      let add = this.taken.slice();
      if (shooter >= 0) {
        add = [26, 26, 26, 26];
        add[shooter] = 0;
        this.ctx.toast(`${shooter === 0 ? 'You' : NAMES[shooter]} shot the moon!`, 2600);
      }
      for (let p = 0; p < 4; p++) this.scores[p] += add[p];
      this.history.push(add);
      this.status();
      this.render();
      await this.ctx.wait(600);
      const done = this.scores.some((s) => s >= this.target);
      if (done) {
        this.over = true;
        const low = Math.min(...this.scores);
        const won = this.scores[0] === low;
        return this.ctx.finish({
          won,
          title: won ? 'You won!' : `${NAMES[this.scores.indexOf(low)]} wins`,
          html: this.scoreTable() + '<p class="note">Lowest score wins.</p>',
        });
      }
      const v = await this.showScores(true, shooter);
      if (v !== undefined && this.ctx.alive()) this.newRound();
    }
    scoreTable() {
      const head = `<tr><th>Round</th>${NAMES.map((n) => `<th>${n}</th>`).join('')}</tr>`;
      const rows = this.history.map((r, k) => `<tr><td>${k + 1}</td>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('');
      const tot = `<tr class="me"><td>Total</td>${this.scores.map((x) => `<td>${x}</td>`).join('')}</tr>`;
      return `<table class="score-table">${head}${rows}${tot}</table>`;
    }
    showScores(betweenRounds, shooter = -1) {
      return this.ctx.dialog({
        title: betweenRounds ? `End of round ${this.round}` : 'Scores',
        html: (shooter >= 0 ? `<p><b>${shooter === 0 ? 'You' : NAMES[shooter]} shot the moon!</b> Everyone else gets 26.</p>` : '') + this.scoreTable() + `<p class="note">The game ends when someone reaches ${this.target}. Lowest score wins.</p>`,
        buttons: [{ label: betweenRounds ? 'Next round' : 'Close', value: true, primary: true }],
        dismissible: !betweenRounds,
      });
    }

    render() {
      const T = this.T;
      const { w, h } = T.size();
      const cw = Math.min(w / 12, (h - 20) / (1.4 * 3.6), 100);
      T.setCardWidth(cw);
      const cx = w / 2, cy = h * 0.43;
      T.spawn = { x: cx - T.cw / 2, y: cy - T.ch / 2 };
      T.begin();
      // opponents: 1 left, 2 top, 3 right
      const seats = OC.oppSeats(3, w, h - T.ch - 60, T.cw, T.ch, [this.hands[1].length, this.hands[2].length, this.hands[3].length]);
      const anchor = [{ x: cx - T.cw / 2, y: h }, null, null, null];
      seats.forEach((st, k) => {
        const p = k + 1;
        this.hands[p].forEach((c, i) => T.card(c, st.x + (st.vertical ? 0 : i * st.step), st.y + (st.vertical ? i * st.step : 0), { z: i + 1, pile: '' }));
        T.label('n' + p, st.lx, st.ly, `<span class="badge">${NAMES[p]} · ${this.scores[p]}</span> <span class="badge ${this.taken[p] ? 'red' : ''}">♥ ${this.taken[p]}</span>`, { cls: this.turn === p ? 'turn' : '', w: 220, align: st.la });
        anchor[p] = { x: st.x, y: st.y };
      });
      // trick in the middle
      const off = [[0, T.ch * 0.42], [-T.cw * 0.95, 0], [0, -T.ch * 0.42], [T.cw * 0.95, 0]];
      this.trick.forEach((t, k) => {
        let x = cx - T.cw / 2 + off[t.p][0], y = cy - T.ch / 2 + off[t.p][1];
        if (this.collecting >= 0) {
          const a = this.collecting === 0 ? { x: cx - T.cw / 2, y: h + 10 } : anchor[this.collecting];
          x = a.x;
          y = a.y;
        }
        T.card(t.card, x, y, { z: 300 + k, pile: '' });
      });
      // my hand
      const hand = this.hands[0];
      const step = OC.fanStep(hand.length, T.cw, w - 30, T.cw * 0.62);
      const hw = T.cw + step * Math.max(0, hand.length - 1);
      const hx = (w - hw) / 2, hy = h - T.ch - 12;
      const myPlay = this.phase === 'play' && this.turn === 0 && this.trick.length < 4;
      hand.forEach((c, i) => {
        let cls = '';
        let lift = 0;
        if (this.phase === 'pass' && this.sel.has(c.id)) { cls = 'sel'; lift = 18; }
        if (this.received.has(c.id)) { cls = 'glow'; lift = 18; }
        if (myPlay) {
          const ok = this.legal(0, c);
          cls = ok ? '' : 'dim';
          lift = ok ? 10 : 0;
        }
        T.card(c, hx + i * step, hy - lift, { z: i + 1, pile: 'h', idx: i, cls });
      });
      T.label('me', 0, hy - 44, `<span class="badge">You · ${this.scores[0]}</span> <span class="badge ${this.taken[0] ? 'red' : ''}">♥ ${this.taken[0]}</span>${this.broken ? '' : ' <span class="badge">Hearts not broken</span>'}`, { w, align: 'center', cls: this.turn === 0 ? 'turn' : '' });
      T.end();
    }
  }

  OC.registerGame({
    id: 'hearts',
    name: 'Hearts',
    category: 'Versus Computer',
    players: 'You + 3 computer players',
    blurb: 'Dodge the hearts and the Queen of Spades — or shoot the moon.',
    preview: 'QS AH KH',
    options: [{ key: 'target', label: 'Game ends at', def: 100, choices: [[50, '50 points (short)'], [100, '100 points (standard)']] }],
    create: (ctx) => new Hearts(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Hearts is a trick-taking game where you want the <b>lowest score</b>. Avoid winning tricks that contain penalty cards:</p>
          <div class="example">${m('2H 9H AH')} <span class="arrow">= 1 point each</span></div>
          <div class="example">${m('QS')} <span class="arrow">= 13 points!</span></div>
          <p>The game ends when someone reaches 100 points (or 50 in a short game). Whoever has the fewest points wins.</p>`,
      },
      {
        title: 'Passing cards',
        body: `<p>Each round starts by passing <b>3 cards</b>: to the left, then right, then across, then no pass, repeating.</p>
          <p>Tap three cards to select them, then tap <b>Pass cards</b>. Good cards to pass: the Queen, King or Ace of Spades, and high Hearts.</p>`,
      },
      {
        title: 'Playing tricks',
        body: `<ul><li>Whoever has the <b>2♣</b> leads the first trick with it.</li>
          <li>Going clockwise, everyone plays one card. You <b>must follow the suit that was led</b> if you can.</li>
          <li>The <b>highest card of the led suit</b> wins the trick (Aces are high). The winner leads next.</li>
          <li>If you can't follow suit, you may play anything — a great time to dump the Q♠ or Hearts!</li></ul>`,
      },
      {
        title: 'Special rules',
        body: `<ul><li><b>Hearts can't be led</b> until a Heart has been played on an earlier trick (“broken”), unless you only have Hearts.</li>
          <li>No Hearts or Q♠ may be played on the <b>first trick</b>.</li>
          <li>Cards you can't legally play are dimmed.</li></ul>`,
      },
      {
        title: 'Shooting the moon',
        body: `<p>If you take <b>all 13 Hearts and the Q♠</b> in one round, you “shoot the moon”: you score 0 and every other player gets 26!</p>
          <p class="tip">Tips: get rid of high Spades if you don't hold the Queen; try to empty a suit early so you can dump penalty cards; and keep an eye on who is collecting Hearts.</p>`,
      },
    ],
  });
})();
