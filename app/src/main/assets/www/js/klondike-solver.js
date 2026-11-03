/* Klondike solver: depth-first search over a compact game state.
   Used to deal only winnable games and to give hints that lead to a win.
   It "peeks" at face-down cards (like a thoughtful-solitaire solver), so a found
   solution is a real winning line for this exact deal. */
(function (root) {
  'use strict';

  // card code: suit * 13 + (rank - 1); suits 0 spades, 1 hearts, 2 diamonds, 3 clubs
  const rank = (c) => (c % 13) + 1;
  const suit = (c) => Math.floor(c / 13);
  const red = (c) => { const s = suit(c); return s === 1 || s === 2; };
  const fitsOn = (c, under) => red(c) !== red(under) && rank(under) === rank(c) + 1;

  /**
   * state: { cols: [[codes]], down: [n], f: [4 counts by suit], T: [codes in draw order], k }
   * T[0..k-1] is the waste (T[k-1] on top), T[k..] the stock (T[k] drawn next).
   */
  function clone(s) {
    return { cols: s.cols.map((c) => c.slice()), down: s.down.slice(), f: s.f.slice(), T: s.T.slice(), k: s.k };
  }
  function key(s) {
    // columns are sorted so mirror-image positions are only searched once
    const cols = s.cols.map((c, i) => c.join(',') + '/' + s.down[i]).sort().join('|');
    return cols + '#' + s.f.join(',') + '#' + s.T.join(',') + ':' + s.k;
  }
  const won = (s) => s.f[0] === 13 && s.f[1] === 13 && s.f[2] === 13 && s.f[3] === 13;

  /** Positions p (1-based) whose card T[p-1] can become the top of the waste by drawing/recycling. */
  function reachable(s, draw) {
    const len = s.T.length;
    if (!len) return [];
    if (draw === 1) {
      const out = [];
      for (let p = 1; p <= len; p++) out.push(p);
      return out;
    }
    const seen = new Set();
    let k = s.k;
    if (k > 0) seen.add(k);
    for (let i = 0; i < 2 * (Math.ceil(len / draw) + 2); i++) {
      if (k === len) k = 0;
      else k = Math.min(k + draw, len);
      if (k > 0) seen.add(k);
    }
    return [...seen];
  }

  const canHome = (s, c) => s.f[suit(c)] === rank(c) - 1;
  const safeHome = (s, c) => {
    if (!canHome(s, c)) return false;
    const r = rank(c);
    if (r <= 2) return true;
    const opp = red(c) ? [0, 3] : [1, 2];
    return s.f[opp[0]] >= r - 1 && s.f[opp[1]] >= r - 1;
  };
  function flip(s, i) {
    if (s.down[i] > 0 && s.down[i] === s.cols[i].length) s.down[i]--;
  }

  /** Apply all "safe" foundation moves from tableau tops (they never hurt). Returns the moves made. */
  function autoSafe(s) {
    const made = [];
    let again = true;
    while (again) {
      again = false;
      for (let i = 0; i < 7; i++) {
        const col = s.cols[i];
        if (col.length > s.down[i] && safeHome(s, col[col.length - 1])) {
          const c = col.pop();
          s.f[suit(c)]++;
          flip(s, i);
          made.push({ t: 'tf', from: i, card: c });
          again = true;
        }
      }
    }
    return made;
  }

  /** Candidate moves, most promising first. */
  function moves(s, draw) {
    const out = [];
    const reach = reachable(s, draw);
    const talon = reach.map((p) => ({ p, c: s.T[p - 1] }));
    const kingAvail = talon.some((x) => rank(x.c) === 13) ||
      s.cols.some((col, i) => col.some((c, j) => j >= s.down[i] && j > 0 && rank(c) === 13));
    // 1. tableau top to foundation
    for (let i = 0; i < 7; i++) {
      const col = s.cols[i];
      if (col.length > s.down[i] && canHome(s, col[col.length - 1])) out.push({ t: 'tf', from: i, card: col[col.length - 1] });
    }
    // 2. tableau runs that reveal a card / free a column / open a useful spot
    for (let i = 0; i < 7; i++) {
      const col = s.cols[i];
      for (let j = s.down[i]; j < col.length; j++) {
        const c = col[j];
        const reveals = j === s.down[i] && j > 0;
        const empties = j === 0;
        for (let d = 0; d < 7; d++) {
          if (d === i) continue;
          const dc = s.cols[d];
          const ok = dc.length ? fitsOn(c, dc[dc.length - 1]) : rank(c) === 13;
          if (!ok) continue;
          if (!dc.length && j === 0) continue; // King already at the bottom: pointless
          let useful = reveals || (empties && kingAvail);
          if (!useful && j > s.down[i]) {
            const exposed = col[j - 1];
            if (canHome(s, exposed)) useful = true;
            else if (talon.some((x) => fitsOn(x.c, exposed))) useful = true;
            else {
              for (let e = 0; e < 7 && !useful; e++) {
                if (e === i || e === d) continue;
                const ec = s.cols[e];
                if (s.down[e] > 0 && ec.length > s.down[e] && fitsOn(ec[s.down[e]], exposed)) useful = true;
              }
            }
          }
          if (useful) out.push({ t: 'tt', from: i, idx: j, to: d, card: c });
        }
      }
    }
    // 3. talon to foundation / tableau
    for (const x of talon) {
      if (canHome(s, x.c)) out.push({ t: 'wf', p: x.p, card: x.c });
    }
    for (const x of talon) {
      for (let d = 0; d < 7; d++) {
        const dc = s.cols[d];
        const ok = dc.length ? fitsOn(x.c, dc[dc.length - 1]) : rank(x.c) === 13;
        if (ok) { out.push({ t: 'wt', p: x.p, to: d, card: x.c }); if (!dc.length) break; }
      }
    }
    // 4. foundation back to tableau when it makes room for something
    for (let su = 0; su < 4; su++) {
      if (s.f[su] < 3) continue;
      const c = su * 13 + s.f[su] - 1;
      for (let d = 0; d < 7; d++) {
        const dc = s.cols[d];
        if (!dc.length || !fitsOn(c, dc[dc.length - 1])) continue;
        const helps = talon.some((x) => fitsOn(x.c, c)) ||
          s.cols.some((ec, e) => s.down[e] > 0 && ec.length > s.down[e] && fitsOn(ec[s.down[e]], c));
        if (helps) out.push({ t: 'ft', suit: su, to: d, card: c });
      }
    }
    return out;
  }

  function apply(s, m) {
    const n = clone(s);
    if (m.t === 'tf') {
      const c = n.cols[m.from].pop();
      n.f[suit(c)]++;
      flip(n, m.from);
    } else if (m.t === 'tt') {
      const run = n.cols[m.from].splice(m.idx);
      n.cols[m.to].push(...run);
      flip(n, m.from);
    } else if (m.t === 'wf' || m.t === 'wt') {
      const c = n.T.splice(m.p - 1, 1)[0];
      n.k = m.p - 1;
      if (m.t === 'wf') n.f[suit(c)]++;
      else n.cols[m.to].push(c);
    } else if (m.t === 'ft') {
      n.f[m.suit]--;
      n.cols[m.to].push(m.card);
    }
    return n;
  }

  /**
   * Search for a win. Returns { result: 'win' | 'lost' | 'unknown', moves, nodes }.
   * 'lost' means every line the solver considers was exhausted (not a mathematical proof).
   */
  function solve(start, draw, maxNodes = 60000) {
    const seen = new Set();
    let nodes = 0, capped = false;
    const path = [];
    function dfs(s) {
      if (nodes++ > maxNodes) { capped = true; return false; }
      const auto = autoSafe(s);
      path.push(...auto);
      if (won(s)) return true;
      const k = key(s);
      if (seen.has(k)) { path.length -= auto.length; return false; }
      seen.add(k);
      for (const m of moves(s, draw)) {
        path.push(m);
        if (dfs(apply(s, m))) return true;
        path.pop();
        if (capped) break;
      }
      path.length -= auto.length;
      return false;
    }
    const s0 = clone(start);
    const ok = dfs(s0);
    return { result: ok ? 'win' : capped ? 'unknown' : 'lost', moves: ok ? path.slice() : [], nodes };
  }

  /** Convert the app's Klondike state into the solver's compact form. */
  function fromGame(g) {
    const code = (c) => c.s * 13 + c.r - 1;
    const f = [0, 0, 0, 0];
    for (const pile of g.f) if (pile.length) f[pile[0].s] = pile.length;
    const T = g.waste.map(code).concat(g.stock.slice().reverse().map(code));
    return {
      cols: g.t.map((col) => col.map(code)),
      down: g.t.map((col) => col.filter((c) => !c.up).length),
      f,
      T,
      k: g.waste.length,
    };
  }

  /** Position signature that ignores how far you've drawn through the stock (drawing doesn't change the plan). */
  function sig(s) {
    return s.cols.map((c, i) => c.join(',') + '/' + s.down[i]).join('|') + '#' + s.f.join(',') + '#' + s.T.join(',');
  }
  /** Replay a solution, returning the signature of the position before each move. */
  function plan(start, list) {
    let s = clone(start);
    return list.map((m) => { const g = sig(s); s = apply(s, m); return g; });
  }

  const api = { solve, fromGame, reachable, rank, suit, sig, plan };
  if (root.OpenCard) root.OpenCard.KlondikeSolver = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
