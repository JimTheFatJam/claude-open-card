/* War */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const hv = (c) => (c.r === 1 ? 14 : c.r);

  class War {
    constructor(ctx) {
      this.ctx = ctx;
      this.T = ctx.table;
      this.detach = OC.attachInput(this.T, { onTap: (p) => { if (p === 'mine') this.battle(); } });
    }
    destroy() {
      this.auto = false;
      this.detach();
    }
    inProgress() {
      return this.started && !this.over;
    }
    start() {
      this.T.clear();
      const deck = OC.shuffle(OC.makeDeck());
      this.piles = [deck.slice(0, 26), deck.slice(26)];
      this.piles.forEach((p) => p.forEach((c) => (c.up = false)));
      this.table = [[], []];
      this.over = false;
      this.started = false;
      this.busy = false;
      this.auto = false;
      this.rounds = 0;
      this.wars = 0;
      this.msg = 'Tap your deck (or Flip) to play a card';
      this.limit = this.ctx.opts.limit;
      this.ctx.buttons([]);
      this.ui();
      this.render();
    }
    ui() {
      this.ctx.actions([
        { label: 'Flip', primary: true, disabled: this.auto || this.over, onClick: () => this.battle() },
        { label: this.auto ? 'Stop auto' : 'Auto play', onClick: () => this.toggleAuto() },
      ]);
      this.status();
    }
    status() {
      this.ctx.status(`You <b>${this.piles[0].length}</b> &nbsp;·&nbsp; Computer <b>${this.piles[1].length}</b> &nbsp;·&nbsp; Battle <b>${this.rounds}</b>${this.limit ? '/' + this.limit : ''} &nbsp;·&nbsp; Wars <b>${this.wars}</b>`);
    }
    async toggleAuto() {
      this.auto = !this.auto;
      this.ui();
      while (this.auto && !this.over && this.ctx.alive()) {
        if (!this.busy) await this.battle(true);
        await this.ctx.wait(250);
      }
    }
    async battle(fromAuto) {
      if (this.busy || this.over || (this.auto && !fromAuto)) return;
      this.busy = true;
      this.started = true;
      this.rounds++;
      const pot = [];
      const flip = () => {
        for (let p = 0; p < 2; p++) {
          const c = this.piles[p].shift();
          c.up = true;
          this.table[p].push(c);
          pot.push(c);
        }
      };
      flip();
      this.msg = '';
      this.render();
      await this.ctx.wait(this.auto ? 380 : 550);
      let a = this.table[0][this.table[0].length - 1], b = this.table[1][this.table[1].length - 1];
      while (hv(a) === hv(b)) {
        this.wars++;
        this.msg = 'WAR!';
        this.render();
        await this.ctx.wait(650);
        // each player needs at least one card to continue
        if (!this.piles[0].length || !this.piles[1].length) break;
        for (let k = 0; k < 3; k++) {
          for (let p = 0; p < 2; p++) {
            if (this.piles[p].length > 1) {
              const c = this.piles[p].shift();
              c.up = false;
              this.table[p].push(c);
              pot.push(c);
            }
          }
        }
        this.render();
        await this.ctx.wait(450);
        flip();
        this.render();
        await this.ctx.wait(650);
        a = this.table[0][this.table[0].length - 1];
        b = this.table[1][this.table[1].length - 1];
      }
      let winner;
      if (hv(a) === hv(b)) winner = this.piles[0].length >= this.piles[1].length ? 0 : 1;
      else winner = hv(a) > hv(b) ? 0 : 1;
      this.msg = winner === 0 ? `You win ${pot.length} cards` : `Computer wins ${pot.length} cards`;
      this.winner = winner;
      this.collect = winner;
      this.render();
      await this.ctx.wait(this.auto ? 300 : 500);
      OC.shuffle(pot).forEach((c) => {
        c.up = false;
        this.piles[winner].push(c);
      });
      this.table = [[], []];
      this.collect = -1;
      this.busy = false;
      this.render();
      this.status();
      const out = this.piles.findIndex((p) => !p.length);
      const limitHit = this.limit && this.rounds >= this.limit;
      if (out >= 0 || limitHit) {
        this.over = true;
        this.auto = false;
        this.ui();
        const won = limitHit && out < 0 ? this.piles[0].length > this.piles[1].length : out === 1;
        const tie = limitHit && out < 0 && this.piles[0].length === this.piles[1].length;
        await this.ctx.wait(500);
        return this.ctx.finish({
          won,
          record: !tie,
          title: tie ? 'It’s a tie!' : won ? 'You won the war!' : 'The computer won',
          html: `<p>After <b>${this.rounds}</b> battles and <b>${this.wars}</b> wars: you have <b>${this.piles[0].length}</b> cards, the computer has <b>${this.piles[1].length}</b>.</p>`,
        });
      }
      if (!this.auto) this.ui();
    }
    render() {
      const T = this.T;
      const { w, h } = T.size();
      const cw = Math.min(w / 8, (h - 40) / (1.4 * 2.7), 130);
      T.setCardWidth(cw);
      const cx = w / 2;
      const oppY = 16, myY = h - T.ch - 16;
      const deckX = Math.max(14, cx - T.cw * 3.2);
      T.spawn = null;
      T.begin();
      // decks
      T.slot('theirs', deckX, oppY, { pile: '' });
      T.slot('mine', deckX, myY, { pile: 'mine', cls: 'clickable' });
      this.piles[1].forEach((c, i) => T.card(c, deckX - Math.min(i, 12) * 0.5, oppY - Math.min(i, 12) * 0.5, { z: i + 1, pile: '' }));
      this.piles[0].forEach((c, i) => T.card(c, deckX - Math.min(i, 12) * 0.5, myY - Math.min(i, 12) * 0.5, { z: i + 1, pile: 'mine', idx: i }));
      T.label('their', deckX + T.cw + 12, oppY + T.ch / 2 - 12, `<span class="badge">Computer · ${this.piles[1].length}</span>`);
      T.label('mine', deckX + T.cw + 12, myY + T.ch / 2 - 12, `<span class="badge">You · ${this.piles[0].length}</span>`);
      // battle area
      const by = [h / 2 + 8, h / 2 - T.ch - 8];
      for (let p = 0; p < 2; p++) {
        this.table[p].forEach((c, k) => {
          let x = cx - T.cw / 2 + k * T.cw * 0.28, y = by[p];
          if (this.collect === 0 || this.collect === 1) {
            x = deckX;
            y = this.collect === 0 ? myY : oppY;
          }
          T.card(c, x, y, { z: 200 + k, pile: '' });
        });
      }
      if (this.msg) T.label('msg', cx + T.cw * 1.4, h / 2 - 14, `<span class="badge ${this.msg === 'WAR!' ? 'red' : 'gold'}">${this.msg}</span>`, { cls: 'big' });
      T.end();
    }
  }

  OC.registerGame({
    id: 'war',
    name: 'War',
    category: 'Versus Computer',
    players: 'You vs computer',
    blurb: 'Pure luck and great for kids: the higher card takes the battle.',
    preview: 'KC KD AS',
    options: [{ key: 'limit', label: 'Game length', def: 100, choices: [[50, '50 battles'], [100, '100 battles'], [0, 'Until someone has every card']] }],
    create: (ctx) => new War(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>The deck is split evenly between you and the computer. Win <b>all the cards</b> — or have the most cards when the battle limit is reached.</p>`,
      },
      {
        title: 'Battles',
        body: `<p>Tap your deck (or <b>Flip</b>). You and the computer each turn over the top card. The <b>higher card</b> wins both cards. Aces are high.</p>
          <div class="example">${m('QH')} <span class="arrow">beats</span> ${m('9S')}</div>`,
      },
      {
        title: 'War!',
        body: `<p>If the two cards are the <b>same rank</b>, it's <b>war</b>: each player puts down three cards face down, then one more face up. The higher face-up card wins <b>everything</b> on the table.</p>
          <div class="example">${m('7C')} <span class="arrow">vs</span> ${m('7D')} <span class="arrow">→</span> ${m('XX XX XX 10H')}</div>
          <p>If those tie too, war happens again!</p>`,
      },
      {
        title: 'Auto play',
        body: `<p>War is all luck — no decisions to make — so you can tap <b>Auto play</b> and watch it run. Tap <b>Stop auto</b> at any time.</p>
          <p>Choose the game length from the <b>New</b> button.</p>`,
      },
    ],
  });
})();
