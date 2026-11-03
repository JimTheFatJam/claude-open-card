/* Tong-its — the Filipino rummy game for three players (you vs two computer players). */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const m = OC.mini;
  const NAMES = ['You', 'Ava', 'Ben'];
  const pts = (c) => (c.r > 10 ? 10 : c.r);
  const handPts = (h) => h.reduce((a, c) => a + pts(c), 0);

  /* ------------------------------------------------------------------ */
  /* Meld logic                                                          */
  /* ------------------------------------------------------------------ */
  const isSet = (cs) => cs.length >= 3 && cs.length <= 4 && cs.every((c) => c.r === cs[0].r);
  function isRun(cs) {
    if (cs.length < 3 || !cs.every((c) => c.s === cs[0].s)) return false;
    const r = cs.map((c) => c.r).sort((a, b) => a - b);
    for (let i = 1; i < r.length; i++) if (r[i] !== r[i - 1] + 1) return false;
    return true; // Ace is low only: A-2-3 is a run, Q-K-A is not
  }
  const isMeld = (cs) => isSet(cs) || isRun(cs);
  const sortMeld = (cs) => cs.slice().sort((a, b) => a.r - b.r || a.s - b.s);

  /** Every meld that can be made from the given cards. */
  function candidates(hand) {
    const out = [];
    const byRank = {};
    hand.forEach((c) => (byRank[c.r] = byRank[c.r] || []).push(c));
    for (const r in byRank) {
      const g = byRank[r];
      if (g.length === 4) out.push(g.slice());
      if (g.length >= 3) for (let i = 0; i < g.length; i++) out.push(g.filter((_, k) => k !== i || g.length === 3));
    }
    for (let s = 0; s < 4; s++) {
      const suit = hand.filter((c) => c.s === s).sort((a, b) => a.r - b.r);
      for (let i = 0; i < suit.length; i++) {
        const run = [suit[i]];
        for (let j = i + 1; j < suit.length && suit[j].r === run[run.length - 1].r + 1; j++) {
          run.push(suit[j]);
          if (run.length >= 3) out.push(run.slice());
        }
      }
    }
    // remove duplicate sets (a 3-card set is listed once per dropped card)
    const seen = new Set();
    return out.filter((mm) => {
      const k = mm.map((c) => c.id).sort((a, b) => a - b).join(',');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Split a hand into melds so the leftover (deadwood) points are as low as possible. */
  function bestMelds(hand) {
    const cands = candidates(hand);
    let best = { dead: Infinity, melds: [] };
    const used = new Set();
    const rec = (i, melds, dead) => {
      if (dead >= best.dead) return;
      while (i < hand.length && used.has(hand[i].id)) i++;
      if (i === hand.length) {
        best = { dead, melds: melds.slice() };
        return;
      }
      const c = hand[i];
      for (const mm of cands) {
        if (!mm.includes(c) || mm.some((x) => used.has(x.id))) continue;
        mm.forEach((x) => used.add(x.id));
        melds.push(mm);
        rec(i + 1, melds, dead);
        melds.pop();
        mm.forEach((x) => used.delete(x.id));
      }
      used.add(c.id);
      rec(i + 1, melds, dead + pts(c));
      used.delete(c.id);
    };
    rec(0, [], 0);
    return best;
  }

  /** Largest meld that uses `card` together with cards from `hand`. */
  function meldWith(hand, card) {
    const opts = candidates(hand.concat([card])).filter((mm) => mm.includes(card));
    opts.sort((a, b) => handPts(b) - handPts(a) || b.length - a.length);
    return opts[0] || null;
  }

  class Tongits {
    constructor(ctx) {
      this.ctx = ctx;
      this.T = ctx.table;
      this.tally = [0, 0, 0];
      this.dealer = 0;
      this.sortBy = 'suit';
      this.detach = OC.attachInput(this.T, { onTap: (p, i) => this.tap(p, i) });
    }
    destroy() {
      this.detach();
    }
    inProgress() {
      return this.started && !this.over;
    }
    progressText() {
      return `wins ${this.tally.join('-')} (You-Ava-Ben) \u00b7 ${this.players[0].hand.length} cards in hand`;
    }

    /* ----- setup ----- */
    start() {
      this.T.clear();
      const deck = OC.shuffle(OC.makeDeck());
      this.players = NAMES.map((name, i) => ({ i, name, hand: [], blocked: false, said: '', status: '' }));
      for (let k = 0; k < 12; k++) for (let p = 0; p < 3; p++) this.players[p].hand.push(deck.pop());
      this.players[this.dealer].hand.push(deck.pop()); // dealer gets 13
      this.players.forEach((P) => P.hand.forEach((c) => (c.up = P.i === 0)));
      this.stock = deck;
      this.discard = [];
      this.melds = [];
      this.sel = new Set();
      this.over = false;
      this.started = false;
      this.busy = false;
      this.turn = this.dealer;
      this.sortMine();
      this.ctx.buttons([
        { label: 'Hint', onClick: () => this.hint() },
        { label: 'Sort', onClick: () => { this.sortBy = this.sortBy === 'suit' ? 'rank' : 'suit'; this.sortMine(); this.render(); } },
      ]);
      this.render();
      this.beginTurn(true);
    }
    sortMine() {
      const h = this.players[0].hand;
      if (this.sortBy === 'suit') h.sort((a, b) => [0, 1, 3, 2].indexOf(a.s) - [0, 1, 3, 2].indexOf(b.s) || a.r - b.r);
      else h.sort((a, b) => a.r - b.r || a.s - b.s);
    }
    ownMelds(p) {
      return this.melds.filter((mm) => mm.owner === p);
    }
    canCallDraw(p) {
      return this.ownMelds(p).length > 0 && !this.players[p].blocked;
    }
    status() {
      const me = this.players[0];
      this.ctx.status(`Stock <b>${this.stock.length}</b> &nbsp;\u00b7&nbsp; Points <b>${handPts(me.hand)}</b> &nbsp;\u00b7&nbsp; Wins (You-Ava-Ben) <b>${this.tally.join('-')}</b>`);
    }

    /* ----- turn flow ----- */
    async beginTurn(first) {
      if (this.over) return;
      const p = this.turn;
      this.phase = first ? 'play' : 'start';
      this.sel.clear();
      this.status();
      this.render();
      if (p === 0) return this.humanUI();
      this.busy = true;
      this.ctx.actions([{ html: `${NAMES[p]} is thinking…` }]);
      await this.ctx.wait(800);
      this.aiTurn(p, first);
    }
    async endTurn() {
      const p = this.turn;
      this.players[p].blocked = false;
      if (!this.players[p].hand.length) return this.tongits(p);
      if (!this.stock.length) return this.stockOut(p);
      this.turn = (p + 1) % 3;
      await this.ctx.wait(300);
      this.beginTurn(false);
    }

    /* ----- shared actions ----- */
    drawStock(p) {
      const c = this.stock.pop();
      c.up = p === 0;
      this.players[p].hand.push(c);
      if (p === 0) this.sortMine();
      this.phase = 'play';
      this.started = true;
      return c;
    }
    takeDiscard(p, meldCards) {
      const c = this.discard.pop();
      const P = this.players[p];
      c.up = true;
      P.hand.push(c);
      this.expose(p, meldCards);
      this.phase = 'play';
      this.started = true;
      return c;
    }
    expose(p, cards) {
      const P = this.players[p];
      cards.forEach((c) => {
        P.hand.splice(P.hand.indexOf(c), 1);
        c.up = true;
      });
      this.melds.push({ id: this.melds.length ? Math.max(...this.melds.map((x) => x.id)) + 1 : 0, owner: p, cards: sortMeld(cards) });
    }
    layOff(p, cards, meld) {
      const P = this.players[p];
      cards.forEach((c) => {
        P.hand.splice(P.hand.indexOf(c), 1);
        c.up = true;
      });
      meld.cards = sortMeld(meld.cards.concat(cards));
      if (meld.owner !== p) this.players[meld.owner].blocked = true; // "sapaw" blocks that player's next Draw call
    }
    doDiscard(p, c) {
      const P = this.players[p];
      P.hand.splice(P.hand.indexOf(c), 1);
      c.up = true;
      this.discard.push(c);
    }

    /* ----- human ----- */
    humanUI() {
      this.busy = false;
      const me = this.players[0];
      const top = this.discard[this.discard.length - 1];
      if (this.phase === 'start') {
        const canTake = top && meldWith(me.hand, top);
        const acts = [
          { label: 'Draw from stock', primary: true, onClick: () => this.humanDraw() },
          { label: 'Take discard', disabled: !canTake, onClick: () => this.humanTake() },
        ];
        if (this.canCallDraw(0)) acts.push({ label: 'Call Draw (Laban)', cls: 'danger', onClick: () => this.callDraw(0) });
        else if (this.ownMelds(0).length && me.blocked) acts.push({ html: 'Blocked from calling Draw this turn (sapaw)' });
        this.ctx.actions(acts);
      } else {
        const selCards = me.hand.filter((c) => this.sel.has(c.id));
        const meldOk = selCards.length >= 3 && isMeld(selCards);
        const layTarget = selCards.length ? this.layTargetFor(selCards, 0) : null;
        this.ctx.actions([
          { label: 'Meld', primary: meldOk, disabled: !meldOk, onClick: () => this.humanMeld() },
          { label: 'Lay off', disabled: !layTarget, onClick: () => this.humanLay(layTarget) },
          { label: 'Discard', primary: selCards.length === 1 && !meldOk, disabled: selCards.length !== 1, onClick: () => this.humanDiscard() },
          { html: selCards.length ? `${selCards.length} selected` : this.firstTurnNote() },
        ]);
      }
      this.status();
      this.render();
    }
    firstTurnNote() {
      return this.discard.length === 0 && this.turn === 0 ? 'You’re the dealer: meld if you can, then discard' : 'Select cards to meld, lay off or discard';
    }
    layTargetFor(cards, p) {
      const opts = this.melds.filter((mm) => isMeld(mm.cards.concat(cards)));
      return opts.find((mm) => mm.owner === p) || opts[0] || null;
    }
    tap(p, i) {
      if (this.over || this.busy || this.turn !== 0) return;
      if (p === 'h') {
        const c = this.players[0].hand[i];
        if (!c) return;
        if (this.sel.has(c.id)) this.sel.delete(c.id); else this.sel.add(c.id);
        this.humanUI();
      } else if (p === 'stock' && this.phase === 'start') this.humanDraw();
      else if (p === 'discard' && this.phase === 'start') this.humanTake();
      else if (p && p[0] === 'm' && this.phase === 'play') {
        const meld = this.melds.find((x) => x.id === +p.slice(1));
        const cards = this.players[0].hand.filter((c) => this.sel.has(c.id));
        if (!cards.length) return this.ctx.toast('Select card(s) from your hand first, then tap a meld to lay them off');
        if (!isMeld(meld.cards.concat(cards))) return this.ctx.toast('Those cards don’t fit that meld');
        this.humanLay(meld);
      }
    }
    humanDraw() {
      if (this.phase !== 'start' || this.busy) return;
      const c = this.drawStock(0);
      this.ctx.toast('You drew the ' + OC.cardName(c), 1300);
      this.humanUI();
    }
    humanTake() {
      if (this.phase !== 'start' || this.busy) return;
      const me = this.players[0];
      const top = this.discard[this.discard.length - 1];
      if (!top) return;
      const selCards = me.hand.filter((c) => this.sel.has(c.id));
      let meld = selCards.length >= 2 && isMeld(selCards.concat([top])) ? selCards.concat([top]) : meldWith(me.hand, top);
      if (!meld) return this.ctx.toast('You can only take the discard if it makes a meld with cards in your hand');
      this.takeDiscard(0, meld);
      this.sel.clear();
      this.ctx.toast('You took the ' + OC.cardName(top) + ' and melded it', 1500);
      if (!me.hand.length) return this.endTurn();
      this.humanUI();
    }
    humanMeld() {
      const me = this.players[0];
      const cards = me.hand.filter((c) => this.sel.has(c.id));
      if (!isMeld(cards)) return;
      this.expose(0, cards);
      this.sel.clear();
      if (!me.hand.length) return this.endTurn();
      this.humanUI();
    }
    humanLay(meld) {
      const me = this.players[0];
      const cards = me.hand.filter((c) => this.sel.has(c.id));
      if (!meld || !cards.length) return;
      this.layOff(0, cards, meld);
      this.sel.clear();
      if (meld.owner !== 0) this.ctx.toast(`Sapaw! ${NAMES[meld.owner]} can't call Draw next turn`, 1600);
      if (!me.hand.length) return this.endTurn();
      this.humanUI();
    }
    humanDiscard() {
      const me = this.players[0];
      const cards = me.hand.filter((c) => this.sel.has(c.id));
      if (cards.length !== 1) return;
      this.busy = true;
      this.ctx.actions([]);
      this.doDiscard(0, cards[0]);
      this.sel.clear();
      this.render();
      this.endTurn();
    }

    /* ----- computer ----- */
    async aiTurn(p, first) {
      const P = this.players[p];
      const say = (t) => { P.said = t; this.render(); };
      if (!first) {
        if (this.canCallDraw(p) && this.aiWantsDraw(p)) return this.callDraw(p);
        const top = this.discard[this.discard.length - 1];
        const mm = top && meldWith(P.hand, top);
        if (mm) {
          this.takeDiscard(p, mm);
          say('Took the ' + OC.cardShort(top) + '!');
        } else {
          this.drawStock(p);
          say('Drew from stock');
        }
        this.status();
        await this.ctx.wait(700);
        if (!P.hand.length) return this.endTurn();
      }
      // expose every meld that lowers the hand
      const b = bestMelds(P.hand);
      for (const mm of b.melds) {
        this.expose(p, mm);
        say('Meld!');
        await this.ctx.wait(600);
        if (!P.hand.length) return this.endTurn();
      }
      // lay off onto any meld (sapaw)
      let laid = true;
      while (laid && P.hand.length) {
        laid = false;
        for (const c of P.hand.slice()) {
          const target = this.layTargetFor([c], p);
          if (target) {
            this.layOff(p, [c], target);
            say(target.owner === p ? 'Laid off' : `Sapaw on ${target.owner === 0 ? 'you' : NAMES[target.owner]}!`);
            laid = true;
            await this.ctx.wait(550);
            break;
          }
        }
      }
      if (!P.hand.length) return this.endTurn();
      const c = this.aiDiscardChoice(P.hand);
      this.doDiscard(p, c);
      say('Discarded ' + OC.cardShort(c));
      this.status();
      await this.ctx.wait(400);
      this.endTurn();
    }
    aiDiscardChoice(hand) {
      const keepScore = (c) => {
        let s = 0;
        for (const o of hand) {
          if (o === c) continue;
          if (o.r === c.r) s += 7;
          if (o.s === c.s && Math.abs(o.r - c.r) <= 2) s += Math.abs(o.r - c.r) === 1 ? 5 : 3;
        }
        // cards that fit a meld on the table can be laid off later
        if (this.melds.some((mm) => isMeld(mm.cards.concat([c])))) s += 6;
        return s;
      };
      return hand.slice().sort((a, b) => pts(b) - keepScore(b) - (pts(a) - keepScore(a)))[0];
    }
    aiWantsDraw(p) {
      const h = handPts(this.players[p].hand);
      const limit = this.stock.length < 8 ? 12 : 8;
      return h <= limit;
    }

    /* ----- Draw (Laban) ----- */
    async callDraw(caller) {
      this.busy = true;
      this.ctx.actions([]);
      this.players[caller].said = 'Calls DRAW!';
      this.render();
      this.ctx.toast(`${NAMES[caller] === 'You' ? 'You call' : NAMES[caller] + ' calls'} Draw (Laban)!`, 1800);
      await this.ctx.wait(900);
      const fighters = [caller];
      for (let k = 1; k <= 2; k++) {
        const p = (caller + k) % 3;
        const P = this.players[p];
        if (!this.ownMelds(p).length) {
          P.said = 'Can’t fight (no melds)';
          P.status = 'Burned';
          continue;
        }
        let fight;
        if (p === 0) {
          fight = await this.ctx.dialog({
            title: `${NAMES[caller]} called Draw!`,
            html: `<p>Your hand is worth <b>${handPts(this.players[0].hand)}</b> points. If you <b>fight</b>, the lowest hand wins (the caller wins ties). If you <b>fold</b>, you're out of this round.</p>`,
            buttons: [{ label: 'Fold', value: false }, { label: 'Fight!', value: true, primary: true }],
            dismissible: false,
          });
          if (!this.ctx.alive()) return;
        } else {
          fight = handPts(P.hand) <= 9 + OC.rand(4);
        }
        P.said = fight ? 'Fight!' : 'Fold';
        P.status = fight ? '' : 'Folded';
        if (fight) fighters.push(p);
        this.render();
        await this.ctx.wait(700);
      }
      this.showdown(fighters, 'draw', caller);
    }

    /* ----- round end ----- */
    tongits(p) {
      this.finishRound(p, `${p === 0 ? 'You' : NAMES[p]} got <b>Tong-its</b> — no cards left!`);
    }
    stockOut(last) {
      const order = [last, (last + 1) % 3, (last + 2) % 3];
      let eligible = order.filter((p) => this.ownMelds(p).length);
      order.forEach((p) => { if (!this.ownMelds(p).length) this.players[p].status = 'Burned'; });
      if (!eligible.length) eligible = order;
      this.showdown(eligible, 'stock', last);
    }
    showdown(contenders, why, first) {
      // contenders are in priority order (first wins ties)
      let w = contenders[0];
      for (const p of contenders) if (handPts(this.players[p].hand) < handPts(this.players[w].hand)) w = p;
      const msg = why === 'draw'
        ? (contenders.length === 1 ? `Nobody fought the Draw.` : `Showdown after ${NAMES[first] === 'You' ? 'your' : NAMES[first] + '’s'} Draw call.`)
        : 'The stock ran out — lowest hand wins. Players with no melds are burned.';
      this.finishRound(w, msg);
    }
    async finishRound(w, msg) {
      this.over = true;
      this.busy = true;
      this.turn = -1;
      this.ctx.actions([]);
      this.players.forEach((P) => P.hand.forEach((c) => (c.up = true)));
      this.players[w].status = 'Winner';
      this.tally[w]++;
      this.dealer = w; // winner deals next round
      this.status();
      this.render();
      await this.ctx.wait(1500);
      const rows = this.players.map((P, k) => `<tr class="${k === 0 ? 'me' : ''}"><td>${P.name}</td><td>${handPts(P.hand)}</td><td>${this.ownMelds(k).length}</td><td>${P.status || ''}</td></tr>`).join('');
      this.ctx.finish({
        won: w === 0,
        title: w === 0 ? 'You won the round!' : `${NAMES[w]} wins the round`,
        html: `<p>${msg}</p><table class="score-table"><tr><th>Player</th><th>Points in hand</th><th>Melds</th><th></th></tr>${rows}</table>
          <p class="note">Rounds won this session — ${NAMES.map((n, k) => `${n}: ${this.tally[k]}`).join(', ')}. The winner deals next.</p>`,
      });
    }

    /* ----- hints ----- */
    hint() {
      if (this.over || this.turn !== 0 || this.busy) return this.ctx.toast('Wait for your turn');
      const me = this.players[0];
      if (this.phase === 'start') {
        const top = this.discard[this.discard.length - 1];
        if (this.canCallDraw(0) && handPts(me.hand) <= 8) return this.ctx.toast(`Your hand is only ${handPts(me.hand)} points — calling Draw is a good idea`, 2600);
        const mm = top && meldWith(me.hand, top);
        if (mm) {
          this.flash(mm.filter((c) => c !== top));
          return this.ctx.toast(`Take the ${OC.cardName(top)} — it makes a meld with the highlighted cards`, 2600);
        }
        return this.ctx.toast('Nothing to take from the discard pile — draw from the stock', 2200);
      }
      const b = bestMelds(me.hand);
      if (b.melds.length) {
        this.sel = new Set(b.melds[0].map((c) => c.id));
        this.humanUI();
        return this.ctx.toast('These cards form a meld — tap Meld', 2200);
      }
      for (const c of me.hand) {
        const t = this.layTargetFor([c], 0);
        if (t) {
          this.sel = new Set([c.id]);
          this.humanUI();
          return this.ctx.toast(`Lay off the ${OC.cardName(c)} onto ${t.owner === 0 ? 'your' : NAMES[t.owner] + '’s'} meld`, 2400);
        }
      }
      const c = this.aiDiscardChoice(me.hand);
      this.sel = new Set([c.id]);
      this.humanUI();
      this.ctx.toast(`Discard the ${OC.cardName(c)}: high points and no meld potential`, 2400);
    }
    flash(cards) {
      this.flashIds = new Set(cards.map((c) => c.id));
      this.render();
      setTimeout(() => { this.flashIds = null; this.ctx.alive() && this.render(); }, 2200);
    }

    /* ----- drawing ----- */
    render() {
      const T = this.T;
      const { w, h } = T.size();
      const portrait = h > w * 1.1;
      const cw = portrait ? Math.min(w / 8.6, h / (1.4 * 6.2), 110) : Math.min(w / 12.5, (h - 20) / (1.4 * 4.3), 96);
      T.setCardWidth(cw);
      const fan = T.cw * 0.3;
      const myTurn = this.turn === 0 && !this.busy && !this.over;
      const me = this.players[0];
      T.spawn = { x: w / 2 - T.cw - 10, y: 12 };
      T.begin();
      // stock & discard (top centre)
      const sx = w / 2 - T.cw - 10, dx = w / 2 + 10, sy = 12;
      T.slot('stock', sx, sy, { pile: 'stock', label: '', cls: 'clickable' });
      this.stock.forEach((c, i) => T.card(c, sx - Math.min(i, 8) * 0.6, sy - Math.min(i, 8) * 0.6, { z: i + 1, pile: 'stock', idx: i }));
      T.label('stockn', sx, sy + T.ch + 4, `<span class="badge">Stock ${this.stock.length}</span>`, { w: T.cw, align: 'center' });
      T.slot('discard', dx, sy, { pile: 'discard', label: '', cls: 'clickable' });
      this.discard.forEach((c, i) => T.card(c, dx, sy, { z: i + 1, pile: 'discard', idx: i, cls: i === this.discard.length - 1 && myTurn && this.phase === 'start' && meldWith(me.hand, c) ? 'glow' : '' }));
      // melds
      const meldW = (mm) => T.cw + fan * (mm.cards.length - 1);
      const selCards = me.hand.filter((c) => this.sel.has(c.id));
      const drawMeld = (mm, x, y, z) => {
        const fits = myTurn && this.phase === 'play' && selCards.length && isMeld(mm.cards.concat(selCards));
        mm.cards.forEach((c, k) => T.card(c, x + k * fan, y, { z: z + k, pile: 'm' + mm.id, idx: k, cls: fits ? 'glow' : '' }));
      };
      /** Lay melds out left-to-right in rows of width areaW; rightAlign mirrors them. */
      const flow = (melds, x0, y0, areaW, rowH, rightAlign, z0, upward) => {
        let x = 0, y = y0;
        melds.forEach((mm, k) => {
          const mw = meldW(mm);
          if (x > 0 && x + mw > areaW) { x = 0; y += upward ? -rowH : rowH; }
          drawMeld(mm, rightAlign ? x0 + areaW - x - mw : x0 + x, y, z0 + k * 20);
          x += mw + 12;
        });
      };
      // opponents: 1 on the left, 2 on the right
      const handH = portrait ? T.ch * 1.5 : h * 0.45;
      let lowest = sy + T.ch + 30;
      [1, 2].forEach((p) => {
        const P = this.players[p];
        const left = p === 1;
        const hx = left ? 10 : w - T.cw - 10;
        const step = OC.fanStep(P.hand.length, T.ch, handH, T.ch * 0.14);
        P.hand.forEach((c, k) => T.card(c, hx, 12 + k * step, { z: k + 1, pile: '' }));
        const handBottom = 12 + step * Math.max(0, P.hand.length - 1) + T.ch;
        const bubble = P.said ? `<br><span class="badge" style="background:#fff;color:#222;text-shadow:none">${OC.esc(P.said)}</span>` : '';
        const st = P.status ? ` <span class="badge ${P.status === 'Winner' ? 'gold' : 'red'}">${P.status}</span>` : '';
        const blk = P.blocked && !this.over ? ' <span class="badge">blocked</span>' : '';
        T.label('n' + p, left ? 8 : w - 228, handBottom + 6, `<span class="badge">${P.name} · ${P.hand.length} cards${this.over ? ' · ' + handPts(P.hand) + ' pts' : ''}</span>${st}${blk}${bubble}`, { w: 220, align: left ? 'left' : 'right', cls: this.turn === p ? 'turn' : '' });
        lowest = Math.max(lowest, handBottom + 64);
        if (!portrait) {
          // landscape: melds in rows beside their hand
          const areaW = w / 2 - 2 * T.cw - 44;
          flow(this.ownMelds(p), left ? T.cw + 24 : w / 2 + T.cw + 20, 12, areaW, T.ch * 0.56, !left, 100);
        }
      });
      if (portrait) {
        // portrait: each opponent's melds in their half of the table, below the top row
        [1, 2].forEach((p) => flow(this.ownMelds(p), p === 1 ? 10 : w / 2 + 6, lowest, w / 2 - 16, T.ch * 0.6, p === 2, 100));
      }
      // my hand
      const hy = h - T.ch - 12;
      const step = OC.fanStep(me.hand.length, T.cw, w - 24, T.cw * 0.62);
      const hw = T.cw + step * Math.max(0, me.hand.length - 1);
      const hx = (w - hw) / 2;
      me.hand.forEach((c, i) => {
        const sel = this.sel.has(c.id);
        const fl = this.flashIds && this.flashIds.has(c.id);
        T.card(c, hx + i * step, hy - (sel ? 18 : 0), { z: 200 + i, pile: 'h', idx: i, cls: sel ? 'sel' : fl ? 'glow' : '' });
      });
      // my melds: rows above my hand, wrapping upwards
      const mine = this.ownMelds(0);
      const total = mine.reduce((a, mm) => a + meldW(mm) + 12, -12);
      const areaW = Math.min(w - 20, Math.max(total, 0));
      flow(mine, (w - areaW) / 2, hy - T.ch - 34, areaW + 1, T.ch * 0.6, false, 150, true);
      const st = me.status ? ` <span class="badge ${me.status === 'Winner' ? 'gold' : 'red'}">${me.status}</span>` : '';
      const blk = me.blocked && !this.over ? ' <span class="badge">blocked</span>' : '';
      const said = me.said ? ` <span class="badge" style="background:#fff;color:#222;text-shadow:none">${OC.esc(me.said)}</span>` : '';
      T.label('me', 0, hy - 30, `<span class="badge">You · ${handPts(me.hand)} pts</span>${st}${blk}${said}`, { w, align: 'center', cls: this.turn === 0 && !this.over ? 'turn' : '' });
      T.end();
    }
  }

  OC.registerGame({
    id: 'tongits',
    name: 'Tong-its',
    category: 'Versus Computer',
    players: 'You + 2 computer players',
    blurb: 'The Filipino rummy favourite: build melds, sapaw, and call Draw to win.',
    preview: '7H 8H 9H',
    create: (ctx) => new Tongits(ctx),
    tutorial: [
      {
        title: 'The goal',
        body: `<p>Tong-its is a three-player rummy game from the Philippines. Get rid of your cards by forming <b>melds</b>, and finish with the <b>lowest points</b> in your hand — or no cards at all!</p>
          <p>Card points: <b>Ace = 1</b>, number cards = their number, <b>J, Q, K = 10</b>.</p>
          <p>The dealer gets 13 cards and the other two players get 12. The rest form the <b>stock</b>.</p>`,
      },
      {
        title: 'Melds',
        body: `<p>A meld is either:</p>
          <ul><li>a <b>set</b>: 3 or 4 cards of the same rank</li></ul>
          <div class="example">${m('8S 8H 8C')}</div>
          <ul><li>a <b>run</b>: 3 or more cards in a row, all the same suit. Aces are low only (A-2-3 is fine, Q-K-A is not).</li></ul>
          <div class="example">${m('4D 5D 6D 7D')}</div>`,
      },
      {
        title: 'Your turn',
        body: `<ol><li><b>Draw</b> one card from the stock <i>or</i> take the top card of the discard pile. You may only take the discard if it <b>immediately makes a meld</b> with cards in your hand (it's laid down straight away).</li>
          <li><b>Meld</b>: select 3+ cards that form a meld and tap <b>Meld</b> to lay them face up.</li>
          <li><b>Lay off (sapaw)</b>: add cards to any meld on the table — yours or an opponent's. Select the card(s), then tap the meld (it glows when it fits) or tap <b>Lay off</b>.</li>
          <li><b>Discard</b> one card to end your turn.</li></ol>
          <p>The dealer skips step 1 on the very first turn.</p>`,
      },
      {
        title: 'Three ways to win',
        body: `<ul><li><b>Tong-its</b>: get rid of every card in your hand. You win instantly.</li>
          <li><b>Call Draw (Laban)</b>: at the start of your turn, before drawing, if you have at least one meld on the table you can call Draw. The others may <b>fight</b> (if they have a meld) or <b>fold</b>. Lowest hand points wins; the caller wins ties.</li>
          <li><b>Stock runs out</b>: after the last stock card is played, everyone counts their hand. Lowest points wins — but players with <b>no melds are “burned”</b> and can't win.</li></ul>`,
      },
      {
        title: 'Sapaw blocks a Draw',
        body: `<p>If someone lays off cards on <b>your</b> meld, you're <b>blocked</b> from calling Draw on your next turn. You can do the same to opponents who look ready to call!</p>
          <p class="tip">Tips: lay down melds early so you can't be burned; throw away high cards (J, Q, K) you can't use; watch what opponents pick up; and call Draw when your hand is small and nobody has blocked you.</p>`,
      },
      {
        title: 'Controls',
        body: `<ul><li>Tap cards in your hand to select them (they lift up).</li>
          <li>Use the buttons at the bottom: <b>Meld</b>, <b>Lay off</b>, <b>Discard</b>.</li>
          <li>The discard pile glows when you can take it.</li>
          <li><b>Sort</b> switches your hand between suit and rank order.</li>
          <li><b>Hint</b> suggests a good move.</li></ul>
          <p>The winner of each round deals the next one.</p>`,
      },
    ],
  });
})();
