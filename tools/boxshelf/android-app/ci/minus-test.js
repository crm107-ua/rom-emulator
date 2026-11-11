// Device test (beta.12): the controller's Minus / View button. Windows: a tap opens the game's Details and a second tap
// closes them; the bar says "Details" for it (no Minus → Settings); held, it still opens the museum. The Thor (Android page)
// keeps Minus for Settings. A pretend controller (navigator.getGamepads) presses the button.
'use strict';
module.exports = async function minusPass({ browser, base, check }) {
  const pad = async (q, android) => {
    const ctx = await browser.newContext(android ? { viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(() => { const btn = () => ({ pressed: false, touched: false, value: 0 });
      window.__pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn), timestamp: 1 };
      try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [window.__pad, null, null, null] }); } catch (e) {} });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); let o = null;
    try {
      await page.goto(base + q); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g, null, { timeout: 90000, polling: 250 });
      o = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = {};
        const press = async (i, ms) => { if (window.__padHold) { await __padHold(window.__pad, i, ms || 120); await w(900); return; } window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 }; window.__pad.timestamp++; await w(ms || 120); window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; window.__pad.timestamp++; await w(900); };
        for (let i = 0; i < 40 && Shelf.getMode() !== 'browse'; i++) await w(250); await w(1500);
        o.bar = [...document.querySelectorAll('#hints *')].map(e => e.textContent.trim()).filter(Boolean).join(' ').slice(0, 400);
        await press(8); o.after1 = Shelf.getMode(); o.settings1 = !!(window.Settings && Settings.isOpen && Settings.isOpen());
        if (o.settings1) { await Settings.close(); await w(800); }
        else { await press(8); o.after2 = Shelf.getMode(); }
        await w(600); await press(8, 1100); for (let i = 0; i < 40 && Shelf.getMode() !== 'museum'; i++) await w(250); o.held = Shelf.getMode(); // (the museum takes a while to open on a slow machine)
        return o; });
    } catch (e) { o = { err: e.message }; }
    await ctx.close(); return { o, errors };
  };
  const win = await pad('?platform=windows&shelf=1', false);
  check('Minus (beta.12, Windows): a tap opens the game\'s Details, another closes them, held it opens the museum; the bar says Details, not Settings',
    win.o && win.o.after1 === 'details' && !win.o.settings1 && win.o.after2 === 'browse' && win.o.held === 'museum' && /Details/.test(win.o.bar || ''), JSON.stringify(win.o).slice(0, 500));
  const thor = await pad('?platform=android&shelf=1', true);
  check('Minus (beta.12): on the Thor a tap still opens Settings', thor.o && thor.o.settings1 === true, JSON.stringify(thor.o).slice(0, 400));
  check('Minus pass: no script errors', !win.errors.length && !thor.errors.length, [...win.errors, ...thor.errors].slice(0, 3).join(' | '));
};
