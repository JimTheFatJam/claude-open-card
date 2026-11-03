/* Texas Hold'em — you vs three computer players */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const NAMES = ['You', 'Ava', 'Ben', 'Cleo'];
  const STYLE = [null, { aggr: 0.35, bluff: 0.06 }, { aggr: 0.6, bluff: 0.12 }, { aggr: 0.2, bluff: 0.03 }];
  const START_CHIPS = 1000;

  /** Monte-Carlo win probability for `hole` against `opp` random hands. */
  function equity(hole, board, opp, sims = 160) {
    const used = new Set([...hole, ...board].map((c) => c.s * 13 + c.r));
    const rest = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) if (!used.has(s * 13 + r)) rest.push({ r, s });
    let score = 0;
    for (let k = 0; k < sims; k++) {
      // partial shuffle
      const need = 5 - board.length + opp * 2;
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (rest.length - i));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const full = board.concat(rest.slice(0, 5 - board.length));
      const mine = OC.poker.best(hole.concat(full)).score;
      let best = 0, ties = 0;
      let p = 5 - board.length;
      for (let o = 0; o < opp; o++) {
        const sc = OC.poker.best([rest[p], rest[p + 1]].concat(full)).score;
        p += 2;
        if (sc > best) best = sc;
      }
      if (mine > best) score += 1;
      else if (mine === best) score += 0.5;
      void ties;
    }
    return score / sims;
  }

  class Holdem {
    constructor(ctx) {
      this.ctx = ctx;
      this.T = ctx.table;
      this.detach = OC.attachInput(this.T, { onTap: () => {} });
    }
    destroy() {
      this.detach();
      if (this.humanResolve) this.humanResolve = null;
    }
    inProgress() {
      return this.started && !this.over;
    }
    progressText() {
      return `hand ${this.handNo} \u00b7 you have ${this.players[0].chips} chips`;
    }
    start() {
      this.T.clear();
      this.over = false;
      this.started = false;
      this.players = NAMES.map((name, i) => ({ i, name, chips: START_CHIPS, cards: [], folded: false, allIn: false, bet: 0, total: 0, out: false, said: '' }));
      this.button = OC.rand(4);
      this.handNo = 0;
      this.board = [];
      this.ctx.buttons([{ label: 'Hand ranks', onClick: () => this.showRanks() }]);
      this.ctx.actions([]);
      this.playHand();
    }
    get sb() {
      return 10 * Math.pow(2, Math.floor(this.handNo / 10));
    }
    get bb() {
      return this.sb * 2;
    }
    alive() {
      return this.players.filter((p) => !p.out);
    }
    next(i, pred = (p) => !p.out) {
      for (let k = 1; k <= 4; k++) {
        const j = (i + k) % 4;
        if (pred(this.players[j])) return j;
      }
      return i;
    }
    pot() {
      return this.players.reduce((a, p) => a + p.total, 0);
    }
    status() {
      this.ctx.status(`Hand <b>${this.handNo}</b> &nbsp;·&nbsp; Blinds <b>${this.sb}/${this.bb}</b> &nbsp;·&nbsp; Pot <b>${this.pot()}</b>`);
    }
    put(p, amount) {
      amount = Math.min(amount, p.chips);
      p.chips -= amount;
      p.bet += amount;
      p.total += amount;
      if (p.chips === 0) p.allIn = true;
      return amount;
    }

    async playHand() {
      const ctx = this.ctx;
      this.handNo++;
      this.T.clear();
      this.deck = OC.shuffle(OC.makeDeck());
      this.board = [];
      this.winners = null;
      this.showdown = false;
      for (const p of this.players) Object.assign(p, { cards: [], folded: p.out, allIn: false, bet: 0, total: 0, said: '', best: null, won: 0 });
      this.button = this.next(this.button);
      const sbI = this.alive().length === 2 ? this.button : this.next(this.button);
      const bbI = this.next(sbI);
      this.put(this.players[sbI], this.sb);
      this.players[sbI].said = 'Small blind';
      this.put(this.players[bbI], this.bb);
      this.players[bbI].said = 'Big blind';
      this.status();
      this.render();
      // deal two cards each
      for (let r = 0; r < 2; r++) {
        let i = sbI;
        for (let k = 0; k < 4; k++) {
          const p = this.players[i];
          if (!p.out) {
            const c = this.deck.pop();
            c.up = p.i === 0;
            p.cards.push(c);
            this.render();
            await ctx.wait(120);
          }
          i = (i + 1) % 4;
        }
      }
      this.started = true;
      // betting rounds
      const streets = [['Pre-flop', 0], ['Flop', 3], ['Turn', 1], ['River', 1]];
      for (let st = 0; st < streets.length; st++) {
        const [, n] = streets[st];
        if (n) {
          this.deck.pop(); // burn
          for (let k = 0; k < n; k++) {
            const c = this.deck.pop();
            c.up = true;
            this.board.push(c);
          }
          for (const p of this.players) { p.bet = 0; if (!p.folded && !p.allIn) p.said = ''; }
          this.render();
          await ctx.wait(500);
        }
        if (this.players.filter((p) => !p.folded).length < 2) break;
        const canAct = this.players.filter((p) => !p.folded && !p.allIn);
        if (canAct.length >= 2 || (canAct.length === 1 && canAct[0].bet < Math.max(...this.players.map((p) => p.bet)))) {
          const first = st === 0 ? this.next(bbI) : this.next(this.button);
          await this.bettingRound(first, st === 0 ? this.bb : 0);
          if (!ctx.alive()) return;
        }
      }
      await this.finishHand();
    }

    async bettingRound(start, currentBet) {
      const ctx = this.ctx;
      let minRaise = this.bb;
      for (const p of this.players) p.acted = false;
      let i = start;
      for (let guard = 0; guard < 200; guard++) {
        const live = this.players.filter((p) => !p.folded);
        if (live.length < 2) return;
        const needs = (p) => !p.folded && !p.allIn && (!p.acted || p.bet < currentBet);
        if (!this.players.some(needs)) return;
        const p = this.players[i];
        if (needs(p)) {
          this.turn = p.i;
          this.render();
          const toCall = currentBet - p.bet;
          let act;
          if (p.i === 0) act = await this.humanAction(toCall, currentBet, minRaise);
          else {
            await ctx.wait(650);
            act = this.aiAction(p, toCall, currentBet, minRaise);
          }
          if (!ctx.alive()) return;
          if (act.type === 'fold') {
            p.folded = true;
            p.said = 'Fold';
          } else if (act.type === 'call') {
            if (toCall === 0) p.said = 'Check';
            else {
              this.put(p, toCall);
              p.said = p.allIn ? 'All-in' : 'Call ' + toCall;
            }
          } else if (act.type === 'raise') {
            const target = Math.min(act.to, p.bet + p.chips);
            const raiseBy = target - currentBet;
            this.put(p, target - p.bet);
            if (raiseBy >= minRaise) minRaise = raiseBy;
            if (target > currentBet) {
              currentBet = target;
              for (const o of this.players) if (o !== p) o.acted = false;
            }
            p.said = p.allIn ? 'All-in ' + p.bet : (toCall === 0 && currentBet === target && this.board.length ? 'Bet ' : 'Raise to ') + p.bet;
          }
          p.acted = true;
          this.turn = -1;
          this.status();
          this.render();
        }
        i = (i + 1) % 4;
      }
    }

    humanAction(toCall, currentBet, minRaise) {
      const me = this.players[0];
      return new Promise((resolve) => {
        const done = (a) => {
          this.ctx.actions([]);
          resolve(a);
        };
        const maxTo = me.bet + me.chips;
        const minTo = Math.min(currentBet + minRaise, maxTo);
        const potTo = Math.min(currentBet + this.pot() + toCall, maxTo);
        const acts = [
          { label: 'Fold', cls: 'danger', disabled: toCall === 0, onClick: () => done({ type: 'fold' }) },
          { label: toCall === 0 ? 'Check' : `Call ${Math.min(toCall, me.chips)}`, primary: true, onClick: () => done({ type: 'call' }) },
        ];
        if (me.chips > toCall) {
          const word = currentBet === 0 ? 'Bet' : 'Raise to';
          acts.push({ label: `${word} ${minTo}`, onClick: () => done({ type: 'raise', to: minTo }) });
          if (potTo > minTo && potTo < maxTo) acts.push({ label: `Pot ${potTo}`, onClick: () => done({ type: 'raise', to: potTo }) });
          acts.push({ label: `All-in ${maxTo}`, onClick: () => done({ type: 'raise', to: maxTo }) });
        }
        this.ctx.actions(acts);
      });
    }

    aiAction(p, toCall, currentBet, minRaise) {
      const opp = this.players.filter((o) => !o.folded && o !== p).length;
      let eq = equity(p.cards, this.board, Math.max(1, opp), this.board.length ? 140 : 110);
      eq += (Math.random() - 0.5) * 0.08;
      const style = STYLE[p.i];
      const pot = this.pot();
      const potOdds = toCall / (pot + toCall);
      const fair = 1 / (opp + 1); // equity of an average hand
      const strong = eq > Math.min(0.85, fair * 1.9);
      const good = eq > fair * 1.25;
      const maxTo = p.bet + p.chips;
      const raiseTo = (frac) => Math.min(maxTo, Math.max(currentBet + minRaise, Math.round((currentBet + (pot + toCall) * frac) / 5) * 5));
      if (strong && Math.random() < 0.55 + style.aggr * 0.5) return { type: 'raise', to: raiseTo(0.6 + Math.random() * 0.5) };
      if (toCall === 0) {
        if (good && Math.random() < style.aggr) return { type: 'raise', to: raiseTo(0.5) };
        if (Math.random() < style.bluff) return { type: 'raise', to: raiseTo(0.5) };
        return { type: 'call' };
      }
      if (eq >= potOdds + 0.04 || (good && toCall <= this.bb * 2)) {
        if (toCall >= p.chips && eq < fair * 1.4) return { type: 'fold' };
        return { type: 'call' };
      }
      if (Math.random() < style.bluff * 0.5 && toCall <= this.bb * 2) return { type: 'call' };
      return { type: 'fold' };
    }

    async finishHand() {
      const ctx = this.ctx;
      const live = this.players.filter((p) => !p.folded);
      this.turn = -1;
      if (live.length === 1) {
        const w = live[0];
        w.won = this.pot();
        w.chips += w.won;
        this.msg = `${w.name === 'You' ? 'You win' : w.name + ' wins'} ${w.won} — everyone else folded`;
      } else {
        // run out remaining board if players are all-in
        while (this.board.length < 5) {
          const c = this.deck.pop();
          c.up = true;
          this.board.push(c);
          this.render();
          await ctx.wait(500);
        }
        this.showdown = true;
        for (const p of live) {
          p.cards.forEach((c) => (c.up = true));
          p.best = OC.poker.best(p.cards.concat(this.board));
        }
        // side pots
        const levels = [...new Set(this.players.map((p) => p.total).filter((t) => t > 0))].sort((a, b) => a - b);
        let prev = 0;
        for (const lv of levels) {
          let amount = 0;
          for (const p of this.players) amount += Math.max(0, Math.min(p.total, lv) - prev);
          let elig = live.filter((p) => p.total >= lv);
          if (!elig.length) elig = live;
          const top = Math.max(...elig.map((p) => p.best.score));
          const ws = elig.filter((p) => p.best.score === top);
          const share = Math.floor(amount / ws.length);
          ws.forEach((w) => { w.won += share; w.chips += share; });
          ws[0].won += amount - share * ws.length;
          ws[0].chips += amount - share * ws.length;
          prev = lv;
        }
        const winners = live.filter((p) => p.won > 0);
        this.msg = winners.map((w) => `${w.name === 'You' ? 'You win' : w.name + ' wins'} ${w.won} with ${w.best.name}`).join(' · ');
      }
      for (const p of this.players) {
        p.said = p.won ? 'Won ' + p.won : p.folded && !p.out ? 'Fold' : p.said;
        if (p.chips <= 0 && !p.out) p.out = true;
      }
      this.status();
      this.render();
      const me = this.players[0];
      if (me.out) {
        this.over = true;
        await ctx.wait(1200);
        return ctx.finish({ won: false, title: 'You’re out of chips', html: `<p>You lasted <b>${this.handNo}</b> hands. Better luck next time!</p>` });
      }
      if (this.players.slice(1).every((p) => p.out)) {
        this.over = true;
        await ctx.wait(1200);
        return ctx.finish({ won: true, title: 'You won the table!', html: `<p>You took every chip in <b>${this.handNo}</b> hands.</p>` });
      }
      ctx.actions([{ html: OC.esc(this.msg) }, { label: 'Next hand', primary: true, onClick: () => { ctx.actions([]); this.msg = ''; this.playHand(); } }]);
    }

    showRanks() {
      this.ctx.dialog({
        title: 'Poker hand ranks',
        html: `<table class="score-table">
          <tr><td>1. Royal Flush</td><td>${m('10S JS QS KS AS')}</td></tr>
          <tr><td>2. Straight Flush</td><td>${m('5H 6H 7H 8H 9H')}</td></tr>
          <tr><td>3. Four of a Kind</td><td>${m('9C 9D 9H 9S')}</td></tr>
          <tr><td>4. Full House</td><td>${m('KC KD KH 4S 4D')}</td></tr>
          <tr><td>5. Flush</td><td>${m('2D 6D 9D JD KD')}</td></tr>
          <tr><td>6. Straight</td><td>${m('4C 5D 6H 7S 8C')}</td></tr>
          <tr><td>7. Three of a Kind</td><td>${m('7C 7D 7H')}</td></tr>
          <tr><td>8. Two Pair</td><td>${m('3C 3D JH JS')}</td></tr>
          <tr><td>9. One Pair</td><td>${m('QC QD')}</td></tr>
          <tr><td>10. High Card</td><td>none of the above</td></tr></table>`,
      });
    }

    render() {
      const T = this.T;
      const { w, h } = T.size();
      const cw = Math.min(w / 11, (h - 30) / (1.4 * 3.7), 110);
      T.setCardWidth(cw);
      const fan = T.cw * 1.08;
      T.spawn = { x: w / 2 - T.cw / 2, y: h / 2 - T.ch / 2 };
      T.begin();
      // board
      const bw = 5 * T.cw + 4 * T.cw * 0.12;
      const bx = (w - bw) / 2, by = h / 2 - T.ch / 2 - 10;
      for (let k = 0; k < 5; k++) T.slot('b' + k, bx + k * T.cw * 1.12, by, { pile: '', cls: 'board-slot' });
      this.board.forEach((c, k) => T.card(c, bx + k * T.cw * 1.12, by, { z: k + 1, pile: '', cls: this.showdown && this.winners ? '' : '' }));
      T.label('pot', bx - 130, by + T.ch / 2 - 14, `<span class="badge gold">Pot ${this.pot()}</span>`, { w: 120, align: 'right' });
      // seats
      const seat = [
        { x: w / 2 - fan / 2 - T.cw / 2, y: h - T.ch - 14, lx: w / 2 + fan / 2 + T.cw / 2 + 12, ly: h - T.ch / 2 - 40, la: 'left' },
        { x: 18, y: h / 2 - T.ch / 2 - 10, lx: 10, ly: h / 2 + T.ch / 2 + 2, la: 'left' },
        { x: w / 2 - fan / 2 - T.cw / 2, y: 10, lx: w / 2 + fan / 2 + T.cw / 2 + 12, ly: 14, la: 'left' },
        { x: w - 18 - T.cw - fan, y: h / 2 - T.ch / 2 - 10, lx: w - 10 - 200, ly: h / 2 + T.ch / 2 + 2, la: 'right' },
      ];
      this.players.forEach((p, k) => {
        const s = seat[k];
        const winner = p.won > 0;
        p.cards.forEach((c, j) => {
          const up = k === 0 || (this.showdown && !p.folded);
          T.card(c, s.x + j * fan * (k === 0 ? 1 : 0.55), s.y, { z: j + 1, up, pile: '', cls: p.folded && !p.out ? 'dim' : winner && this.showdown && p.best && p.best.cards.includes(c) ? 'glow' : '' });
        });
        const btn = this.button === k ? ' <span class="badge gold">D</span>' : '';
        const bet = p.bet && !this.msg ? ` <span class="badge">bet ${p.bet}</span>` : '';
        const said = p.said ? `<br><span class="badge ${p.won ? 'green' : ''}">${OC.esc(p.said)}${this.showdown && p.best && !p.folded ? ' · ' + p.best.name : ''}</span>` : '';
        const cls = (this.turn === k ? 'turn ' : '') + 'seat';
        const name = p.out ? `<span class="badge" style="opacity:.5">${p.name} · out</span>` : `<span class="badge">${p.name} · ${p.chips}</span>`;
        T.label('seat' + k, s.lx, s.ly, `${name}${btn}${bet}${said}`, { w: 200, align: s.la, cls });
      });
      T.end();
    }
  }

  OC.registerGame({
    id: 'holdem',
    name: 'Texas Hold’em',
    category: 'Versus Computer',
    players: 'You + 3 computer players',
    blurb: 'The world’s most popular poker game. Outplay three opponents for all the chips.',
    preview: 'AS AD KH',
    create: (ctx) => new Holdem(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Everyone starts with <b>1000 chips</b>. Win chips by having the best poker hand at the end of a hand — or by making everyone else fold. Take all the chips to win the game.</p>`,
      },
      {
        title: 'Your cards',
        body: `<p>Each player gets <b>two private cards</b> (hole cards). Then up to five <b>community cards</b> are dealt face up in the middle, which everyone shares.</p>
          <div class="example">${m('AH KH')} <span class="arrow">+</span> ${m('QH JH 2C 7S 10H')}</div>
          <p>Your hand is the <b>best five cards</b> out of your two plus the five on the table. (Above: a Royal Flush!)</p>`,
      },
      {
        title: 'Order of play',
        body: `<ol><li><b>Blinds</b>: the two players after the dealer button (D) post forced bets — the small and big blind.</li>
          <li><b>Pre-flop</b>: hole cards are dealt, then a round of betting.</li>
          <li><b>Flop</b>: three community cards, then betting.</li>
          <li><b>Turn</b>: a fourth card, then betting.</li>
          <li><b>River</b>: the fifth card, then the final betting.</li>
          <li><b>Showdown</b>: remaining players reveal; best hand wins the pot.</li></ol>
          <p>Blinds double every 10 hands to keep things moving.</p>`,
      },
      {
        title: 'Betting choices',
        body: `<ul><li><b>Check</b> — pass without betting (only if nobody has bet).</li>
          <li><b>Call</b> — match the current bet.</li>
          <li><b>Bet / Raise</b> — put in more chips; others must call to stay in.</li>
          <li><b>Fold</b> — give up your cards and any chips you've put in.</li>
          <li><b>All-in</b> — bet everything. If you're all-in you can still win the part of the pot you matched.</li></ul>`,
      },
      {
        title: 'Hand rankings',
        body: `<p>From best to worst: Royal Flush, Straight Flush, Four of a Kind, Full House, Flush, Straight, Three of a Kind, Two Pair, One Pair, High Card.</p>
          <p>Tap <b>Hand ranks</b> at the top of the game screen for a picture guide at any time.</p>`,
      },
      {
        title: 'Tips',
        body: `<ul><li>Play fewer, stronger starting hands: big pairs, A-K, A-Q, and suited high cards.</li>
          <li>Position matters: acting after others gives you more information.</li>
          <li>Don't chase draws when the bet is too big compared with the pot.</li>
          <li>Watch the computer players: Ben is aggressive and bluffs more; Cleo is cautious.</li></ul>`,
      },
    ],
  });
})();
