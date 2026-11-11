// (beta.11) Console trailers: a game with no trailer link, or a dead one, gets YouTube searched for its trailer (a pretend
// helper answers here): the right result is picked, it's remembered, a miss is remembered too, a dead link is known.
// Plain Node: node android-app/ci/ytsearch-test.js  → exits 1 on a failure
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const y = require(path.join(__dirname, '..', '..', 'main', 'ytclips.js'));
let bad = 0; const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`); if (!ok) bad++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-yts-'));
(async () => {
  try {
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true }); fs.writeFileSync(path.join(dir, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), Buffer.alloc(2e6)); // (a helper "is there"; beta.11: the Linux one has no .exe)
    y.init({ dataDir: dir, log: () => {} }); y._force(true); y._reset(); let runs = 0, lastArgs = [];
    y._setRun(async args => { runs++; lastArgs = args; const q = args[args.length - 1];
      if (/Sonic/.test(q)) return ['aaaaaaaaaaa\tSonic X Shadow Generations Review\t540', 'bbbbbbbbbbb\tSONIC X SHADOW GENERATIONS - Launch Trailer\t92', 'ccccccccccc\tSonic Generations Longplay\t9000'].join('\n');
      return 'ddddddddddd\tSomething Else Entirely - Trailer\t60\n'; });
    const a = await y.search('Sonic X Shadow Generations', 'sw', 'Nintendo Switch');
    check('the search picks the trailer (not the review or a longplay)', a === 'bbbbbbbbbbb', a);
    check('it searches "<title> <console> trailer" with the helper', /^ytsearch\d+:Sonic X Shadow Generations Nintendo Switch trailer$/.test(lastArgs[lastArgs.length - 1]) && lastArgs.includes('--flat-playlist'), JSON.stringify(lastArgs));
    const r0 = runs; const a2 = await y.search('Sonic X Shadow Generations', 'sw', 'Nintendo Switch');
    check('the answer is remembered (no second search)', a2 === 'bbbbbbbbbbb' && runs === r0 && y.searchKnown('Sonic X Shadow Generations', 'sw') === 'bbbbbbbbbbb');
    const m = await y.search('Obscure Game', 'gc', 'GameCube');
    check('nothing that fits: no video, and the miss is remembered', m === null && y.searchKnown('Obscure Game', 'gc') === null);
    fs.mkdirSync(path.join(dir, 'previews', 'youtube'), { recursive: true }); fs.writeFileSync(path.join(dir, 'previews', 'youtube', 'eeeeeeeeeee.none'), 'Private video');
    check('a dead link (private / removed) is known as gone', y.gone('eeeeeeeeeee') === true && y.gone('bbbbbbbbbbb') === false);

    // (beta.11) every result that fits is kept, best first, and one known to be gone is passed over
    const yd = path.join(dir, 'previews', 'youtube'), started = [];
    y._setRun(async args => { const last = args[args.length - 1];
      if (/^ytsearch/.test(last)) return ['eeeeeeeeeee\tBowsers Fury - Official Trailer\t120', 'fffffffffff\tBowsers Fury - Official Reveal Trailer (Nintendo Switch)\t95', 'ggggggggggg\tBowsers Fury Launch Trailer\t80', 'hhhhhhhhhhh\tBowsers Fury Review\t400'].join('\n');
      const id = String(last).split('v=')[1]; started.push(id);
      if (id === 'fffffffffff') throw new Error('ERROR: [youtube] fffffffffff: This video is not available');
      throw new Error('HTTP Error 403: Forbidden'); });
    const list = await y.searchList('Bowsers Fury', 'sw', 'Nintendo Switch');
    check('the search keeps every result that fits, best first, without the one that\'s gone or the review', JSON.stringify(list) === JSON.stringify(['fffffffffff', 'ggggggggggg']), JSON.stringify(list));
    // a result YouTube won't let the helper have (only preview pictures) is passed over for the next; the one that works
    // is remembered first (here the next one's clip is already kept)
    fs.writeFileSync(path.join(yd, 'ggggggggggg.hd.mp4'), Buffer.alloc(1000));
    const got = await y.clipFromSearch('Bowsers Fury', 'sw', 'Nintendo Switch');
    check('a result that can\'t be clipped is passed over for the next one, which is then remembered first',
      !!got && got.id === 'ggggggggggg' && /ggggggggggg\.hd\.mp4$/.test(got.file) && y.gone('fffffffffff') && y.searchKnown('Bowsers Fury', 'sw') === 'ggggggggggg' && started.join() === 'fffffffffff', JSON.stringify({ got, started }));
    // an answer kept before beta.11 (one video, no list) whose video is gone: searched again, not "nothing for a week"
    const sj = path.join(yd, 'search.json'), memo = JSON.parse(fs.readFileSync(sj, 'utf8'));
    memo['sw|old entry game'] = { id: 'fffffffffff', at: Date.now() }; fs.writeFileSync(sj, JSON.stringify(memo)); y._reset();
    check('an older answer whose only video is gone gets searched again', y.searchKnown('Old Entry Game', 'sw') === undefined, String(y.searchKnown('Old Entry Game', 'sw')));
    // a failure that isn't the video's own (here HTTP 403) stops there: the next results are left for another time
    started.length = 0; y._reset(); fs.unlinkSync(path.join(yd, 'ggggggggggg.hd.mp4'));
    const s2 = await y.clipFromSearch('Bowsers Fury Two', 'sw', 'Nintendo Switch');
    check('a failure that isn\'t the video\'s stops the tries (nothing marked gone)', s2 === null && started.length === 1 && !y.gone(started[0]), JSON.stringify(started));

    // (beta.11) the queue: two clips at a time; one made ahead (low) waits behind every clip asked for now
    y._reset(); started.length = 0;
    y._setRun(args => new Promise((res, rej) => { const id = String(args[args.length - 1]).split('v=')[1]; started.push(id); setTimeout(() => rej(new Error('HTTP Error 403: Forbidden')), 150); }));
    const pA = y.clip('lowaaaaaaaa', { low: true }); await new Promise(r => setTimeout(r, 20));
    const pB = y.clip('nowbbbbbbbb'), pC = y.clip('nowccccccc1'), pD = y.clip('lowddddddd1', { low: true }), pE = y.clip('nowccccccc2');
    await new Promise(r => setTimeout(r, 40)); const early = started.slice();
    await Promise.all([pA, pB, pC, pD, pE]);
    check('two clips are made at once; asks for now go ahead of ones made ahead', early.join() === 'lowaaaaaaaa,nowbbbbbbbb' && started.join() === 'lowaaaaaaaa,nowbbbbbbbb,nowccccccc2,nowccccccc1,lowddddddd1', JSON.stringify({ early, started }));
  } catch (e) { check('ran to the end', false, e.stack); }
  finally { y._force(false); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(bad ? `ytsearch-test: ${bad} FAILED` : 'ytsearch-test: all passed'); process.exit(bad ? 1 : 0);
})();
