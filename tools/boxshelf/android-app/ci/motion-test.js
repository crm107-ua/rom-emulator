// Device test (beta.12): Reduce motion. With the system's animation effects off (Windows 11's switch, "Adjust for best
// performance", debloat tools: Chromium reports prefers-reduced-motion), the shelf used to jump from game to game.
// Now Boxshelf's own setting decides: Off (the default) keeps every effect whatever the system says, Follow the system
// tones down only when the system asks, On tones down; the shelf slides from game to game in every one of them.
'use strict';
module.exports = async function motionPass({ browser, base, check }) {
  const errors = [], o = {};
  const st = page => page.evaluate(() => { const s = document.querySelector('#app .slot'), d = s ? getComputedStyle(s).transitionDuration.split(',').map(x => parseFloat(x) || 0) : [0];
    return { reduce: document.body.classList.contains('reduce-motion'), slide: Math.max(...d), mq: matchMedia('(prefers-reduced-motion: reduce)').matches }; });
  const open = async reducedMotion => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, reducedMotion }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1500); return { ctx, page };
  };
  try {
    // the system asks for reduced motion
    let { ctx, page } = await open('reduce');
    o.off = await st(page);
    // the shelf really moves: mid-slide, the selected case sits between where it was and where it lands
    o.moving = await page.evaluate(async () => { const box = () => { const s = document.querySelector('#app .slot.sel'); return s ? s.getBoundingClientRect().left : null; };
      const sel0 = document.querySelector('#app .slot.sel'), x0 = sel0 && sel0.getBoundingClientRect().left;
      // (every frame and every 25 ms for 2 s, not one look at 90 ms: on a slow machine the slide may not have started by then)
      dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const xs = [], t0 = performance.now(), look = () => { if (sel0) xs.push(sel0.getBoundingClientRect().left); };
      const iv = setInterval(look, 25); await new Promise(r => { const f = () => { look(); if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); clearInterval(iv);
      const x1 = sel0 && sel0.getBoundingClientRect().left, xm = xs.find(x => Math.abs(x - x0) > 2 && Math.abs(x - x1) > 2);
      return { x0, xm: xm == null ? null : xm, x1, n: xs.length, mid: x0 != null && xm != null }; });
    await page.evaluate(() => Shelf.applyUi({ reduceMotion: 'system' })); await page.waitForTimeout(200); o.follow = await st(page);
    await page.evaluate(() => Shelf.applyUi({ reduceMotion: true })); await page.waitForTimeout(200); o.on = await st(page);
    await page.evaluate(() => Shelf.applyUi({ reduceMotion: false })); await page.waitForTimeout(200); o.back = await st(page);
    await ctx.close();
    // the system doesn't ask: Follow the system keeps every effect
    ({ ctx, page } = await open('no-preference'));
    await page.evaluate(() => Shelf.applyUi({ reduceMotion: 'system' })); await page.waitForTimeout(200); o.followNo = await st(page);
    await ctx.close();
  } catch (e) { o.err = e.message; }
  const f = o.off || {};
  check('Reduce motion (beta.12): with the system asking for reduced motion, Off (the default) keeps every effect and the shelf slides', f.mq && !f.reduce && f.slide > .1 && (o.moving || {}).mid, JSON.stringify({ off: o.off, moving: o.moving, err: o.err }));
  check('Reduce motion: Follow the system tones down only when the system asks; On tones down; the shelf still slides in both; back to Off', (o.follow || {}).reduce && (o.follow || {}).slide > .1 && (o.on || {}).reduce && (o.on || {}).slide > .1 && !(o.back || {}).reduce && (o.followNo || {}).reduce === false,
    JSON.stringify({ follow: o.follow, on: o.on, back: o.back, followNo: o.followNo }));
  check('Reduce motion pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
