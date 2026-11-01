/* Blackjack */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const START_BANK = 1000;
  const CHIPS = [5, 25, 100, 500];

  const cardVal = (c) => (c.r === 1 ? 11 : Math.min(10, c.r));
  function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
      total += cardVal(c);
      if (c.r === 1) aces++;
    }
    while (total > 21 && aces) {
      total -= 10;
      aces--;
    }
    return { total, soft: aces > 0 };
  }
  const isBJ = (cards) => cards.length === 2 && handValue(cards).total === 21;

  /** Basic strategy for 6 decks, dealer stands on soft 17, double after split allowed. */
  function strategy(hand, up, canDouble, canSplit) {
    const d = up.r === 1 ? 11 : Math.min(10, up.r);
    const { total, soft } = handValue(hand.cards);
    const c = hand.cards;
    const D = (alt) => (canDouble ? 'double' : alt);
    if (canSplit && c.length === 2 && cardVal(c[0]) === cardVal(c[1])) {
      const v = cardVal(c[0]);
      if (v === 11 || v === 8) return 'split';
      if (v === 9 && d !== 7 && d < 10) return 'split';
      if ((v === 7 || v === 2 || v === 3) && d <= 7) return 'split';
      if (v === 6 && d <= 6) return 'split';
      if (v === 4 && (d === 5 || d === 6)) return 'split';
    }
    if (soft && total <= 21) {
      if (total >= 19) return 'stand';
      if (total === 18) {
        if (d >= 3 && d <= 6) return D('stand');
        if (d <= 8) return 'stand';
        return 'hit';
      }
      if (total === 17) return d >= 3 && d <= 6 ? D('hit') : 'hit';
      if (total >= 15) return d >= 4 && d <= 6 ? D('hit') : 'hit';
      return d >= 5 && d <= 6 ? D('hit') : 'hit';
    }
    if (total >= 17) return 'stand';
    if (total >= 13) return d <= 6 ? 'stand' : 'hit';
    if (total === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
    if (total === 11) return d <= 10 ? D('hit') : 'hit';
    if (total === 10) return d <= 9 ? D('hit') : 'hit';
    if (total === 9) return d >= 3 && d <= 6 ? D('hit') : 'hit';
    return 'hit';
  }

  class Blackjack {
    constructor(ctx) {
      this.ctx = ctx;
      this.T = ctx.table;
      this.bank = OC.store.get('bj.bank', START_BANK);
      this.bet = OC.store.get('bj.bet', 25);
      this.shoe = [];
      this.detach = OC.attachInput(this.T, { onTap: () => {} });
    }
    inProgress() {
      return false;
    }
    destroy() {
      this.detach();
    }
    save() {
      OC.store.set('bj.bank', this.bank);
      OC.store.set('bj.bet', this.bet);
    }
    start() {
      this.T.clear();
      this.dealer = [];
      this.hands = [];
      this.active = 0;
      this.msg = '';
      this.phase = 'bet';
      this.ctx.buttons([{ label: 'Hint', onClick: () => this.hint() }]);
      this.betUI();
      this.render();
    }
    newShoe() {
      this.shoe = OC.shuffle(OC.makeDeck(6));
      this.ctx.toast('Shuffling a fresh 6-deck shoe');
    }
    draw(up = true) {
      if (!this.shoe.length) this.newShoe();
      const c = this.shoe.pop();
      c.up = up;
      return c;
    }
    status() {
      this.ctx.status(`Chips <b>${this.bank}</b>` + (this.phase !== 'bet' ? ` &nbsp;·&nbsp; Bet <b>${this.hands.reduce((a, h) => a + h.bet, 0)}</b>` : ''));
    }

    /* ----- betting ----- */
    betUI() {
      this.phase = 'bet';
      if (this.bank < 5) {
        this.ctx.actions([{ html: 'You’re out of chips!' }, { label: 'Get 1000 more chips', primary: true, onClick: () => { this.bank = START_BANK; this.save(); this.betUI(); } }]);
        this.status();
        return;
      }
      this.bet = Math.min(Math.max(5, this.bet), this.bank);
      const acts = [{ html: `Bet <b>${this.bet}</b>` }];
      for (const v of CHIPS) acts.push({ label: String(v), cls: 'bet-chip c' + v, disabled: this.bet + v > this.bank, onClick: () => { this.bet += v; this.betUI(); } });
      acts.push({ label: 'Clear', onClick: () => { this.bet = 5; this.betUI(); } });
      acts.push({ label: 'Deal', primary: true, onClick: () => this.deal() });
      this.ctx.actions(acts);
      this.status();
    }

    /* ----- dealing & play ----- */
    async deal() {
      if (this.phase !== 'bet') return;
      this.save();
      if (this.shoe.length < 6 * 52 * 0.25) this.newShoe();
      this.phase = 'deal';
      this.ctx.actions([]);
      this.bank -= this.bet;
      this.T.clear();
      this.dealer = [];
      this.hands = [{ cards: [], bet: this.bet, done: false, doubled: false, result: '' }];
      this.active = 0;
      this.msg = '';
      this.status();
      const seq = [() => this.hands[0].cards.push(this.draw()), () => this.dealer.push(this.draw()), () => this.hands[0].cards.push(this.draw()), () => this.dealer.push(this.draw(false))];
      for (const f of seq) {
        f();
        this.render();
        await this.ctx.wait(330);
      }
      const up = this.dealer[0];
      // dealer peeks for blackjack with an Ace or ten showing
      if ((up.r === 1 || cardVal(up) === 10) && isBJ(this.dealer)) {
        this.dealer[1].up = true;
        this.render();
        await this.ctx.wait(500);
        return this.settle();
      }
      if (isBJ(this.hands[0].cards)) {
        this.hands[0].done = true;
        return this.dealerPlay();
      }
      this.phase = 'play';
      this.playUI();
      this.render();
    }
    hand() {
      return this.hands[this.active];
    }
    canDouble() {
      const h = this.hand();
      return h && h.cards.length === 2 && !h.splitAces && this.bank >= h.bet;
    }
    canSplit() {
      const h = this.hand();
      return h && h.cards.length === 2 && cardVal(h.cards[0]) === cardVal(h.cards[1]) && this.hands.length < 4 && this.bank >= h.bet && !h.splitAces;
    }
    playUI() {
      if (this.phase !== 'play') return;
      const acts = [
        { label: 'Hit', primary: true, onClick: () => this.hit() },
        { label: 'Stand', onClick: () => this.stand() },
        { label: 'Double', disabled: !this.canDouble(), onClick: () => this.double() },
        { label: 'Split', disabled: !this.canSplit(), onClick: () => this.split() },
      ];
      this.ctx.actions(acts);
      this.status();
    }
    lock() {
      if (this.phase !== 'play' || this.busy) return false;
      this.busy = true;
      this.ctx.actions([]);
      return true;
    }
    async hit() {
      if (!this.lock()) return;
      const h = this.hand();
      h.cards.push(this.draw());
      this.render();
      await this.ctx.wait(300);
      this.busy = false;
      const v = handValue(h.cards).total;
      if (v >= 21) return this.nextHand();
      this.playUI();
    }
    stand() {
      if (!this.lock()) return;
      this.busy = false;
      this.nextHand();
    }
    async double() {
      if (!this.canDouble() || !this.lock()) return;
      const h = this.hand();
      this.bank -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.draw());
      this.status();
      this.render();
      await this.ctx.wait(400);
      this.busy = false;
      this.nextHand();
    }
    async split() {
      if (!this.canSplit() || !this.lock()) return;
      const h = this.hand();
      this.bank -= h.bet;
      const second = { cards: [h.cards.pop()], bet: h.bet, done: false, doubled: false, result: '' };
      const aces = h.cards[0].r === 1;
      if (aces) h.splitAces = second.splitAces = true;
      this.hands.splice(this.active + 1, 0, second);
      this.render();
      await this.ctx.wait(300);
      h.cards.push(this.draw());
      this.render();
      await this.ctx.wait(300);
      second.cards.push(this.draw());
      this.render();
      await this.ctx.wait(300);
      this.busy = false;
      if (aces) {
        // split aces get one card each
        this.active = this.hands.length - 1;
        return this.nextHand();
      }
      if (handValue(h.cards).total === 21) return this.nextHand();
      this.playUI();
      this.render();
    }
    nextHand() {
      this.hand().done = true;
      if (this.active < this.hands.length - 1) {
        this.active++;
        const h = this.hand();
        this.render();
        if (handValue(h.cards).total === 21) return this.nextHand();
        this.playUI();
        return;
      }
      this.dealerPlay();
    }
    async dealerPlay() {
      this.phase = 'dealer';
      this.ctx.actions([]);
      this.active = -1;
      this.dealer[1].up = true;
      this.render();
      await this.ctx.wait(550);
      const allBust = this.hands.every((h) => handValue(h.cards).total > 21);
      const onlyBJ = this.hands.length === 1 && isBJ(this.hands[0].cards);
      if (!allBust && !onlyBJ) {
        while (handValue(this.dealer).total < 17) {
          this.dealer.push(this.draw());
          this.render();
          await this.ctx.wait(550);
        }
      }
      this.settle();
    }
    async settle() {
      this.phase = 'done';
      this.active = -1;
      const dv = handValue(this.dealer).total;
      const dBJ = isBJ(this.dealer);
      let net = 0;
      for (const h of this.hands) {
        const pv = handValue(h.cards).total;
        const pBJ = isBJ(h.cards) && this.hands.length === 1;
        let pay = 0;
        if (pBJ && !dBJ) { pay = h.bet * 2.5; h.result = 'Blackjack!'; }
        else if (dBJ && !pBJ) { pay = 0; h.result = 'Dealer blackjack'; }
        else if (pBJ && dBJ) { pay = h.bet; h.result = 'Push'; }
        else if (pv > 21) { pay = 0; h.result = 'Bust'; }
        else if (dv > 21) { pay = h.bet * 2; h.result = 'Dealer busts — win'; }
        else if (pv > dv) { pay = h.bet * 2; h.result = 'Win'; }
        else if (pv < dv) { pay = 0; h.result = 'Lose'; }
        else { pay = h.bet; h.result = 'Push'; }
        pay = Math.floor(pay);
        this.bank += pay;
        net += pay - h.bet;
        h.net = pay - h.bet;
      }
      this.save();
      if (net !== 0) this.ctx.record(net > 0);
      this.msg = net > 0 ? `You win ${net} chips` : net < 0 ? `You lose ${-net} chips` : 'Push — bet returned';
      this.render();
      this.status();
      this.ctx.actions([{ html: this.msg }, { label: 'Next hand', primary: true, onClick: () => this.betUI() }]);
    }
    hint() {
      if (this.phase !== 'play') {
        this.ctx.toast(this.phase === 'bet' ? 'Choose your bet, then tap Deal' : 'Wait for the hand to finish');
        return;
      }
      const a = strategy(this.hand(), this.dealer[0], this.canDouble(), this.canSplit());
      const why = {
        hit: 'Hit — take another card',
        stand: 'Stand — keep your total',
        double: 'Double down — double your bet for exactly one more card',
        split: 'Split — play the pair as two hands',
      }[a];
      this.ctx.toast('Basic strategy: ' + why, 2800);
    }

    /* ----- drawing ----- */
    render() {
      const T = this.T;
      const { w, h } = T.size();
      const cw = Math.min(w / 9, (h - 40) / (1.4 * 2.7), 120);
      T.setCardWidth(cw);
      const shoeX = w - T.cw - 16, shoeY = 14;
      T.spawn = { x: shoeX, y: shoeY };
      T.begin();
      // shoe
      T.slot('shoe', shoeX, shoeY, { pile: '', outline: false });
      T.label('shoeback', shoeX, shoeY, `<div class="card" style="position:relative"><div class="inner"><div class="back"></div></div></div>`, { z: 1 });
      const fan = T.cw * 0.42;
      // dealer
      const dy = 34;
      const dw = T.cw + fan * Math.max(0, this.dealer.length - 1);
      const dx = (w - dw) / 2;
      this.dealer.forEach((c, i) => T.card(c, dx + i * fan, dy, { z: i + 1, pile: '' }));
      if (this.dealer.length) {
        const dv = this.dealer.every((c) => c.up) ? handValue(this.dealer).total : handValue([this.dealer[0]]).total;
        T.label('dl', 0, 6, `Dealer <span class="badge">${dv}</span>`, { w, align: 'center' });
      } else {
        T.label('dl', 0, 6, 'Dealer stands on all 17s · Blackjack pays 3 to 2', { w, align: 'center', cls: 'note' });
      }
      // player hands
      const py = h - T.ch - 40;
      const n = Math.max(1, this.hands.length);
      const slotW = w / n;
      this.hands.forEach((hd, k) => {
        const hw = T.cw + fan * Math.max(0, hd.cards.length - 1);
        const hx = slotW * k + (slotW - hw) / 2;
        const off = hd.doubled ? 1 : 0;
        hd.cards.forEach((c, i) => T.card(c, hx + i * fan, py - (off && i === hd.cards.length - 1 ? 0 : 0), { z: i + 1, pile: '', cls: k === this.active && this.phase === 'play' ? '' : this.phase === 'play' ? 'dim' : '' }));
        const v = handValue(hd.cards);
        const vt = v.soft && v.total < 21 && !hd.done ? `${v.total - 10}/${v.total}` : v.total;
        const res = hd.result ? ` <span class="badge ${hd.net > 0 ? 'green' : hd.net < 0 ? 'red' : ''}">${hd.result}</span>` : '';
        const cls = k === this.active && this.phase === 'play' ? 'turn' : '';
        T.label('ph' + k, slotW * k, py + T.ch + 8, `<span class="badge">${vt}</span> <span class="badge">Bet ${hd.bet}</span>${res}`, { w: slotW, align: 'center', cls });
      });
      if (this.msg) T.label('msg', 0, (dy + T.ch + py) / 2 - 12, `<span class="badge gold">${this.msg}</span>`, { w, align: 'center', cls: 'msg' });
      else if (this.phase === 'bet') T.label('msg', 0, (dy + T.ch + py) / 2 - 12, 'Place your bet with the chips below, then tap <b>Deal</b>', { w, align: 'center', cls: 'msg' });
      T.end();
    }
  }

  OC.registerGame({
    id: 'blackjack',
    name: 'Blackjack',
    category: 'Casino',
    players: '1 player vs dealer',
    blurb: 'Get closer to 21 than the dealer without going over. Includes strategy hints.',
    preview: 'AS KH 9D',
    create: (ctx) => new Blackjack(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Beat the dealer by finishing with a hand total <b>closer to 21</b> than theirs — without going over. Going over 21 is a <b>bust</b> and loses immediately.</p>
          <p>You play with chips: you start with <b>1000</b>, and your balance is saved between sessions.</p>`,
      },
      {
        title: 'Card values',
        body: `<ul><li>Number cards are worth their number.</li>
          <li><b>J, Q, K</b> are worth 10.</li>
          <li>An <b>Ace</b> is worth 11 or 1 — whichever helps you more. A hand with an Ace counted as 11 is called <b>soft</b>.</li></ul>
          <div class="example">${m('AS 6H')} <span class="arrow">= soft 17 (or 7)</span></div>
          <div class="example">${m('KC 7D')} <span class="arrow">= hard 17</span></div>`,
      },
      {
        title: 'A round',
        body: `<ol><li>Pick your bet with the chips and tap <b>Deal</b>.</li>
          <li>You get two cards face up. The dealer gets one face up and one face down.</li>
          <li>Decide what to do with your hand (next page).</li>
          <li>The dealer reveals their hidden card and must <b>hit until 17 or more</b>, then stands.</li>
          <li>Higher total wins. Ties are a <b>push</b> — your bet is returned.</li></ol>`,
      },
      {
        title: 'Your choices',
        body: `<ul><li><b>Hit</b> — take another card.</li>
          <li><b>Stand</b> — stop and keep your total.</li>
          <li><b>Double</b> — double your bet, take exactly one more card, then stand. Only on your first two cards.</li>
          <li><b>Split</b> — if your first two cards have the same value, split them into two hands with a bet on each. Split Aces get one card each.</li></ul>`,
      },
      {
        title: 'Blackjack!',
        body: `<p>An Ace plus a 10-value card as your first two cards is a <b>Blackjack</b>, and pays <b>3 to 2</b> (bet 10, win 15).</p>
          <div class="example">${m('AH KS')}</div>
          <p>If the dealer shows an Ace or 10, they check for Blackjack straight away. Normal wins pay 1 to 1.</p>`,
      },
      {
        title: 'Learn the strategy',
        body: `<p>Tap <b>Hint</b> during a hand to see the mathematically best “basic strategy” play for your cards against the dealer's up-card.</p>
          <p class="tip">Rules of thumb: always split Aces and 8s; never split 10s or 5s; stand on 12–16 when the dealer shows 2–6 (they're likely to bust); double on 11.</p>`,
      },
    ],
  });
})();
