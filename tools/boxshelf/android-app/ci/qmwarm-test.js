// Device test (beta.12): the quick menu is never seen by itself after start-up. qmPrewarm draws it once, unseen (opacity
// .004), so its first real open is quick; leaving that ran the panel's slide-out at full opacity, and a moment after
// start-up the whole menu was seen sliding away. Every frame for the first ~15 s: while the menu isn't open, its panel is
// never both visible and on screen. Windows 1600x900.
'use strict';
module.exports = async function qmWarmPass({ browser, base, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { window.__qmSeen = []; window.__qmWarmed = false;
    const tick = () => { const q = document.querySelector('#app .qm'), app = document.getElementById('app');
      if (q && app) { if (app.classList.contains('qm-warm')) window.__qmWarmed = true;
        if (!app.classList.contains('qm-open') && !app.classList.contains('qm-warm')) { const cs = getComputedStyle(q), r = q.getBoundingClientRect();
          if (cs.visibility === 'visible' && +cs.opacity > .05 && r.left < innerWidth - 4 && r.right > 4) window.__qmSeen.push(Math.round(performance.now())); } }
      requestAnimationFrame(tick); };
    requestAnimationFrame(tick); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); let o = {};
  try {
    await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g, null, { timeout: 90000, polling: 250 });
    await page.waitForFunction(() => window.__qmWarmed, null, { timeout: 30000, polling: 200 }).catch(() => {});
    await page.waitForTimeout(2500);
    o = await page.evaluate(() => ({ warmed: window.__qmWarmed, seenFrames: window.__qmSeen.length, at: window.__qmSeen.slice(0, 5) }));
  } catch (e) { o.err = e.message; }
  await ctx.close();
  check('Quick menu (beta.12): drawn once unseen after start-up, and never seen sliding away by itself', o.warmed === true && o.seenFrames === 0, JSON.stringify(o));
  check('Quick menu warm-up pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
