// Device test (beta.12): the Art Studio doesn't wait for its slowest source. The pretend API (window.__artLate) answers
// with the versions it has and "pending"; the header says "still looking…", the cards already there show, and the late
// version joins them as a whole card (with its picture) while the cursor stays on the card it was on. Windows 1600x900.
'use strict';
module.exports = async function artLatePass({ browser, base, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  // the slow source from the start, and slow enough for a slow machine: whenever the Back's list is fetched (in the
  // background before the Art Studio opens, or when its tab is picked) it's still "looking" when the test gets there
  await ctx.addInitScript(() => { window.__artLate = 14000; });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); let o = {};
  try {
    await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._tour, null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1200);
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400); }
    // (the Front's list may already be fetched in the background: the Back's is asked for fresh, with the slow source on)
    await page.evaluate(() => Shelf._tour.artStudio());
    await page.waitForFunction(() => document.querySelectorAll('#bss .bsa-part').length > 3, null, { timeout: 30000, polling: 200 });
    await page.waitForTimeout(800);
    await page.evaluate(() => { const b = [...document.querySelectorAll('#bss .bsa-part')].find(e => /^\s*back/i.test(e.textContent)); if (b) b.click(); });
    const snap = () => page.evaluate(() => ({ head: (document.querySelector('#bss .bsa-ch span') || {}).textContent || '', cards: document.querySelectorAll('#bss .bsa-card .in:not(.act)').length,
      sel: ((document.querySelector('#bss .bsa-card.sel .ed') || {}).textContent || '').trim().slice(0, 60), /* (its name line: the size chip changes as its picture arrives) */ retry: [...document.querySelectorAll('#bss .bsa-card .in.act .ed')].some(e => /Try again/.test(e.textContent)) }));
    await page.waitForFunction(() => /still looking/.test((document.querySelector('#bss .bsa-ch span') || {}).textContent || '') && document.querySelectorAll('#bss .bsa-card .in:not(.act)').length > 0, null, { timeout: 15000, polling: 100 });
    // the cursor onto the second version (a mouse over it), so there's a card to stay on
    const r = await page.evaluate(() => { const e = document.querySelectorAll('#bss .bsa-card')[1]; if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    // (then off the cards, to the page's title: a card sliding under a resting mouse would be chosen by it, as it should)
    if (r) { await page.mouse.move(r[0] - 20, r[1] - 20); await page.mouse.move(r[0], r[1], { steps: 4 });
      await page.waitForFunction(() => document.querySelector('#bss .bsa-card.sel'), null, { timeout: 5000, polling: 100 }).catch(() => {}); await page.mouse.move(700, 60, { steps: 4 }); await page.waitForTimeout(200); }
    o.before = await snap();
    await page.waitForFunction(() => { const t = (document.querySelector('#bss .bsa-ch span') || {}).textContent || ''; return t && !/still looking/.test(t); }, null, { timeout: 30000, polling: 100 });
    await page.waitForTimeout(400);
    o.after = await snap();
    o.lateThumb = await page.evaluate(() => [...document.querySelectorAll('#bss .bsa-card .in:not(.act) .im')].every(e => e.querySelector('img') || e.querySelector('.bsa-ph.wait')));
  } catch (e) { o.err = e.message; }
  await ctx.close();
  const b = o.before || {}, a = o.after || {};
  check('Art Studio (beta.12): the versions found so far show at once while a slow source is still answering ("still looking…")', /so far · still looking/.test(b.head || '') && b.cards > 0 && !b.retry, JSON.stringify(o).slice(0, 500));
  check('Art Studio: the late version joins the list as a card, "still looking" goes, and the cursor stays on its card', a.cards === b.cards + 1 && !/still looking/.test(a.head || '') && a.sel && a.sel === b.sel, JSON.stringify(o).slice(0, 500));
  check('Art Studio late-source pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
