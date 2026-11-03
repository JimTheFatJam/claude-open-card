/* Video Poker — Jacks or Better */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const START = 200;
  // pays per 1 credit bet; royal pays 800 at max bet (5)
  const PAYS = [
    ['Royal Flush', 9, [250, 500, 750, 1000, 4000]],
    ['Straight Flush', 8, [50, 100, 150, 200, 250]],
    ['Four of a Kind', 7, [25, 50, 75, 100, 125]],
    ['Full House', 6, [9, 18, 27, 36, 45]],
    ['Flush', 5, [6, 12, 18, 24, 30]],
    ['Straight', 4, [4, 8, 12, 16, 20]],
    ['Three of a Kind', 3, [3, 6, 9, 12, 15]],
    ['Two Pair', 2, [2, 4, 6, 8, 10]],
    ['Jacks or Better', 1, [1, 2, 3, 4, 5]],
  ];

  function payout(cards) {
    const e = OC.poker.eval5(cards);
    if (e.cat === 1 && !(e.pairRank >= 11)) return { name: '', idx: -1, cat: 0 };
    if (e.cat === 0) return { name: '', idx: -1, cat: 0 };
    const idx = PAYS.findIndex((p) => p[1] === e.cat);
    return { name: PAYS[idx][0], idx, cat: e.cat };
  }

  /** Simple expert-style hold suggestion. Returns array of indices to hold. */
  function suggestHold(cards) {
    const vals = cards.map((c) => (c.r === 1 ? 14 : c.r));
    const e = OC.poker.eval5(cards);
    const all = [0, 1, 2, 3, 4];
    if (e.cat >= 4 && e.cat !== 7) return all; // straight or better (keep all), quads handled below
    if (e.cat === 7) {
      const counts = {};
      vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
      return all.filter((i) => counts[vals[i]] === 4);
    }
    const bySuit = [[], [], [], []];
    cards.forEach((c, i) => bySuit[c.s].push(i));
    // 4 to a royal
    for (const idxs of bySuit) {
      const roy = idxs.filter((i) => vals[i] >= 10);
      if (roy.length >= 4) return roy;
    }
    const counts = {};
    vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
    if (e.cat === 3 || e.cat === 2) return all.filter((i) => counts[vals[i]] >= 2);
    if (e.cat === 1) {
      if (e.pairRank >= 11) return all.filter((i) => counts[vals[i]] === 2);
    }
    // 4 to a flush
    for (const idxs of bySuit) if (idxs.length === 4) return idxs;
    // 4 to an open straight
    const uniq = [...new Set(vals)].sort((a, b) => a - b);
    for (let lo = 2; lo <= 11; lo++) {
      const need = [lo, lo + 1, lo + 2, lo + 3];
      if (need.every((v) => uniq.includes(v)) && lo + 3 < 14) return need.map((v) => vals.indexOf(v));
    }
    // 3 to a royal
    for (const idxs of bySuit) {
      const roy = idxs.filter((i) => vals[i] >= 10);
      if (roy.length === 3) return roy;
    }
    if (e.cat === 1) return all.filter((i) => counts[vals[i]] === 2); // low pair
    // two or more high cards (J+), keep up to two lowest high cards
    const high = all.filter((i) => vals[i] >= 11).sort((a, b) => vals[a] - vals[b]);
    if (high.length >= 2) return high.slice(0, 2);
    if (high.length === 1) return high;
    return [];
  }

  class VideoPoker {
    constructor(ctx) {
      this.ctx = ctx;
      this.T = ctx.table;
      this.credits = OC.store.get('vp.credits', START);
      this.bet = OC.store.get('vp.bet', 5);
      this.detach = OC.attachInput(this.T, { onTap: (p, i) => this.tap(p, i) });
    }
    inProgress() {
      return this.phase === 'draw';
    }
    progressText() {
      return 'hand dealt, waiting for your draw';
    }
    destroy() {
      this.detach();
    }
    save() {
      OC.store.set('vp.credits', this.credits);
      OC.store.set('vp.bet', this.bet);
    }
    start() {
      this.T.clear();
      this.hand = [];
      this.held = [false, false, false, false, false];
      this.phase = 'bet';
      this.result = null;
      this.ctx.buttons([{ label: 'Hint', onClick: () => this.hint() }]);
      this.ui();
      this.render();
    }
    status() {
      this.ctx.status(`Credits <b>${this.credits}</b> &nbsp;·&nbsp; Bet <b>${this.bet}</b>`);
    }
    ui() {
      this.status();
      if (this.phase === 'draw') {
        this.ctx.actions([{ html: 'Tap cards to <b>HOLD</b>' }, { label: 'Draw', primary: true, onClick: () => this.drawCards() }]);
        return;
      }
      if (this.credits < 1) {
        this.ctx.actions([{ html: 'Out of credits!' }, { label: 'Get 200 credits', primary: true, onClick: () => { this.credits = START; this.save(); this.ui(); this.render(); } }]);
        return;
      }
      this.bet = Math.min(this.bet, this.credits);
      this.ctx.actions([
        { label: 'Bet One', onClick: () => { this.bet = (this.bet % Math.min(5, this.credits)) + 1; this.save(); this.ui(); this.render(); } },
        { label: 'Bet Max', onClick: () => { this.bet = Math.min(5, this.credits); this.save(); this.dealCards(); } },
        { label: 'Deal', primary: true, onClick: () => this.dealCards() },
      ]);
    }
    async dealCards() {
      if (this.phase !== 'bet' || this.busy) return;
      this.busy = true;
      this.credits -= this.bet;
      this.save();
      this.deck = OC.shuffle(OC.makeDeck());
      this.T.clear();
      this.hand = [];
      this.held = [false, false, false, false, false];
      this.result = null;
      this.ctx.actions([]);
      this.status();
      for (let i = 0; i < 5; i++) {
        const c = this.deck.pop();
        c.up = true;
        this.hand.push(c);
        this.render();
        await this.ctx.wait(110);
      }
      this.phase = 'draw';
      this.busy = false;
      const p = payout(this.hand);
      this.preview = p.idx >= 0 ? p.name : '';
      this.render();
      this.ui();
    }
    tap(p, i) {
      if (this.phase !== 'draw' || this.busy || p !== 'h') return;
      this.held[i] = !this.held[i];
      this.render();
    }
    async drawCards() {
      if (this.phase !== 'draw' || this.busy) return;
      this.busy = true;
      this.ctx.actions([]);
      for (let i = 0; i < 5; i++) {
        if (this.held[i]) continue;
        const c = this.deck.pop();
        c.up = true;
        this.hand[i] = c;
        this.render();
        await this.ctx.wait(140);
      }
      const p = payout(this.hand);
      const win = p.idx >= 0 ? PAYS[p.idx][2][this.bet - 1] : 0;
      this.credits += win;
      this.result = { name: p.name, win, idx: p.idx };
      this.ctx.record(win > 0);
      this.save();
      this.phase = 'bet';
      this.busy = false;
      this.preview = '';
      this.render();
      this.ui();
    }
    hint() {
      if (this.phase !== 'draw') {
        this.ctx.toast('Tap Deal to get a hand first');
        return;
      }
      const hold = suggestHold(this.hand);
      this.held = [0, 1, 2, 3, 4].map((i) => hold.includes(i));
      this.render();
      this.ctx.toast(hold.length ? 'Suggested: hold the highlighted cards' : 'Suggested: draw five new cards', 2400);
    }
    render() {
      const T = this.T;
      const { w, h } = T.size();
      const cw = Math.min((w - 40) / 5.8, (h - 230) / 1.4, 150);
      T.setCardWidth(Math.max(cw, 40));
      const gap = T.cw * 0.15;
      const totalW = 5 * T.cw + 4 * gap;
      const x0 = (w - totalW) / 2;
      const y = h - T.ch - 50;
      T.spawn = { x: w / 2 - T.cw / 2, y: -T.ch - 20 };
      T.begin();
      // pay table
      const rows = PAYS.map(([n, , pays], k) => `<tr class="${this.result && this.result.idx === k ? 'win' : ''}"><td>${n}</td>${pays.map((p, b) => `<td class="${b === this.bet - 1 ? 'on' : ''}">${p}</td>`).join('')}</tr>`).join('');
      T.label('pay', 0, 10, `<table class="paytable" style="margin:0 auto">${rows}</table>`, { w, align: 'center', z: 1 });
      this.hand.forEach((c, i) => {
        const x = x0 + i * (T.cw + gap);
        T.card(c, x, y - (this.held[i] ? 12 : 0), { z: 1, pile: 'h', idx: i, cls: this.held[i] ? 'sel' : '' });
        if (this.held[i]) T.label('hold' + i, x, y + T.ch + 2, '<span class="hold-tag">HELD</span>', { w: T.cw, align: 'center' });
      });
      if (!this.hand.length) T.label('msg', 0, y + T.ch / 2 - 12, 'Choose your bet (1–5 credits), then tap <b>Deal</b>', { w, align: 'center', cls: 'msg' });
      else if (this.result) T.label('msg', 0, y - 44, this.result.win ? `<span class="badge gold">${this.result.name} — win ${this.result.win}</span>` : '<span class="badge">No win</span>', { w, align: 'center', cls: 'msg' });
      else if (this.preview) T.label('msg', 0, y - 44, `<span class="badge">You have: ${this.preview}</span>`, { w, align: 'center', cls: 'msg' });
      T.end();
    }
  }

  OC.registerGame({
    id: 'videopoker',
    name: 'Video Poker',
    category: 'Casino',
    players: '1 player',
    blurb: 'Jacks or Better: hold the best cards, draw, and match the pay table.',
    preview: '10H JH QH',
    create: (ctx) => new VideoPoker(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Make the best possible <b>five-card poker hand</b>. Any hand of <b>a pair of Jacks or better</b> pays out according to the pay table at the top of the screen.</p>`,
      },
      {
        title: 'How a hand works',
        body: `<ol><li>Choose a bet of 1–5 credits (<b>Bet One</b> cycles; <b>Bet Max</b> bets 5 and deals).</li>
          <li>Tap <b>Deal</b> to get five cards.</li>
          <li>Tap the cards you want to <b>keep</b> — they're marked HELD.</li>
          <li>Tap <b>Draw</b>: every card you didn't hold is replaced.</li>
          <li>Your final hand is paid from the pay table.</li></ol>`,
      },
      {
        title: 'Poker hands (best to worst)',
        body: `<table>
          <tr><td>Royal Flush</td><td>${m('10S JS QS KS AS')}</td></tr>
          <tr><td>Straight Flush</td><td>${m('5H 6H 7H 8H 9H')}</td></tr>
          <tr><td>Four of a Kind</td><td>${m('9C 9D 9H 9S')}</td></tr>
          <tr><td>Full House</td><td>${m('KC KD KH 4S 4D')}</td></tr>
          <tr><td>Flush</td><td>five cards of one suit</td></tr>
          <tr><td>Straight</td><td>five in a row, e.g. 4-5-6-7-8</td></tr>
          <tr><td>Three of a Kind</td><td>${m('7C 7D 7H')}</td></tr>
          <tr><td>Two Pair</td><td>${m('3C 3D JH JS')}</td></tr>
          <tr><td>Jacks or Better</td><td>${m('QC QD')} (J, Q, K or A pair)</td></tr></table>`,
      },
      {
        title: 'Strategy tips',
        body: `<ul><li>Never throw away a paying hand unless you hold 4 cards to a Royal Flush.</li>
          <li>Keep any pair — even a low one beats keeping a single high card.</li>
          <li>Hold 4 cards to a flush, or 4 in a row for a straight.</li>
          <li>The Royal Flush pays a huge bonus at 5 credits, so betting max is best.</li></ul>
          <p class="tip">Tap <b>Hint</b> after the deal to see which cards an expert would hold.</p>`,
      },
    ],
  });
})();
