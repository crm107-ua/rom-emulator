// Device test (beta.12, Android): one game in its own emulator app. On the pretend Thor (?fakeNative=1): the app's
// gameEmulator offers the shelf's emulator first, then the installed emulator apps for that console; a pick is kept in
// config.games["<console>:<file>"].emulator, that game then starts in that app while the rest of its shelf doesn't; picking
// "The shelf's emulator" clears it. For a RetroArch console the core is asked for and used.
'use strict';
module.exports = async function gameEmuPass({ browser, base, check, newPage }) {
  const { ctx, page, errors } = await newPage(browser);
  const o = {};
  try {
    await page.goto(base + '?fakeNative=1'); await page.waitForTimeout(4000);
    await page.evaluate(async () => { const api = window.boxshelf, c = (await api.getConfig()).config, det = await api.detect();
      window.__fakePickNext = 'primary:ROMs'; const root = await api.romRoot(); c.romRoot = root.path;
      for (const f of root.found) { c.systems[f.id].romDirs = [f.dir]; c.systems[f.id].emulator = det.systems[f.id].emulator; }
      c.setupDone = true; await api.saveConfig(c); await api.scan(); });
    o.r = await page.evaluate(async () => { const api = window.boxshelf, lib = await api.cachedLibrary(), out = { has: typeof api.gameEmulator };
      const pkgOfLaunch = () => { const L = window.__fakeN && window.__fakeN.launched; return null; };
      // a console with at least two games and at least two installed emulator apps to choose from
      for (const sh of lib) { const games = (sh.games || []).filter(g => g.kind === 'rom'); if (games.length < 2) continue;
        window.__fakeLists = []; window.__fakeChoose = ['@shelf']; let r0; try { r0 = await api.gameEmulator(games[0].id); } catch (e) { continue; }
        const items = (window.__fakeLists[0] || {}).items || []; if (items.length < 3) continue;
        const shelfEmu = String((await api.getConfig()).config.systems[sh.id].emulator || ''), other = items.find(x => x.pkg !== '@shelf' && !shelfEmu.includes('(' + x.pkg + ')')); if (!other) continue;
        out.sys = sh.id; out.first = items[0].label; out.n = items.length;
        window.__fakeLists = []; window.__fakeChoose = [other.pkg, '@core:']; const r1 = await api.gameEmulator(games[0].id);
        out.saved = ((r1.games || {})[games[0].id] || {}).emulator || ''; out.coreAsked = window.__fakeLists.length > 1; out.core = ((r1.games || {})[games[0].id] || {}).core || '';
        out.cfg = (((await api.getConfig()).config.games || {})[games[0].id] || {}).emulator || '';
        const sent = []; const N = window.__fakeN, L0 = N.launch; N.launch = async req => { sent.push(req.pkg + '|' + JSON.stringify(req.extras || {})); return {}; };
        try { await api.launchGame(sh.id, games[0].file); } catch (e) { out.err1 = e.message; } window.dispatchEvent(new Event('focus'));
        try { if (N.fire) N.fire('resume'); } catch {} await new Promise(r => setTimeout(r, 700));
        try { await api.launchGame(sh.id, games[1].file); } catch (e) { out.err2 = e.message; }
        try { if (N.fire) N.fire('resume'); } catch {} await new Promise(r => setTimeout(r, 700));
        N.launch = L0; out.sent = sent; out.other = other.pkg;
        window.__fakeChoose = ['@shelf']; const r2 = await api.gameEmulator(games[0].id); out.cleared = !((r2.games || {})[games[0].id] || {}).emulator;
        break; }
      return out; });
  } catch (e) { o.err = e.message; }
  await ctx.close();
  const r = o.r || {};
  check('Android (beta.12): Details → Emulator offers the shelf\'s emulator first, then the installed ones for that console; a pick is kept for that game',
    r.has === 'function' && /^The shelf's emulator/.test(r.first || '') && r.n >= 3 && r.saved && r.saved === r.cfg && r.saved.includes('(' + r.other + ')'), JSON.stringify({ r, err: o.err }).slice(0, 700));
  check('Android: that game starts in its own emulator, the next game on the shelf in the shelf\'s; "The shelf\'s emulator" clears it',
    (r.sent || []).length === 2 && r.sent[0].startsWith(r.other + '|') && !r.sent[1].startsWith(r.other + '|') && r.cleared === true && (!r.coreAsked || !r.core || r.sent[0].includes(r.core)), JSON.stringify({ sent: r.sent, cleared: r.cleared, coreAsked: r.coreAsked, core: r.core, e1: r.err1, e2: r.err2 }).slice(0, 700));
  check('Game emulator pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
