// Device test (beta.12): the achievements screen as a wall of badges with a card for the one you're on. The browser
// double's pretend set (?ra=1): 40 achievements, 6 unlocked, story steps, a win condition, missables, every rarity.
// Checks: one badge each with its rarity rim (all four tiers), the card has the full title and description, the arrows
// move along and down the wall, S / Y sorts (rarest first, the one you were on still selected), the tabs filter, a click
// selects, Esc closes; on a Thor-sized screen the card and the wall stay clear of the hint bar.
'use strict';
module.exports = async function achWallPass({ browser, base, check }) {
  const errors = [], o = {};
  const PAD = `(() => { const pad = window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }; Navigator.prototype.getGamepads = function () { return [pad, null, null, null]; }; })();`;
  const open = async (vp, pad) => {
    const ctx = await browser.newContext({ viewport: vp }); if (pad) await ctx.addInitScript(PAD); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '?platform=windows&shelf=1&ra=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 12; i++) { if (await page.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
    await page.keyboard.press('i'); await page.waitForFunction(() => { const b = document.getElementById('dAchBtn'); return b && !b.hidden; }, null, { timeout: 20000, polling: 200 });
    await page.click('#dAchBtn'); await page.waitForFunction(() => Shelf.getMode() === 'achv' && document.querySelectorAll('#achList .ach').length > 0, null, { timeout: 15000, polling: 200 });
    await page.waitForTimeout(700); return { ctx, page };
  };
  const st = page => page.evaluate(() => { const L = [...document.querySelectorAll('#achList .ach')], sel = L.findIndex(t => t.classList.contains('sel')), c = document.getElementById('achCard'), t = c.querySelector('.ach-card-t');
    return { n: L.length, locked: L.filter(t => t.classList.contains('locked')).length, sel, selTop: sel >= 0 ? Math.round(L[sel].getBoundingClientRect().top) : null,
      shelf: document.querySelectorAll('#achList .ach-shelf .ach').length, shelfLocked: document.querySelectorAll('#achList .ach-shelf .ach.locked').length,
      secs: [...document.querySelectorAll('#achList .ach-sec span')].map(s => s.textContent).join('|'), cols: getComputedStyle(document.getElementById('achList')).gridTemplateColumns.split(' ').length,
      tiers: [...new Set(L.map(t => t.dataset.tier))].sort().join(','), miss: L.filter(t => t.classList.contains('miss')).length,
      title: t.textContent, titleFits: t.scrollWidth <= t.clientWidth + 1, desc: c.querySelector('.ach-card-d').textContent, tier: c.querySelector('.ach-tier').textContent, tags: c.querySelector('.ach-tags').textContent,
      facts: c.querySelector('.ach-facts').innerText.replace(/\s+/g, ' '), firstTitle: L[0] && L[0].title, hint: (document.getElementById('achHints') || {}).innerText || '', mode: Shelf.getMode(),
      tabs: (document.getElementById('achTabs') || {}).innerText.replace(/\s+/g, ' ') }; });
  try {
    let { ctx, page } = await open({ width: 1600, height: 900 });
    o.a = await st(page);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); o.right = await st(page);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); o.down = await st(page);
    for (let k = 0; k < 3; k++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(120); } await page.waitForTimeout(200); o.up = await st(page);
    await page.click('#achList .ach[title^="A Very Long"]'); await page.waitForTimeout(200); o.click = await st(page);
    await page.keyboard.press('s'); await page.waitForTimeout(250); o.sort = await st(page);
    o.rarest = await page.evaluate(() => { const t = document.querySelector('#achList > .ach'); return t && t.dataset.tier; });
    await page.keyboard.press('e'); await page.waitForTimeout(250); o.got = await st(page);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500); o.closed = await page.evaluate(() => Shelf.getMode());
    await ctx.close();
    // the Thor's screen: nothing under the hint bar; Y (the controller) sorts
    ({ ctx, page } = await open({ width: 853, height: 480 }, true));
    o.thor = await page.evaluate(() => { const h = document.getElementById('achHints').getBoundingClientRect(), c = document.getElementById('achCard').getBoundingClientRect(), l = document.getElementById('achList').getBoundingClientRect();
      return { cardBottom: Math.round(c.bottom), listBottom: Math.round(l.bottom), hintTop: Math.round(h.top), cols: getComputedStyle(document.getElementById('achList')).gridTemplateColumns.split(' ').length }; });
    await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); if (window.__padHold) { await __padHold(__pad, 3, 250); await w(350); return; } __pad.buttons[3] = { pressed: true, touched: true, value: 1 }; __pad.timestamp++; await w(250); __pad.buttons[3] = { pressed: false, touched: false, value: 0 }; __pad.timestamp++; await w(350); });
    o.padSort = await st(page);
    await ctx.close();
  } catch (e) { o.err = e.message; }
  const a = o.a || {};
  check('Achievements (beta.12): the trophy shelf has the 6 unlocked, the wall the 34 locked in sections (Story, Missable, Everything else), every rarity known and the missable marks; it opens on the first locked one, its card beside it',
    a.n === 40 && a.locked === 34 && a.shelf === 6 && a.shelfLocked === 0 && a.secs === 'Your trophies|Story|Missable|Everything else' && a.cols >= 7 && a.tiers === 'common,rare,ultra,uncommon' && a.miss === 3 && a.sel === 6 && /Find a fossil/.test(a.title) && /Story/.test(a.tags) && /POINTS|Points/.test(a.facts), JSON.stringify({ a, err: o.err }));
  check('Achievements: right moves along, down goes to the row below, up goes back to the shelf; a click selects; the card has the whole long title and description',
    (o.right || {}).sel === 7 && (o.down || {}).selTop > (o.right || {}).selTop && (o.up || {}).sel < 6 && (o.click || {}).sel < 6 && /Used To Be Cut Off/.test((o.click || {}).title) && (o.click || {}).titleFits && /never cut off/.test((o.click || {}).desc) && /Unlocked/.test((o.click || {}).facts),
    JSON.stringify({ right: o.right && [o.right.sel, o.right.selTop], down: o.down && [o.down.sel, o.down.selTop], up: (o.up || {}).sel, click: o.click }));
  check('Achievements: S sorts by rarity (the wall in rarity tiers, rarest first, the one you were on still selected, the bar says so); the Unlocked tab shows only the 6 unlocked; Esc closes',
    o.rarest === 'ultra' && /^Your trophies\|Ultra rare\|Rare\|/.test((o.sort || {}).secs || '') && /Sort: Rarity/.test((o.sort || {}).hint) && /Used To Be Cut Off/.test((o.sort || {}).title) && (o.got || {}).n === 6 && (o.got || {}).locked === 0 && /Unlocked 6/.test((o.got || {}).tabs) && o.closed === 'details',
    JSON.stringify({ rarest: o.rarest, sortHint: (o.sort || {}).hint, sortTitle: (o.sort || {}).title, got: o.got && { n: o.got.n, locked: o.got.locked, tabs: o.got.tabs }, closed: o.closed }));
  const t = o.thor || {};
  check('Achievements on a Thor-sized screen: the wall and the card stay clear of the hint bar; Y on the controller sorts', t.cardBottom <= t.hintTop && t.listBottom <= t.hintTop + 2 && t.cols >= 5 && /Sort: Rarity/.test((o.padSort || {}).hint),
    JSON.stringify({ thor: t, padHint: (o.padSort || {}).hint }));
  check('Achievements wall pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
