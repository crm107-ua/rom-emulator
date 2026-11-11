// Device test pass "tour" (beta.11), run by web-device-test.js: the shelf tour (renderer/tour.js) on the Windows page at
// 1600 x 900. Settings → Shelf → Show the tour starts it; it opens each screen in turn (Details, Inspect, the quick menu,
// the Art Studio, Settings) with a spotlight and a card that stay on screen; Enter goes on, Esc ends it and closes
// whatever it opened, and it's marked done. With a controller, A goes on and B ends it. An install set up before this
// version doesn't get it on its own; the Android page never has it. Checks results, never speed. Screenshots: tour-*.png.
'use strict';
const path = require('path');

const STEPS = ['Welcome', 'Consoles', 'Your games', 'Find a game', 'Details', 'Inspect', 'Quick menu', 'Art Studio', 'Adding games', 'Done'];

module.exports = async function tourPass({ browser, base, check, OUT }) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  ctx.setDefaultTimeout(90000);
  // a pretend controller the test presses (connected all along, as the shelf reads pads it saw from the start)
  await ctx.addInitScript(() => {
    const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })), axes: [0, 0, 0, 0] };
    window.__plug = () => {};
    Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
    window.__press = async (i, ms = 120) => { pad.buttons[i].pressed = true; pad.buttons[i].value = 1; pad.timestamp++; await new Promise(r => setTimeout(r, ms)); pad.buttons[i].pressed = false; pad.buttons[i].value = 0; pad.timestamp++; await new Promise(r => setTimeout(r, 200)); };
  });
  // (the spotlight's slide is switched off here: a busy machine measured it part-way)
  await ctx.addInitScript(() => { addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#bsTour .bt-spot{transition:none!important}'; document.head.appendChild(s); }); });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const settled = () => page.waitForFunction(() => !document.getElementById('bsTour').classList.contains('moving'), null, { timeout: 20000 }).catch(() => {});
  try {
    await page.goto(base + '?platform=windows&shelf=1');
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.BS_TOUR && window.Setup, null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 6; i++) { if (await page.evaluate(() => { const g = Shelf._lib.cur(); return !!g && g.kind === 'rom'; })) break; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700); }
    // an install set up before this version: nothing on its own
    await page.waitForTimeout(6000);
    const auto = await page.evaluate(() => BS_TOUR.on());

    // (counts the Inspect step's turns of the case)
    await page.evaluate(() => { window.__turns = 0; const o = Shelf._tour.inspectTurn; Shelf._tour.inspectTurn = () => { window.__turns++; o(); }; });
    // Settings → Shelf → Show the tour
    const row = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
      Setup.open({ page: 'shelf' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(600);
      const r = [...document.querySelectorAll('#bss .bss-row')].find(e => /Show the tour/.test(e.textContent)); if (r) r.click(); await w(300);
      const b = r && [...r.querySelectorAll('button, .btn, [role="button"]')].find(e => /Start/.test(e.textContent)); if (b && !(window.BS_TOUR && BS_TOUR.on())) b.click();
      for (let i = 0; i < 40 && !BS_TOUR.on(); i++) await w(150); return { found: !!r, on: BS_TOUR.on(), settings: Settings.isOpen() }; });

    // every step with Enter: its screen, the spotlight and the card on screen and apart
    const seen = [];
    for (let n = 0; n < 12 && row.on; n++) {
      await settled(); await page.waitForTimeout(700);
      const s = await page.evaluate(() => { const el = document.getElementById('bsTour'), c = el.querySelector('.bt-card').getBoundingClientRect(), sp = el.querySelector('.bt-spot'), r = sp.getBoundingClientRect(), none = sp.classList.contains('none');
        return { k: BS_TOUR._step(), mode: Shelf.getMode(), settings: Settings.isOpen(), qm: Shelf.quickMenuOpen(), spot: !none, card: c.width > 200 && c.left >= 0 && c.top >= 0 && c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1,
          apart: none || c.right <= r.left + 60 || c.left >= r.right - 60 || c.bottom <= r.top + 60 || c.top >= r.bottom - 60, title: el.querySelector('#btT').textContent }; });
      if (s.k === 'Inspect') { await page.waitForTimeout(2600); s.turns = await page.evaluate(() => window.__turns); }
      seen.push(s); await page.screenshot({ path: path.join(OUT, `tour-${n + 1}.png`) }).catch(() => {});
      if (s.k === 'Done') break; await page.keyboard.press('Enter');
    }
    const by = k => seen.find(s => s.k === k) || {};
    await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ on: BS_TOUR.on(), mode: Shelf.getMode(), settings: Settings.isOpen(), qm: Shelf.quickMenuOpen(), done: !!((Shelf._tour.cfg() || {}).ui || {}).tourDone }));
    check('Tour (Windows): an install set up before this version doesn\'t get it on its own; Settings → Shelf → Show the tour starts it',
      !auto && row.found && row.on && !row.settings, JSON.stringify({ auto, row }));
    check('Tour: ten steps in order, each opening its screen (Find a game, Details, Inspect, the quick menu, the Art Studio, Settings)',
      seen.map(s => s.k).join() === STEPS.join() && by('Find a game').mode === 'find' && by('Details').mode === 'details' && by('Inspect').mode === 'inspect' && by('Quick menu').qm && by('Art Studio').settings && by('Adding games').settings && by('Done').mode === 'browse' && !by('Done').settings,
      JSON.stringify(seen.map(s => [s.k, s.mode, s.settings ? 'S' : '', s.qm ? 'Q' : ''])));
    check('Tour: on the Inspect step the case turns by itself (a side every couple of seconds), and stops after', (by('Inspect').turns || 0) >= 1 && await page.evaluate(async () => { const n = window.__turns; await new Promise(r => setTimeout(r, 2600)); return window.__turns === n; }),
      JSON.stringify({ turns: by('Inspect').turns }));
    check('Tour: every step\'s card is on screen, beside its spotlight (not on it)', seen.length === STEPS.length && seen.every(s => s.card && s.apart) && seen.filter(s => s.spot).length === STEPS.length - 2,
      JSON.stringify(seen.filter(s => !s.card || !s.apart).map(s => s.k)));
    check('Tour: Esc ends it, closes what it opened and remembers it was seen', !after.on && after.mode === 'browse' && !after.settings && !after.qm && after.done, JSON.stringify(after));

    // with a controller: A goes on, B ends it (and nothing reaches the shelf meanwhile)
    const padRun = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); __plug(true); window.dispatchEvent(new Event('gamepadconnected')); await w(500);
      const g0 = Shelf._qs().g; BS_TOUR.start(); for (let i = 0; i < 40 && !BS_TOUR.on(); i++) await w(100); await w(1200);
      const k0 = BS_TOUR._step(); await __press(0); await w(1500); const k1 = BS_TOUR._step();
      // the d-pad doesn't change step (it nudges Next); RB goes on, LB back
      await __press(15); await __press(13); await w(400); const kDir = BS_TOUR._step(), nudged = !!document.querySelector('#bsTour .bt-next.nudge');
      await __press(5); await w(1500); const k2 = BS_TOUR._step(); await __press(4); await w(1500); const k3 = BS_TOUR._step(); await __press(5); await w(1500);
      const glyphs = document.querySelectorAll('#bsTour .bt-keys .g, #bsTour .bt-acts .g').length;
      await __press(1); await w(1500); const r = { k0, k1, kDir, nudged, k2, k3, glyphs, on: BS_TOUR.on(), mode: Shelf.getMode(), sameGame: Shelf._qs().g === g0 }; __plug(false); return r; });
    check('Tour with a controller: A and RB go on, LB back, B ends it; the d-pad only nudges Next; the pad\'s buttons show; the shelf doesn\'t move meanwhile',
      padRun.k0 === 'Welcome' && padRun.k1 === 'Consoles' && padRun.kDir === 'Consoles' && padRun.nudged && padRun.k2 === 'Your games' && padRun.k3 === 'Consoles' && padRun.glyphs >= 3 && !padRun.on && padRun.mode === 'browse' && padRun.sameGame, JSON.stringify(padRun));
    check('Tour pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('Tour pass ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
  await ctx.close();

  // a new install: setup from Welcome to Open Boxshelf (as ci/setup-test.js goes), then the tour starts on its own, once
  const fctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await fctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [null, null, null, null] }); } catch (e) {} });
  const fp = await fctx.newPage();
  try {
    const pause = ms => fp.waitForTimeout(ms);
    await fp.goto(base + '?platform=windows&retro=1&wave2=1');
    await fp.waitForSelector('#setup.on', { timeout: 90000 }); await pause(800);
    await fp.getByRole('button', { name: 'Find my emulators and games' }).click(); await pause(1800);
    for (let i = 0; i < 3; i++) { await fp.getByRole('button', { name: 'Next' }).click(); await pause(900); }
    await fp.getByRole('button', { name: 'Skip for now' }).click(); await pause(2500);
    const owedInSetup = await fp.evaluate(() => localStorage.getItem('bs-tour-pending') === '1');
    await fp.getByRole('button', { name: 'Open Boxshelf' }).click();
    let on = false; for (let i = 0; i < 40 && !on; i++) { await pause(500); on = await fp.evaluate(() => !!(window.BS_TOUR && BS_TOUR.on())); }
    await pause(1500); const first = await fp.evaluate(() => BS_TOUR._step());
    await fp.screenshot({ path: path.join(OUT, 'tour-first-run.png') }).catch(() => {});
    await fp.keyboard.press('Escape'); await pause(1500);
    const cleared = await fp.evaluate(() => localStorage.getItem('bs-tour-pending') === null && !!((Shelf._tour.cfg() || {}).ui || {}).tourDone);
    check('Tour: a new install gets it on its own once setup is done (owed from the first start), and ending it settles it',
      owedInSetup && on && first === 'Welcome' && cleared, JSON.stringify({ owedInSetup, on, first, cleared }));
  } catch (e) { check('Tour (new install) ran to the end', false, e && e.message); }
  await fctx.close();
  // Boxshelf closed straight after setup, before the tour came up: still owed (the page's own storage, which setup's save
  // of the settings can't undo), so the next start brings it. (This test page keeps its settings in memory only, so the
  // next start is a page with setup done and the tour owed.) After it ends, a later start doesn't bring it back
  const octx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await octx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [null, null, null, null] }); } catch (e) {}
    try { if (!sessionStorage.getItem('t-once')) { sessionStorage.setItem('t-once', '1'); localStorage.setItem('bs-tour-pending', '1'); } } catch (e) {} });
  const op = await octx.newPage();
  try {
    const pause = ms => op.waitForTimeout(ms);
    await op.goto(base + '?platform=windows&shelf=1'); await op.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.BS_TOUR, null, { timeout: 90000, polling: 250 });
    let on = false; for (let i = 0; i < 40 && !on; i++) { await pause(500); on = await op.evaluate(() => BS_TOUR.on()); }
    await pause(1200); await op.keyboard.press('Escape'); await pause(1500);
    await op.reload(); await op.waitForFunction(() => window.Shelf && Shelf._qs && window.BS_TOUR, null, { timeout: 90000 }); await pause(9000);
    const again = await op.evaluate(() => BS_TOUR.on());
    check('Tour: closed straight after setup, it comes on the next start; once ended, never again', on && !again, JSON.stringify({ on, again }));
  } catch (e) { check('Tour (owed) ran to the end', false, e && e.message); }
  await octx.close();

  // (bug review) Settings closing with a classic page still over it (the phone companion's Play does that) takes the page
  // too, so it can't stay over the shelf; Settings opened again straight away still closes
  const sctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await sctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [null, null, null, null] }); } catch (e) {} });
  const sp = await sctx.newPage();
  try {
    await sp.goto(base + '?platform=windows&shelf=1'); await sp.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup && window.Settings, null, { timeout: 90000, polling: 250 });
    const s = await sp.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = {};
      const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await w(100); } return false; };
      Setup.open({ page: 'display' }); await until(() => Settings.isOpen(), 5000); await w(500);
      Setup.openLegacy('games', { back: () => {} }); await w(400); o.up = Setup.legacyOpen() && !!document.querySelector('#setup.on');
      await Settings.close(); await w(300); o.gone = !document.querySelector('#setup.on') && !Setup.legacyOpen() && !Settings.isOpen();
      Setup.open({ page: 'display' }); await until(() => Settings.isOpen(), 5000); await w(400); await Settings.close(); o.again = !Settings.isOpen();
      return o; });
    check('Settings: closing it takes a classic page left over it too (never stuck over the shelf); opened again, it closes', s.up && s.gone && s.again, JSON.stringify(s));
  } catch (e) { check('Settings close (classic page) ran to the end', false, e && e.message); }
  await sctx.close();

  // (beta.12) RocketLauncher in Settings → Consoles: found (?rl=1, the pretend one), its switch, the front end; GameCube's page
  // gets "Start games with" and the folder check once it's on; nothing at all when RocketLauncher isn't there
  const rlRows = async (q, on) => { const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [null, null, null, null] }); } catch (e) {} });
    const pg = await ctx.newPage(); let o = null;
    try { await pg.goto(base + '?platform=windows&shelf=1' + q); await pg.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup && window.Settings, null, { timeout: 90000, polling: 250 });
      o = await pg.evaluate(async on => { const w = ms => new Promise(r => setTimeout(r, ms)), o = {};
        const names = () => [...document.querySelectorAll('#bss .bss-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 140));
        Setup.open({ page: 'consoles' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(1500); o.consoles = names().filter(n => /RocketLauncher/.test(n));
        if (on) { const c = (await window.boxshelf.getConfig()).config; c.rocket = { exe: 'C:\\HyperSpin\\RocketLauncher\\RocketLauncher.exe', mode: 'all', frontend: '' }; await window.boxshelf.saveConfig(c);
          const ci = Shelf.config && Shelf.config(); if (ci && ci.config) ci.config.rocket = c.rocket; await Settings.close(); await w(800);
          Setup.open({ page: 'gc' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(1500); o.gc = names().slice(0, 5); }
        if (Settings.isOpen()) await Settings.close(); return o; }, on);
    } catch (e) { o = { err: e.message }; } await ctx.close(); return o; };
  const rOn = await rlRows('&rl=1', true), rOff = await rlRows('', false);
  check('RocketLauncher (beta.12): Settings → Consoles finds it and offers the switch; on, a console page starts with "Start games with" and the folder check; not there, only its "Not found" row (no switches)',
    rOn && rOn.consoles && rOn.consoles.some(n => /^RocketLauncher .*systems? set up there.*Found/.test(n)) && rOn.consoles.some(n => /^Start games through RocketLauncher/.test(n)) &&
    rOn.gc && /^Start games with .*RocketLauncher/.test(rOn.gc[1] || '') && rOn.gc.some(n => /^RocketLauncher system name Nintendo GameCube/.test(n)) && rOn.gc.some(n => /^Games folder for RocketLauncher Matches/.test(n)) &&
    rOff && rOff.consoles && rOff.consoles.length === 1 && /Not found/.test(rOff.consoles[0]), JSON.stringify({ gc: rOn && rOn.gc, err: rOn && rOn.err, off: rOff }).slice(0, 700));

  // the Android page: never
  const actx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true });
  const ap = await actx.newPage();
  try {
    await ap.goto(base + '?platform=android&shelf=1');
    await ap.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.BS_TOUR && window.Setup, null, { timeout: 90000, polling: 250 });
    const a = await ap.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); const started = BS_TOUR.start();
      Setup.open({ page: 'shelf' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(500);
      return { started, row: [...document.querySelectorAll('#bss .bss-row')].some(e => /Show the tour/.test(e.textContent)) }; });
    check('Tour: not on Android (no tour, no Show the tour row)', !a.started && !a.row, JSON.stringify(a));
  } catch (e) { check('Tour (Android) ran to the end', false, e && e.message); }
  await actx.close();
};
