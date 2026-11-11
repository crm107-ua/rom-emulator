// Device test (beta.12, Android touch): on the pretend Thor screen (853x480 @2.25, touch). A double tap on the case you're
// on picks it up (Inspect); one tap still flips it (a moment later); a quick swipe up on the shelf opens Details and a quick
// swipe down closes it; a slow drag up does nothing; a sideways swipe on the shelf still browses.
'use strict';
module.exports = async function touchGesturesPass({ browser, base, check }) {
  const errors = [], o = {};
  const ctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  const st = () => p.evaluate(() => ({ mode: Shelf.getMode(), flipped: !!document.querySelector('.slot.sel .box.flipped, .slot.sel.flipped') || !!(window.Shelf && Shelf._qs && Shelf._qs().flipped), g: Shelf._qs().g }));
  // a finger: touch events (the touch layer) plus the pointer / click the browser makes for a tap
  const swipe = (x0, y0, x1, y1, ms) => p.evaluate(async ({ x0, y0, x1, y1, ms }) => { const w = t => new Promise(r => setTimeout(r, t)), el = document.elementFromPoint(x0, y0) || document.body;
    const mk = (x, y) => new Touch({ identifier: 3, target: el, clientX: x, clientY: y }), ev = (type, x, y, list) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list ? [mk(x, y)] : [], targetTouches: list ? [mk(x, y)] : [], changedTouches: [mk(x, y)] }));
    ev('touchstart', x0, y0, true); const n = 8; for (let k = 1; k <= n; k++) { await w(ms / n); ev('touchmove', x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, true); } ev('touchend', x1, y1, false); await w(700); }, { x0, y0, x1, y1, ms });
  const selCentre = () => p.evaluate(() => { const r = document.querySelector('.slot.sel').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
  try {
    await p.goto(base + '?platform=android&shelf=1'); await p.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 }); await p.waitForTimeout(1800);
    for (let i = 0; i < 8; i++) { if (await p.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(350); }
    await p.waitForTimeout(500); const [cx, cy] = await selCentre();
    // one tap: flips (after a moment)
    o.f0 = await st(); await p.touchscreen.tap(cx, cy); await p.waitForTimeout(700); o.f1 = await st();
    await p.touchscreen.tap(cx, cy); await p.waitForTimeout(700); // (flip back)
    // a double tap: Inspect
    await p.touchscreen.tap(cx, cy); await p.waitForTimeout(120); await p.touchscreen.tap(cx, cy); await p.waitForTimeout(1500); o.dt = await st();
    for (let k = 0; k < 3 && (await st()).mode !== 'browse'; k++) { await p.keyboard.press('Escape'); await p.waitForTimeout(900); }
    // a quick swipe up: Details; a quick swipe down: back
    await swipe(cx, 400, cx, 230, 200); o.up = await st();
    await swipe(426, 150, 426, 360, 200); o.down = await st();
    // a slow drag up: nothing
    await swipe(cx, 400, cx, 230, 900); o.slow = await st();
    // sideways on the shelf: still browses
    const g0 = (await st()).g; await swipe(600, 300, 250, 300, 220); o.side = await st(); o.g0 = g0;
    // (beta.12) in Inspect with the case open: a finger on the manual opens it to read; anywhere else the disc comes out
    for (let k = 0; k < 3 && (await st()).mode !== 'browse'; k++) { await p.keyboard.press('Escape'); await p.waitForTimeout(900); }
    for (let i = 0; i < 8; i++) { if (await p.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(350); }
    await p.waitForTimeout(600);
    // (Inspect opened directly here: the double tap is checked above, and a slow machine can see it as two taps)
    await p.evaluate(() => Shelf.bottomCmd('inspect')); await p.waitForFunction(() => Shelf.getMode() === 'inspect', null, { timeout: 20000, polling: 200 }).catch(() => {}); await p.waitForTimeout(1500);
    o.isp0 = await p.evaluate(() => ({ mode: Shelf.getMode(), state: Shelf._isp().state }));
    await p.touchscreen.tap(426, 400); await p.waitForFunction(() => Shelf._isp().state === 1, null, { timeout: 10000, polling: 200 }).catch(() => {}); await p.waitForTimeout(800); // (one tap: the case opens)
    o.isp1 = await p.evaluate(() => Shelf._isp().state);
    // (where the manual is once the lid has finished opening: measured until it stops moving, the 3D lid eases open)
    const manAt = () => p.evaluate(() => { if (window.Inspect3D && Inspect3D.isActive()) { const m = Inspect3D._st().manual; return m ? { x: m.x, y: m.y, gl: true } : null; }
      const r = document.querySelector('#inspect .isp-manual').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), gl: false }; });
    let man = await manAt();
    for (let i = 0; i < 12; i++) { await p.waitForTimeout(400); const m2 = await manAt(); const still = man && m2 && Math.abs(m2.x - man.x) <= 2 && Math.abs(m2.y - man.y) <= 2; man = m2; if (still) break; }
    o.man = man;
    if (man) { await p.touchscreen.tap(man.x, man.y); for (let i = 0; i < 30 && !(await p.evaluate(() => Shelf._rd().open)); i++) await p.waitForTimeout(250); }
    o.read = await p.evaluate(() => ({ open: Shelf._rd().open, state: Shelf._isp().state }));
    await p.keyboard.press('Escape'); await p.waitForTimeout(900);
    o.afterRead = await p.evaluate(() => ({ open: Shelf._rd().open, mode: Shelf.getMode(), state: Shelf._isp().state }));
    // a tap off the manual (the bottom middle, on the tray): the disc comes out, as before
    await p.touchscreen.tap(man && man.x < 426 ? 640 : 200, 420); await p.waitForTimeout(1400);
    o.disc = await p.evaluate(() => ({ open: Shelf._rd().open, state: Shelf._isp().state }));
    for (let k = 0; k < 4 && (await st()).mode !== 'browse'; k++) { await p.keyboard.press('Escape'); await p.waitForTimeout(900); }
  } catch (e) { o.err = e.message; }
  await ctx.close();
  check('Touch (beta.12, Android): one tap on the case you\'re on still flips it; a double tap picks it up (Inspect)', (o.f1 || {}).flipped !== (o.f0 || {}).flipped && (o.dt || {}).mode === 'inspect', JSON.stringify({ f0: o.f0, f1: o.f1, dt: o.dt, err: o.err }));
  check('Touch: a quick swipe up on the shelf opens Details, a quick swipe down closes it; a slow drag or a sideways swipe opens nothing',
    (o.up || {}).mode === 'details' && (o.down || {}).mode === 'browse' && (o.slow || {}).mode === 'browse' && (o.side || {}).mode === 'browse', JSON.stringify({ up: o.up, down: o.down, slow: o.slow, side: o.side }));
  check('Touch (beta.12): in Inspect with the case open, a finger on the manual opens it to read; a tap elsewhere takes the disc out as before',
    (o.isp0 || {}).mode === 'inspect' && o.isp1 === 1 && !!o.man && (o.read || {}).open === true && (o.afterRead || {}).open === false && (o.afterRead || {}).mode === 'inspect' && (o.disc || {}).open === false && (o.disc || {}).state === 2,
    JSON.stringify({ isp0: o.isp0, isp1: o.isp1, man: o.man, read: o.read, afterRead: o.afterRead, disc: o.disc, err: o.err }));
  check('Touch gestures pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
