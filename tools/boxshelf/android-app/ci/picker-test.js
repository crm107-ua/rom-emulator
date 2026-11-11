// Device test (beta.12): Linux Game Mode's own file and folder browser (renderer/picker.js), with the browser double's
// made-up home folder. A folder pick with the keyboard (down, Enter into Emulation, Space uses it); a file pick with the
// controller (into roms/snes, A on Game.sfc, only .sfc / .zip shown); Esc cancels; a click picks; nothing underneath moves.
'use strict';
module.exports = async function pickerPass({ browser, base, check }) {
  const errors = [], o = {};
  const PAD = `(() => { const pad = window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }; Navigator.prototype.getGamepads = function () { return [pad, null, null, null]; }; })();`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(PAD);
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  const st = () => page.evaluate(() => { const e = document.querySelector('.bsp'); return { on: !!(e && e.classList.contains('on')), path: e ? e.querySelector('.bsp-path').textContent.replace(/‎/g, '') : '', items: e ? [...e.querySelectorAll('.bsp-item')].map(x => x.textContent) : [], sel: e ? (e.querySelector('.bsp-item.sel') || {}).textContent : '', picked: window.__picked || null, sys: Shelf._qs && Shelf._qs().g }; });
  const press = b => page.evaluate(async b => { const w = ms => new Promise(r => setTimeout(r, ms)); if (window.__padHold) { await __padHold(__pad, b, 120); await w(250); return; } __pad.buttons[b] = { pressed: true, touched: true, value: 1 }; __pad.timestamp++; await w(120); __pad.buttons[b] = { pressed: false, touched: false, value: 0 }; __pad.timestamp++; await w(250); }, b);
  try {
    await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse' && typeof window.__pickOpen === 'function', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(800); const g0 = await page.evaluate(() => Shelf._qs().g);
    // a folder, with the keyboard
    await page.evaluate(() => { window.__picked = null; window.__pickOpen({ id: 7, folder: true, title: 'Choose your games folder', start: '', exts: [] }); }); await page.waitForTimeout(500);
    o.f0 = await st();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); o.f1 = await st();
    await page.keyboard.press(' '); await page.waitForTimeout(300); o.f2 = await st();
    o.g1 = await page.evaluate(() => Shelf._qs().g);
    // a file, with the controller (only the files it takes are shown)
    await page.evaluate(() => { window.__picked = null; window.__pickOpen({ id: 8, folder: false, title: 'Choose a game', start: '/home/deck/Emulation/roms', exts: ['sfc', 'zip'] }); }); await page.waitForTimeout(500);
    await page.waitForFunction(() => document.querySelectorAll('.bsp.on .bsp-item').length > 1, null, { timeout: 8000, polling: 150 }).catch(() => {}); // (the folder listed first)
    await press(13); await press(0); await page.waitForFunction(() => /snes$/.test(((document.querySelector('.bsp-path') || {}).textContent || '').replace(/[‎‏]/g, '')) && document.querySelectorAll('.bsp.on .bsp-item').length > 0, null, { timeout: 8000, polling: 150 }).catch(() => {}); o.p1 = await st(); // (down to snes, A opens it)
    await press(0); o.p2 = await st();
    // Esc cancels; a click picks
    await page.evaluate(() => { window.__picked = null; window.__pickOpen({ id: 9, folder: false, start: '/home/deck/Applications', exts: [] }); }); await page.waitForTimeout(400);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250); o.c = await st();
    await page.evaluate(() => { window.__picked = null; window.__pickOpen({ id: 10, folder: false, start: '/home/deck/Applications', exts: [] }); }); await page.waitForTimeout(400);
    await page.click('.bsp-item'); await page.waitForTimeout(250); o.k = await st();
    o.g0 = g0;
  } catch (e) { o.err = e.message; }
  await ctx.close();
  // (beta.12) the tour on Linux has "Leaving a game" (hold View + Menu); on Windows it doesn't
  const tourSteps = async plat => { const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }), p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
    try { await p.goto(base + '?platform=' + plat + '&shelf=1'); await p.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.BS_TOUR, null, { timeout: 90000, polling: 250 }); await p.waitForTimeout(1500);
      return await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); BS_TOUR.start(); for (let i = 0; i < 30 && !BS_TOUR.on(); i++) await w(100); const seen = [];
        for (let i = 0; i < 14 && BS_TOUR.on(); i++) { const k = BS_TOUR._step(); if (k && !seen.includes(k)) seen.push(k); if (k === 'Leaving a game') seen.push('text:' + (document.querySelector('#bsTour .bt-p') || {}).textContent); if (k === 'Done') break; BS_TOUR._go(1); await w(1800); }
        BS_TOUR.end(); return seen; }); } catch (e) { return ['err ' + e.message]; } finally { await c.close(); } };
  o.tourL = await tourSteps('linux'); o.tourW = await tourSteps('windows');
  check('Tour (beta.12): on Linux it says how to leave a game (hold View + Menu); on Windows that step isn\'t there',
    (o.tourL || []).includes('Leaving a game') && (o.tourL || []).some(s => /^text:Hold View and Menu/.test(s)) && !(o.tourW || []).includes('Leaving a game') && (o.tourW || []).includes('Done'), JSON.stringify({ L: o.tourL, W: o.tourW }));
  const f0 = o.f0 || {}, f1 = o.f1 || {}, f2 = o.f2 || {};
  check('Linux Game Mode browser (beta.12): a folder pick with the keyboard (into Emulation, Space uses it), folders only, the shelf underneath doesn\'t move',
    f0.on && f0.path === '/home/deck' && JSON.stringify(f0.items) === '["Applications","Emulation"]' && f1.path === '/home/deck/Emulation' && !f2.on && f2.picked && f2.picked.id === 7 && f2.picked.path === '/home/deck/Emulation' && o.g1 === o.g0,
    JSON.stringify({ f0, f1, f2, g0: o.g0, g1: o.g1, err: o.err }));
  check('Linux Game Mode browser: a file pick with the controller (d-pad, A into a folder, A on the game; only the files it takes shown)',
    (o.p1 || {}).path === '/home/deck/Emulation/roms/snes' && JSON.stringify((o.p1 || {}).items) === '["Game.sfc","Other.zip"]' && ((o.p2 || {}).picked || {}).path === '/home/deck/Emulation/roms/snes/Game.sfc',
    JSON.stringify({ p1: o.p1, p2: o.p2 }));
  check('Linux Game Mode browser: Esc cancels (nothing picked); a click picks', !(o.c || {}).on && ((o.c || {}).picked || {}).path === '' && ((o.k || {}).picked || {}).path === '/home/deck/Applications/Dolphin.AppImage', JSON.stringify({ c: o.c, k: o.k }));
  check('Linux Game Mode browser pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
