/* Open Card — update UI. Talks to the Android updater (window.OCUpdaterNative).
   In a desktop browser there is no native updater, so nothing here is shown. */
(function () {
  'use strict';
  const OC = window.OpenCard;
  const N = window.OCUpdaterNative || null;

  const U = (OC.updater = {
    native: N,
    state: null,
    dismissed: false, // banner closed for this session
    dlg: null, // open update dialog body
    available: !!N,
  });

  const read = () => {
    try {
      return JSON.parse(N.getState());
    } catch (_) {
      return null;
    }
  };
  const call = (name, ...args) => {
    try {
      if (N && N[name]) N[name](...args);
    } catch (e) {
      console.error(e);
    }
  };
  const esc = (t) => OC.esc(t == null ? '' : t);
  const mb = (n) => (n > 0 ? (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB' : '');
  const pct = (s) => (s.total > 0 ? Math.min(100, Math.floor((100 * s.done) / s.total)) : 0);

  /** Called by the Android side whenever the updater's state changes. */
  U._event = function (json) {
    try {
      U.state = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (_) {
      return;
    }
    refresh();
  };

  function refresh() {
    renderBanner();
    if (U.dlg) renderDialog();
  }

  /* ------------------------------------------------------------------ */
  /* Home-screen banner (only on the menu, never during a game)          */
  /* ------------------------------------------------------------------ */
  const BANNER_STATES = ['available', 'downloading', 'verifying', 'ready', 'needs_permission', 'installing', 'confirming'];
  function renderBanner() {
    const home = document.getElementById('home-screen');
    if (!home) return;
    let el = document.getElementById('update-banner');
    const s = U.state;
    const show = s && BANNER_STATES.includes(s.state) && !(U.dismissed && (s.state === 'available' || s.state === 'ready'));
    if (!show) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'update-banner';
      el.setAttribute('role', 'status');
      home.insertBefore(el, document.getElementById('game-list'));
    }
    let text;
    if (s.state === 'downloading') text = `Downloading update ${esc(s.latest)}… <b>${pct(s)}%</b>`;
    else if (s.state === 'verifying') text = 'Checking the downloaded update…';
    else if (s.state === 'ready') text = `Update <b>${esc(s.latest)}</b> is downloaded and ready to install`;
    else if (s.state === 'needs_permission') text = 'Allow Open Card to install its update';
    else if (s.state === 'installing' || s.state === 'confirming') text = 'Installing the update…';
    else text = `Version <b>${esc(s.latest)}</b> is available`;
    el.innerHTML = `<span class="upd-ico" aria-hidden="true">▲</span><span class="upd-text">${text}</span>
      <button class="btn small primary" data-u="view">View</button>${s.state === 'available' || s.state === 'ready' ? '<button class="btn small round" data-u="hide" title="Not now">✕</button>' : ''}`;
    el.querySelector('[data-u="view"]').onclick = () => U.open();
    const hide = el.querySelector('[data-u="hide"]');
    if (hide) hide.onclick = () => {
      U.dismissed = true;
      call('later');
      renderBanner();
    };
  }

  /* ------------------------------------------------------------------ */
  /* Update dialog                                                       */
  /* ------------------------------------------------------------------ */
  U.open = function () {
    if (!N) return;
    if (U.dlg) return renderDialog();
    U.state = U.state || read();
    const p = OC.ui.dialog({ title: 'Update', html: '<div class="upd"></div>', buttons: [], cls: 'update-dialog' });
    U.dlg = OC.ui._lastDialog.querySelector('.upd');
    p.then(() => {
      U.dlg = null;
    });
    renderDialog();
  };

  /** Manual check (Settings / About). */
  U.check = function () {
    if (!N) return;
    U.dismissed = false;
    U.open();
    call('checkNow');
  };

  function changelogHTML(text) {
    if (!text) return '<p class="note">No release notes were provided.</p>';
    const out = [];
    let list = false;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      const bullet = /^[-*+]\s+(.*)$/.exec(line);
      if (bullet) {
        if (!list) out.push('<ul>');
        list = true;
        out.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }
      if (list) out.push('</ul>');
      list = false;
      if (!line) continue;
      const head = /^#{1,6}\s+(.*)$/.exec(line);
      out.push(head ? `<p><b>${inline(head[1])}</b></p>` : `<p>${inline(line)}</p>`);
    }
    if (list) out.push('</ul>');
    return out.join('');
  }
  function inline(t) {
    // escape, then allow **bold** and `code`; links are shown as text only
    return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function versions(s) {
    return `<table class="upd-versions"><tr><td>Installed</td><td><b>${esc(s.installed)}</b></td></tr>${
      s.latest ? `<tr><td>Latest</td><td><b>${esc(s.latest)}</b>${s.size > 0 ? ` <span class="note">(${mb(s.size)})</span>` : ''}</td></tr>` : ''}</table>`;
  }

  function errorHelp(s) {
    switch (s.errorKind) {
      case 'NOT_WIFI': return 'Connect to Wi-Fi and try again. Open Card never uses mobile data for updates.';
      case 'OFFLINE': return 'You’re offline. Connect to Wi-Fi and try again.';
      case 'RATE_LIMITED': {
        const at = s.retryAt ? new Date(s.retryAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return 'GitHub limits how often apps can check for updates.' + (at ? ` Try again after ${at}.` : ' Try again later.');
      }
      case 'NOT_FOUND': return 'The update source isn’t available right now. Your game is unaffected.';
      case 'CHECKSUM_MISMATCH': case 'CORRUPT': return 'The downloaded file was damaged and has been deleted. Try downloading again.';
      case 'SIGNATURE_MISMATCH': return 'For your safety it won’t be installed. If you installed Open Card from a different source, uninstall it and install the latest version from the Releases page instead.';
      case 'CHECKSUM_MISSING': return 'This release can’t be verified, so it won’t be installed.';
      case 'INCOMPATIBLE': return 'This update needs a newer version of Android than this device has.';
      case 'STORAGE': return 'Free up some storage space and try again.';
      default: return s.retryable ? 'Please try again.' : '';
    }
  }

  function renderDialog() {
    const box = U.dlg;
    if (!box || !box.isConnected) {
      U.dlg = null;
      return;
    }
    const s = U.state || read() || { state: 'idle', installed: '' };
    let body = '';
    let acts = [];
    switch (s.state) {
      case 'checking':
        body = `${versions(s)}<p class="upd-wait">Checking for updates…</p>`;
        acts = [['Close', 'close']];
        break;
      case 'up_to_date':
        body = `${versions(s)}<p>✔ You have the latest version.</p>`;
        acts = [['Done', 'close', true]];
        break;
      case 'available': case 'deferred': case 'skipped':
        body = `${versions(s)}<h3 class="upd-h">What’s new</h3><div class="upd-notes">${changelogHTML(s.changelog)}</div>
          <p class="note">Downloads over Wi-Fi only. Your games, statistics and chips are kept.</p>`;
        acts = [['Skip this version', 'skip'], ['Later', 'later'], ['Download', 'download', true]];
        break;
      case 'downloading': {
        const p = pct(s);
        body = `${versions(s)}<div class="upd-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>
          <p class="upd-wait">Downloading… ${p}%${s.total > 0 ? ` · ${mb(s.done)} of ${mb(s.total)}` : ''}</p>
          <p class="note">You can keep playing — close this window and the download continues.</p>`;
        acts = [['Cancel download', 'cancel'], ['Hide', 'close', true]];
        break;
      }
      case 'verifying':
        body = `${versions(s)}<div class="upd-progress"><i style="width:100%"></i></div><p class="upd-wait">Checking the download…</p>`;
        acts = [['Hide', 'close']];
        break;
      case 'ready':
        body = `${versions(s)}<p>✔ <b>Download verified.</b> Its checksum and developer signature match this app.</p>
          ${s.message ? `<p class="upd-msg">${esc(s.message)}</p>` : ''}
          <ol class="upd-steps"><li>Tap <b>Install</b>.</li><li>Android shows its own confirmation screen — tap <b>Update</b> (or <b>Install</b>).</li><li>Open Card restarts on the new version with all your progress.</li></ol>`;
        acts = [['Later', 'later'], ['Install', 'install', true]];
        break;
      case 'needs_permission':
        body = `${versions(s)}<p><b>One-time step:</b> Android needs your permission for Open Card to install its own updates.</p>
          <ol class="upd-steps"><li>Tap <b>Open settings</b>.</li><li>Turn on <b>Allow from this source</b>.</li><li>Come back — the update continues automatically.</li></ol>
          ${s.message ? `<p class="upd-msg">${esc(s.message)}</p>` : ''}`;
        acts = [['Later', 'later'], ['Open settings', 'settings', true]];
        break;
      case 'installing': case 'confirming':
        body = `${versions(s)}<p class="upd-wait">Waiting for Android’s confirmation…</p><p class="note">Tap <b>Update</b> on Android’s screen to finish. Open Card will restart.</p>`;
        acts = [['Hide', 'close']];
        break;
      case 'installed':
        body = `${versions(s)}<p>✔ Update installed. Restarting…</p>`;
        acts = [['Done', 'close', true]];
        break;
      case 'error':
        body = `${versions(s)}<p class="upd-err">${esc(s.error || 'Something went wrong.')}</p><p>${esc(errorHelp(s))}</p>`;
        acts = [['Close', 'close']];
        if (s.retryable) acts.push(s.hasDownload ? ['Install', 'install', true] : s.latest && s.errorKind !== 'NOT_FOUND' && s.errorKind !== 'RATE_LIMITED' && s.errorKind !== 'NOT_WIFI' && s.errorKind !== 'OFFLINE' ? ['Try again', 'download', true] : ['Check again', 'check', true]);
        break;
      default:
        body = `${versions(s)}<p>Open Card checks for updates on Wi-Fi when it starts.</p>`;
        acts = [['Close', 'close'], ['Check now', 'check', true]];
    }
    box.innerHTML = body + `<div class="upd-actions">${acts.map(([l, a, primary]) => `<button class="btn${primary ? ' primary' : ''}" data-a="${a}">${l}</button>`).join('')}</div>`;
    box.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => act(b.dataset.a)));
  }

  function act(a) {
    switch (a) {
      case 'close': return closeDialog();
      case 'check': return call('checkNow');
      case 'download': return call('download');
      case 'cancel': return call('cancelDownload');
      case 'install': return call('install');
      case 'settings': return call('openInstallSettings');
      case 'later':
        U.dismissed = true;
        call('later');
        return closeDialog();
      case 'skip':
        U.dismissed = true;
        call('skip');
        return closeDialog();
    }
  }
  function closeDialog() {
    if (!U.dlg) return;
    const wrap = U.dlg.closest('.modal-wrap');
    U.dlg = null;
    if (wrap) {
      const x = wrap.querySelector('.modal-head .x');
      if (x) x.click();
      else wrap.remove();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Settings section                                                    */
  /* ------------------------------------------------------------------ */
  U.settingsHTML = function () {
    if (!N) return '';
    const s = U.state || read() || {};
    const on = s.autoCheck !== false;
    return `<div class="opt-row upd-settings"><label>Updates</label>
      <p class="note">Installed version ${esc(s.installed || '')}. Checks and downloads use Wi-Fi only.</p>
      <div class="upd-chips"><button class="chip${on ? ' on' : ''}" data-auto="1">Check on Wi-Fi at start</button><button class="chip${on ? '' : ' on'}" data-auto="0">Only when I ask</button></div>
      <button class="btn small upd-check">Check for updates</button></div>`;
  };
  U.wireSettings = function (wrap) {
    if (!N || !wrap) return;
    wrap.querySelectorAll('[data-auto]').forEach((c) => (c.onclick = () => {
      wrap.querySelectorAll('[data-auto]').forEach((x) => x.classList.toggle('on', x === c));
      call('setAutoCheck', c.dataset.auto === '1');
    }));
    const b = wrap.querySelector('.upd-check');
    if (b) b.onclick = () => U.check();
  };
  U.versionText = function () {
    const s = U.state || (N ? read() : null);
    return s && s.installed ? s.installed : '';
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (!N) return;
    U.state = read();
    refresh();
  });
})();
