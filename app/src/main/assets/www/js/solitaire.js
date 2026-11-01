/* Shared base for solitaire games: undo, timer, move counter, hints, auto-play, input wiring. */
(function () {
  'use strict';
  const OC = window.OpenCard;

  OC.pileOf = (p) => {
    const m = /^([a-z]+)(\d*)$/.exec(p || '');
    return m ? { t: m[1], n: m[2] === '' ? -1 : +m[2] } : { t: '', n: -1 };
  };

  class Solitaire {
    constructor(ctx) {
      this.ctx = ctx;
      this.table = ctx.table;
      this.history = [];
      this.hintIds = new Set();
      this.hintSlot = null;
      this.busy = false;
      this.detach = OC.attachInput(this.table, {
        canDrag: (p, i) => (this.busy || this.over ? null : this.canDrag(p, i)),
        onDrop: (p, i, d) => {
          if (this.busy || this.over) return false;
          const ok = this.drop(p, i, d);
          if (ok) this.commit(); else this.render();
          return ok;
        },
        onTap: (p, i) => {
          if (this.busy || this.over || p === null) return;
          this.clearHint();
          const r = this.tap(p, i);
          if (r === true) this.commit();
          else if (r === 'render') this.render();
        },
        onDragCancel: () => this.render(),
      });
    }

    /* ----- lifecycle ----- */
    start() {
      this.history = [];
      this.moves = 0;
      this.over = false;
      this.busy = false;
      this.elapsed = 0;
      this.t0 = 0;
      this.clearHint(true);
      clearInterval(this.timer);
      this.timer = null;
      this.table.clear();
      this.deal();
      this.ctx.buttons([
        { label: '↶ Undo', title: 'Undo', onClick: () => this.undo() },
        { label: 'Hint', onClick: () => this.hint() },
      ]);
      this.ctx.actions([]);
      this.render();
      this.updateStatus();
    }
    destroy() {
      clearInterval(this.timer);
      this.detach();
    }
    inProgress() {
      return this.moves > 0 && !this.over;
    }

    /* ----- moves ----- */
    snapshot() {
      this.history.push(OC.clone(this.s));
      if (this.history.length > 800) this.history.shift();
    }
    commit() {
      this.moves++;
      if (!this.timer) {
        this.t0 = Date.now() - this.elapsed * 1000;
        this.timer = setInterval(() => this.updateStatus(), 1000);
      }
      this.render();
      this.updateStatus();
      this.afterMove();
    }
    undo() {
      if (this.busy || this.over || !this.history.length) {
        if (!this.history.length) this.ctx.toast('Nothing to undo');
        return;
      }
      this.clearHint();
      this.s = this.history.pop();
      this.moves++;
      this.render();
      this.updateStatus();
    }
    async afterMove() {
      if (this.isWon()) return this.won();
      if (OC.settings.autoFoundation && this.safeAuto) {
        this.busy = true;
        let m;
        while (this.ctx.alive() && (m = this.safeAuto())) {
          await this.ctx.wait(140);
          m();
          this.render();
          if (this.isWon()) {
            this.busy = false;
            return this.won();
          }
        }
        this.busy = false;
      }
      if (this.onSettled) this.onSettled();
    }
    won() {
      this.over = true;
      clearInterval(this.timer);
      this.updateStatus();
      this.render();
      setTimeout(() => {
        if (!this.ctx.alive()) return;
        this.ctx.finish({
          won: true,
          title: 'Solved!',
          html: `<p>You finished ${this.ctx.def.name} in <b>${this.moves}</b> moves and <b>${this.fmtTime()}</b>.</p>`,
        });
      }, 700);
    }

    /* ----- status ----- */
    fmtTime() {
      const t = this.timer ? Math.floor((Date.now() - this.t0) / 1000) : this.elapsed;
      this.elapsed = t;
      return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    }
    updateStatus() {
      const extra = this.extraStatus ? this.extraStatus() : '';
      this.ctx.status(`Moves <b>${this.moves}</b> &nbsp;·&nbsp; Time <b>${this.fmtTime()}</b>${extra ? ' &nbsp;·&nbsp; ' + extra : ''}`);
    }

    /* ----- hints ----- */
    hint() {
      if (this.busy || this.over) return;
      const h = this.findHint();
      if (!h) {
        this.ctx.toast(this.noHintText ? this.noHintText() : 'No moves found — try Undo or start a new game');
        return;
      }
      this.clearHint(true);
      (h.cards || []).forEach((c) => this.hintIds.add(c.id));
      this.hintSlot = h.slot || null;
      if (h.text) this.ctx.toast(h.text, 2400);
      this.render();
      this.hintTimer = setTimeout(() => this.clearHint(), 2300);
    }
    clearHint(silent) {
      clearTimeout(this.hintTimer);
      if (!this.hintIds.size && !this.hintSlot) return;
      this.hintIds.clear();
      this.hintSlot = null;
      if (!silent) this.render();
    }
    cls(c, base = '') {
      return this.hintIds.has(c.id) ? base + ' hint' : base;
    }
    slotCls(key, base = '') {
      return this.hintSlot === key ? base + ' hint' : base;
    }
  }
  OC.Solitaire = Solitaire;

  /** Compute vertical fan offsets so a column fits in `avail` pixels. */
  OC.fanOffsets = function (cards, ch, avail, downGap = 0.13, upGap = 0.28) {
    let down = ch * downGap, up = ch * upGap;
    const nDown = cards.filter((c, i) => !c.up && i < cards.length - 1).length;
    const nUp = Math.max(0, cards.length - 1 - nDown);
    const need = nDown * down + nUp * up;
    const room = avail - ch;
    if (need > room && need > 0) {
      const k = Math.max(room, 0) / need;
      down *= k;
      up *= k;
      down = Math.max(down, ch * 0.04);
      up = Math.max(up, ch * 0.1);
    }
    const ys = [];
    let y = 0;
    for (let i = 0; i < cards.length; i++) {
      ys.push(y);
      y += cards[i].up ? up : down;
    }
    return ys;
  };
})();
