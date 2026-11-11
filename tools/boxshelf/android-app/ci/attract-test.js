// Device test (beta.12): attract mode and a controller's first moment. Windows 1600x900.
//  - Attract mode moves the shelf even when the window isn't focused (after a game Windows often doesn't hand focus back:
//    the HUD faded and nothing moved), follows Settings' pace (Fast) and "visits other consoles" off, and any key ends it.
//  - A controller that appears with Start "held" for a moment (a stale state, as a pad coming up through Steam showed) must
//    not open the quick menu; a real tap afterwards does.
'use strict';
module.exports = async function attractPass({ browser, base, check }) {
  const errors = [];
  // ---- attract mode ----
  let a = {};
  { const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(1500);
      a = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = { seen: [], shelves: [] };
        Document.prototype.hasFocus = () => false; // the window isn't focused
        Shelf.applyUi({ attractPace: 'fast', attractWander: false });
        const sh = () => ((document.querySelector('.tab.on') || {}).textContent || '').trim(); // (the console tab that's lit)
        Shelf.attractNow(); const app = document.getElementById('app'); o.on = !!(app && app.classList.contains('attract'));
        for (let i = 0; i < 16; i++) { await w(1000); const g = Shelf._qs().g; if (o.seen[o.seen.length - 1] !== g) o.seen.push(g); o.shelves.push(sh()); }
        return o; });
      await page.keyboard.press('Shift'); await page.waitForTimeout(400);
      a.after = await page.evaluate(() => document.getElementById('app').classList.contains('attract'));
    } catch (e) { a.err = e.message; }
    await ctx.close(); }
  check('Attract mode (beta.12): it starts and moves the shelf even with the window unfocused', a.on && a.seen && a.seen.length >= 4, JSON.stringify(a).slice(0, 500));
  check('Attract mode: Fast pace (a box about every 2.5 s) and "visits other consoles" off keeps it on one shelf; a key ends it',
    a.seen && a.seen.length >= 5 && new Set(a.shelves).size === 1 && a.after === false, JSON.stringify(a).slice(0, 500));

  // ---- a controller's first moment ----
  let q = {};
  { const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(() => { const btn = p => ({ pressed: !!p, touched: !!p, value: p ? 1 : 0 });
      window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(false)), timestamp: 1 };
      window.__padOn = false;
      try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [window.__padOn ? window.__pad : null, null, null, null] }); } catch (e) {} });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(1500);
      q = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = {};
        const set = (i, p) => { window.__pad.buttons[i] = { pressed: p, touched: p, value: p ? 1 : 0 }; window.__pad.timestamp++; };
        // the pad appears with Start "held", and lets go 250 ms later: a stale state, not a tap
        set(9, true); window.__padOn = true; await w(250); set(9, false); await w(1500);
        o.staleOpened = !!Shelf._qs().open;
        // a real tap afterwards opens the quick menu
        if (window.__padHold) await __padHold(window.__pad, 9, 140); else { set(9, true); await w(140); set(9, false); } await w(900); o.tapOpened = !!Shelf._qs().open;
        return o; });
    } catch (e) { q.err = e.message; }
    await ctx.close(); }
  check('Controller (beta.12): a pad that appears with Start "held" for a moment doesn\'t open the quick menu; a real tap then does', q.staleOpened === false && q.tapOpened === true, JSON.stringify(q));

  // ---- (beta.12) two pads listed: the quick menu never opens by itself (Paul's PC: an Xbox pad plus a DolphinBar's raw Wii
  // remote copy, "Vendor: 057e Product: 0306", which wasn't left out; the shelf took turns between them and read Start) ----
  const twoPads = async (second) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(id2 => { const btn = p => ({ pressed: !!p, touched: !!p, value: p ? 1 : 0 });
      window.__a = { id: 'Xbox 360 Controller for Windows (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(false)), timestamp: 1 };
      window.__b = { id: id2, index: 1, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => btn(i === 9)), timestamp: 1 };
      let k = 0; setInterval(() => { k++; window.__b.axes = [0, 0, 0, (k % 2) ? .9 : -.9]; window.__b.timestamp++; if (k % 3 === 0) { window.__a.axes = [0, 0, (k % 2) ? .5 : -.5, 0]; window.__a.timestamp++; } }, 350); // both "in use" in turn
      try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [window.__a, window.__b, null, null] }); } catch (e) {} }, second);
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); let r = {};
    try {
      await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      r = await page.evaluate(async () => { let opened = 0, was = false; for (let i = 0; i < 60; i++) { await new Promise(res => setTimeout(res, 100)); const on = !!Shelf._qs().open; if (on && !was) opened++; was = on; } return { opened, mode: Shelf.getMode() }; });
    } catch (e) { r.err = e.message; }
    await ctx.close(); return r;
  };
  const wii = await twoPads('Nintendo Wii Remote (Vendor: 057e Product: 0306)'), other = await twoPads('Generic USB Joystick (STANDARD GAMEPAD)');
  check('Controller (beta.12): with an Xbox pad and a DolphinBar\'s raw Wii remote (Start held, sensors moving) the quick menu never opens by itself', wii.opened === 0 && wii.mode === 'browse', JSON.stringify(wii));
  check('Controller: two ordinary pads taking turns never read a held button as a press (no quick menu flashes)', other.opened === 0 && other.mode === 'browse', JSON.stringify(other));
  // ---- (beta.12) Linux / Steam Deck: the note over a starting game says how to leave it (no Home menu there) ----
  const notes = {};
  for (const plat of ['linux', 'windows']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base + `?platform=${plat}&shelf=1`); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(1200); for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300); }
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => [...document.querySelectorAll('#launch *')].some(e => e.children.length <= 2 && /^\s*Playing/.test(e.textContent || '')), null, { timeout: 15000, polling: 200 });
      notes[plat] = await page.evaluate(() => ([...document.querySelectorAll('#launch *')].filter(e => e.children.length <= 2).map(e => e.textContent).find(t => /^\s*Playing/.test(t || '')) || '').trim());
    } catch (e) { notes[plat] = 'error: ' + e.message; }
    await ctx.close();
  }
  check('Linux / Steam Deck (beta.12): a starting game\'s note says to hold View + Menu to come back (no Home menu there); Windows still names the Home menu', /hold View \+ Menu/.test(notes.linux || '') && /Home menu/.test(notes.windows || ''), JSON.stringify(notes));
  check('Attract / controller pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
