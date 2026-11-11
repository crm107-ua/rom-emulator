// Device test pass "seamless" (beta.12), run by web-device-test.js (windows group). Checks results, never speed.
//   The demo page as Windows (?platform=windows&watch=1: the pretend main watches Steam games like main/seamless.js):
//   - a Steam game started with Seamless play on is watched: the starting screen stays up (no "Running through Steam"
//     note), B can't leave a game that's running, and the shelf comes back when it ends; one that never shows up gets the
//     old note and B returns; with Seamless play off it's handed to Steam with the old note, as before.
//   - Settings → Display has Seamless play; Screen & TV has Screen mode (choosing Window reaches main) instead of Start
//     in fullscreen, and Hide the taskbar goes in Window mode; Seamless play off: neither new row, the old ones back.
//   - the Home menu page (renderer/home.html) with the shelf's items from main/seamless.js: Go to desktop with Seamless play
//     on (A chooses it), not with it off.
'use strict';
const path = require('path');

module.exports = async function seamlessPass({ browser, base, check, newPage, OUT }) {
  const seamless = require(path.join(__dirname, '..', '..', 'main', 'seamless.js'));
  // ---------- a Steam game, watched ----------
  { const { ctx, page, errors } = await newPage(browser, null);
    try {
      await page.goto(base + '?platform=windows&shelf=1&watch=1');
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup, null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        const word = () => (document.getElementById('sysWord') || {}).textContent || '';
        const noteOn = () => { const n = document.getElementById('lNote'); return n && n.classList.contains('on') ? n.textContent : ''; };
        const back = async () => { for (let i = 0; i < 40 && Shelf.getMode() !== 'browse'; i++) await w(250); return Shelf.getMode(); };
        // the demo's Steam library (a Steam folder set)
        const c = (await window.boxshelf.getConfig()).config; c.steam = { enabled: true, path: 'C:\\Steam' }; await window.boxshelf.saveConfig(c); await Shelf.refresh(true); await w(1500);
        for (let i = 0; i < 24 && !word().trim().startsWith('PC'); i++) { key('ArrowDown'); await w(500); }
        out.shelf = word(); out.game = Shelf._qs().g;
        if (!/Cobalt Drift|Glasshouse|Hollow Crown|Night Courier/.test(out.game || '')) return out; // never Play some other game
        // Seamless play on (the default): watched
        window.__padAtSteamTest = true; // (played on a controller that Boxshelf won't see afterwards: no pads in this page)
        key('Enter'); await w(1200); out.on = { mode: Shelf.getMode(), watched: (window.__watched || []).length, note: noteOn() };
        key('Escape'); await w(500); out.on.afterB = Shelf.getMode(); out.on.ask = /press again/i.test(((document.getElementById('toast') || {}).textContent || '') + ' ' + [...document.querySelectorAll('.toast')].map(e => e.textContent).join(' ')); out.on.back = await back();
        window.__padAtSteamTest = false;
        for (let i = 0; i < 40 && !document.querySelector('.note-card'); i++) await w(250);
        out.held = ((document.querySelector('.note-card') || {}).textContent || '').slice(0, 80);
        const nb = document.querySelector('.note-card .btn:not(.primary)'); if (nb) { nb.click(); await w(600); }
        // never shows up: the old note, then B returns
        window.__watchMode = 'giveup'; key('Enter'); await w(3500); out.gu = { mode: Shelf.getMode(), note: noteOn() }; key('Escape'); out.gu.back = await back(); window.__watchMode = '';
        // Seamless play off: handed to Steam with the old note, not watched
        const c2 = (await window.boxshelf.getConfig()).config; c2.ui.seamless = false; await window.boxshelf.saveConfig(c2);
        const n0 = (window.__watched || []).length; key('Enter'); await w(2600); out.off = { mode: Shelf.getMode(), watched: (window.__watched || []).length - n0, note: noteOn() };
        key('Escape'); out.off.back = await back();
        return out; });
      check('Seamless play (Windows): a Steam game is watched: the starting screen stays up with no "Running through Steam" note, B can\'t leave a running game, the shelf comes back when it ends',
        !!r.on && r.on.mode === 'launch' && r.on.watched >= 1 && !/Running through/.test(r.on.note) && r.on.afterB === 'launch' && r.on.back === 'browse', JSON.stringify(r));
      check('Seamless play (beta.12): back from a Steam game played on a controller Boxshelf no longer sees, a card says Steam is still holding it (with Close Steam)',
        /Steam is still holding your controller/.test(r.held || ''), JSON.stringify({ held: r.held, ask: r.on && r.on.ask }));
      check('Seamless play (Windows): a Steam game that never shows up gets the old "Running through Steam" note, and B returns',
        !!r.gu && r.gu.mode === 'launch' && /Running through Steam/.test(r.gu.note) && r.gu.back === 'browse', JSON.stringify(r.gu || r));
      check('Seamless play off: a Steam game is handed to Steam as before (the "Running through Steam" note, not watched), B returns',
        !!r.off && r.off.mode === 'launch' && r.off.watched === 0 && /Running through Steam/.test(r.off.note) && r.off.back === 'browse', JSON.stringify(r.off || r));
      check('Seamless play: no page errors on the Steam launches', !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check('Seamless play: the Steam launches ran', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close().catch(() => {}); }

  // ---------- Settings → Display: Seamless play, Screen mode ----------
  { const { ctx, page, errors } = await newPage(browser, null);
    try {
      await page.goto(base + '?platform=windows&shelf=1');
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup, null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(1500);
      const s = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
        const names = () => [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent);
        const row = n => [...document.querySelectorAll('#bss .bss-row')].find(r => ((r.querySelector('.nm') || {}).textContent || '') === n);
        const until = async f => { for (let i = 0; i < 50 && !f(); i++) await w(150); await w(400); };
        const close = async () => { if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(800); } };
        const more = async () => { Setup.open({ page: 'display' }); await until(() => row('Screen & TV')); const d = names(); row('Screen & TV').click(); await until(() => row('Fit to TV')); return { d, m: names() }; };
        let v = await more(); out.display = v.d; out.more = v.m;
        // (a click on the right half of a choice row picks the next choice, as with the mouse)
        if (row('Screen mode')) { const el = row('Screen mode'), b = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.right - 6, clientY: b.top + b.height / 2 })); await w(900); out.modes = (window.__screenModes || []).slice(); out.windowRows = names(); }
        await close(); await w(600);
        // Seamless play off
        Setup.open({ page: 'display' }); await until(() => row('Seamless play')); if (row('Seamless play')) { row('Seamless play').click(); await w(900); }
        out.cfgOff = (await window.boxshelf.getConfig()).config.ui.seamless;
        await close(); await w(600);
        v = await more(); out.offMore = v.m; await close();
        return out; });
      check('Settings (Windows): Display has Seamless play; Screen & TV has Screen mode instead of Start in fullscreen',
        (s.display || []).includes('Seamless play') && (s.more || []).includes('Screen mode') && !(s.more || []).includes('Start in fullscreen') && (s.more || []).includes('Hide the taskbar during games'), JSON.stringify({ d: s.display, m: s.more }));
      check('Settings (Windows): choosing Window in Screen mode reaches main at once, and the taskbar row goes (the taskbar is never hidden in a window)',
        (s.modes || []).includes('window') && !(s.windowRows || []).includes('Hide the taskbar during games'), JSON.stringify({ modes: s.modes, rows: s.windowRows }));
      check('Settings (Windows): Seamless play off: no Screen mode row; Start in fullscreen and Hide the taskbar are back as before',
        s.cfgOff === false && !(s.offMore || []).includes('Screen mode') && (s.offMore || []).includes('Start in fullscreen') && (s.offMore || []).includes('Hide the taskbar during games'), JSON.stringify({ off: s.cfgOff, m: s.offMore }));
      check('Settings (Windows): no page errors around Seamless play', !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check('Seamless play: the Settings rows ran', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close().catch(() => {}); }

  // ---------- the Home menu: Go to desktop ----------
  { const init = 'window.home = { onOpen(f) { window.__hOpen = f; }, onButton(f) { window.__hBtn = f; }, onToast() {}, onPaused() {}, act(a) { (window.__hActs = window.__hActs || []).push(a); } };';
    const { ctx, page, errors } = await newPage(browser, init);
    try {
      await page.goto(base.replace(/index\.html$/, 'home.html'));
      await page.waitForFunction(() => typeof window.__hOpen === 'function', null, { timeout: 30000, polling: 200 });
      const show = async actions => page.evaluate(async a => { const w = ms => new Promise(r => setTimeout(r, ms));
        window.__hOpen({ inGame: false, title: 'Home', system: 'Boxshelf', actions: a, power: ['sleep', 'restart', 'shutdown', 'quitapp'], confirmButton: 'a' }); await w(400);
        return [...document.querySelectorAll('#items .item')].map(e => (e.querySelector('span') || {}).textContent || ''); }, actions);
      const on = await show(seamless.shelfActionsFor({ seamless: true }, 'win32'));
      const chose = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); const items = [...document.querySelectorAll('#items .item')].map(e => (e.querySelector('span') || {}).textContent);
        const k = items.indexOf('Go to desktop'); for (let i = 0; i < k; i++) { window.__hBtn({ btn: 'down', down: true }); await w(60); }
        window.__hBtn({ btn: 'a', down: true }); await w(60); window.__hBtn({ btn: 'a', down: false }); await w(300); return (window.__hActs || []).slice(); });
      await page.screenshot({ path: path.join(OUT, 'seamless-home-menu.png') }).catch(() => {});
      const off = await show(seamless.shelfActionsFor({ seamless: false }, 'win32'));
      check('Home menu on the shelf (Seamless play on): Go to desktop before Power, and A chooses it',
        on.join() === 'Home shelf,Museum,Settings,Go to desktop,Power' && chose.join() === 'desktop', JSON.stringify({ on, chose }));
      check('Home menu on the shelf (Seamless play off): no Go to desktop, the items as before', off.join() === 'Home shelf,Museum,Settings,Power', JSON.stringify(off));
      check('Home menu page: no errors', !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check('Seamless play: the Home menu page ran', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close().catch(() => {}); }
};
