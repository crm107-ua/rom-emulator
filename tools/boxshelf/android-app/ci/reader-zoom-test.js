// Device test (beta.12): the manual reader in Inspect on a small screen. On the Thor's layout (853x480 @2.25, its own
// 1280-wide page) it opens one page at a time; R2 zooms to the page's full width and the right stick moves down it, the
// page's top in view first; + / - and 0 on the keyboard; a double tap zooms in and out again; X switches to two pages;
// the page you were on comes back when the manual is opened again; the step line and title never cover the page.
'use strict';
module.exports = async function readerZoomPass({ browser, base, check }) {
  const errors = [], o = {};
  const PAD = `(() => { const pad = window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }; Navigator.prototype.getGamepads = function () { return [pad, null, null, null]; }; })();`;
  const ctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, hasTouch: true, isMobile: true }); await ctx.addInitScript(PAD);
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  const st = () => p.evaluate(() => { const L = document.getElementById('rdLeft'), R = document.getElementById('rdRight'), b = document.getElementById('rdBook'), step = document.getElementById('ispStep');
    const vis = [L, R].filter(x => !x.hidden), r = vis.length ? vis[vis.length - 1].getBoundingClientRect() : null, sr = step.getBoundingClientRect();
    return { mode: Shelf.getMode(), open: document.getElementById('reader').classList.contains('on'), pages: vis.length, count: document.getElementById('rdCount').textContent, tf: b.style.transform || '',
      pw: r ? Math.round(r.width) : 0, top: r ? Math.round(r.top) : 0, bottom: r ? Math.round(r.bottom) : 0, stepTop: Math.round(sr.top), vw: innerWidth, vh: innerHeight,
      hints: (document.getElementById('ispHints') || {}).innerText.replace(/\s+/g, ' ') }; });
  const press = b => p.evaluate(async b => { const w = ms => new Promise(r => setTimeout(r, ms)); __pad.buttons[b] = { pressed: true, touched: true, value: 1 }; __pad.timestamp++; await w(140); __pad.buttons[b] = { pressed: false, touched: false, value: 0 }; __pad.timestamp++; await w(380); }, b);
  const stick = (ax, v, ms) => p.evaluate(async ({ ax, v, ms }) => { __pad.axes[ax] = v; __pad.timestamp++; await new Promise(r => setTimeout(r, ms)); __pad.axes[ax] = 0; __pad.timestamp++; await new Promise(r => setTimeout(r, 300)); }, { ax, v, ms });
  try {
    await p.goto(base + '?platform=android&shelf=1'); await p.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 }); await p.waitForTimeout(1800);
    for (let i = 0; i < 8; i++) { if (await p.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(350); }
    await p.keyboard.press('i'); await p.waitForTimeout(1200); await p.evaluate(() => { const b = document.getElementById('dManual'); if (b && !b.hidden) b.click(); });
    await p.waitForFunction(() => document.getElementById('reader').classList.contains('on'), null, { timeout: 20000, polling: 200 }); await p.waitForTimeout(900);
    // (beta.12) it opens at the page's full width, its top first; 0 shows the whole page, where the checks below start
    await p.waitForFunction(() => /scale\(/.test(document.getElementById('rdBook').style.transform || ''), null, { timeout: 8000, polling: 150 }).catch(() => {});
    o.auto = await st(); await p.keyboard.press('0'); await p.waitForTimeout(500);
    o.open = await st();
    await press(15); await press(15); o.p2 = await st();                       // (d-pad right twice: page 2, one at a time)
    await p.evaluate(() => { __pad.buttons[7] = { pressed: true, touched: true, value: 1 }; __pad.timestamp++; }); await p.waitForTimeout(160); await p.evaluate(() => { __pad.buttons[7] = { pressed: false, touched: false, value: 0 }; __pad.timestamp++; }); await p.waitForTimeout(500);
    o.z1 = await st();
    await stick(3, 1, 500); o.moved = await st();                               // (right stick down: further down the page)
    await p.keyboard.press('0'); await p.waitForTimeout(400); o.k0 = await st();
    await p.keyboard.press('='); await p.waitForTimeout(400); o.kz = await st(); await p.keyboard.press('-'); await p.waitForTimeout(400); o.kback = await st();
    await p.touchscreen.tap(426, 200); await p.waitForTimeout(90); await p.touchscreen.tap(426, 200); await p.waitForTimeout(500); o.dt = await st();
    await p.touchscreen.tap(426, 200); await p.waitForTimeout(90); await p.touchscreen.tap(426, 200); await p.waitForTimeout(500); o.dt2 = await st();
    await press(2); o.two = await st();                                         // (X: two pages)
    await press(2); await p.keyboard.press('Escape'); await p.waitForTimeout(700);  // (one page again, then the manual back)
    await p.keyboard.press('m'); await p.waitForFunction(() => document.getElementById('reader').classList.contains('on'), null, { timeout: 15000, polling: 200 }); await p.waitForTimeout(700); o.again = await st();
  } catch (e) { o.err = e.message; }
  await ctx.close();
  // the Steam Deck (Linux, a touch screen, 1280x800): two fingers spread apart zoom the manual in, closer zoom it out
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true }); const dp = await dctx.newPage(); dp.on('pageerror', e => errors.push('deck: ' + e.message));
  try {
    await dp.goto(base + '?platform=linux&shelf=1'); await dp.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 }); await dp.waitForTimeout(1500);
    for (let i = 0; i < 8; i++) { if (await dp.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await dp.keyboard.press('ArrowRight'); await dp.waitForTimeout(350); }
    // (each step waited for, not a fixed time: on a slow machine Inspect and the booklet take a while)
    const rdOn = () => dp.evaluate(() => document.getElementById('reader').classList.contains('on'));
    await dp.keyboard.press('v'); await dp.waitForFunction(() => Shelf.getMode() === 'inspect', null, { timeout: 20000, polling: 200 }).catch(() => {}); await dp.waitForTimeout(800);
    for (let i = 0; i < 4 && !(await rdOn()); i++) { if (i) { await dp.keyboard.press('Enter'); await dp.waitForTimeout(800); } await dp.keyboard.press('m');
      await dp.waitForFunction(() => document.getElementById('reader').classList.contains('on'), null, { timeout: 20000, polling: 250 }).catch(() => {}); }
    const pinch = (from, to) => dp.evaluate(async ({ from, to }) => { const w = ms => new Promise(r => setTimeout(r, ms)), t = document.getElementById('rdBook') || document.body;
      const ev = (type, id, x, y) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y }));
      ev('pointerdown', 11, 640 - from, 380); ev('pointerdown', 12, 640 + from, 380); await w(40);
      for (let k = 1; k <= 8; k++) { const d = from + (to - from) * k / 8; ev('pointermove', 11, 640 - d, 380); ev('pointermove', 12, 640 + d, 380); await w(30); }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // (the pinch is applied once a frame: two frames with the fingers still down, as real fingers give it)
      ev('pointerup', 11, 640 - to, 380); ev('pointerup', 12, 640 + to, 380); await w(350);
      return { open: document.getElementById('reader').classList.contains('on'), tf: document.getElementById('rdBook').style.transform || '', page: document.getElementById('rdCount').textContent }; }, { from, to });
    o.dOpen = await dp.evaluate(() => document.getElementById('reader').classList.contains('on'));
    o.dIn = await pinch(60, 220); o.dOut = await pinch(220, 40);
  } catch (e) { o.derr = e.message; }
  await dctx.close();
  const a = o.open || {}, z = o.z1 || {};
  check('Reader on the Steam Deck: two fingers spread apart zoom the manual in, pinched together zoom back out (no page turned)',
    o.dOpen && /scale\((1\.[4-9]|[2-4])/.test((o.dIn || {}).tf || '') && !(o.dOut || {}).tf && (o.dIn || {}).page === (o.dOut || {}).page, JSON.stringify({ open: o.dOpen, dIn: o.dIn, dOut: o.dOut, err: o.derr }));
  const au = o.auto || {};
  check('Reader (beta.12): on the Thor a manual opens readable: at the page\'s full width, its top first; 0 shows the whole page, which now takes most of the screen\'s height',
    au.open && /scale\((1\.[3-9]|[23])/.test(au.tf || '') && au.pw >= au.vw * .85 && au.top >= -2 && a.bottom - a.top >= a.vh * .7, JSON.stringify({ auto: au, whole: { top: a.top, bottom: a.bottom, vh: a.vh }, err: o.err }));
  check('Reader (beta.12): on the Thor a manual opens one page at a time, and the step line and title never cover the page', a.open && a.pages === 1 && a.bottom <= a.stepTop + 2 && /^Page 3 of/.test((o.p2 || {}).count || ''), JSON.stringify({ a, p2: o.p2, err: o.err }));
  check('Reader: R2 zooms to the page\'s full width (top of the page first), the right stick moves down it',
    /scale\(/.test(z.tf) && z.pw >= z.vw * .85 && z.top >= 0 && z.top <= 60 && (o.moved || {}).top < z.top - 20 && /move with/i.test(z.hints), JSON.stringify({ z1: z, moved: o.moved }));
  check('Reader: 0 shows the whole page, + / - zoom in and out, a double tap zooms in and another zooms out',
    !(o.k0 || {}).tf && /scale\(/.test((o.kz || {}).tf || '') && !(o.kback || {}).tf && /scale\(/.test((o.dt || {}).tf || '') && !(o.dt2 || {}).tf, JSON.stringify({ k0: o.k0 && o.k0.tf, kz: o.kz && o.kz.tf, kback: o.kback && o.kback.tf, dt: o.dt && o.dt.tf, dt2: o.dt2 && o.dt2.tf }));
  check('Reader: X shows two pages; opened again, the manual is back on the page you left', (o.two || {}).pages === 2 && /^Page 3 of/.test((o.again || {}).count || ''), JSON.stringify({ two: o.two && o.two.pages, again: o.again && o.again.count }));
  check('Reader zoom pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
