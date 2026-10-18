// 단어 스쿨버스 — 게임 동작. 단어는 words.js 의 RAW 에서 읽습니다.
(function(){
'use strict';

var GRADES = [
  ['K','유치원','Kindergarten',0],
  ['1','1학년','Grade 1',1],['2','2학년','Grade 2',1],['3','3학년','Grade 3',1],['4','4학년','Grade 4',1],['5','5학년','Grade 5',1],
  ['6','6학년','Grade 6',2],['7','7학년','Grade 7',2],['8','8학년','Grade 8',2],
  ['9','9학년','Grade 9',3],['10','10학년','Grade 10',3],['11','11학년','Grade 11',3],['12','12학년','Grade 12',3]
];
var GROUPS = [['유치원','Kindergarten'],['초등학교','Elementary school'],['중학교','Middle school'],['고등학교','High school']];
var LEVELS = ['하','중','상'];
var ROUND = 50;

function partsOf(m){ return m.split(', '); }
function kind(m){
  var f = partsOf(m)[0].replace(/\s*\(.*?\)\s*/g,'').trim();
  if (/다$/.test(f)) return 'v';
  if (/(한|운|은|는|인|된|큰|른|쁜|픈|긴|의)$/.test(f)) return 'a';
  return 'n';
}
var SETS = {}, TOTAL = 0;
Object.keys(RAW).forEach(function(key){
  SETS[key] = RAW[key].split('|').map(function(s,i){
    var p = s.indexOf('='), m = s.slice(p+1);
    return {i:i, w:s.slice(0,p), m:m, k:kind(m), parts:partsOf(m)};
  });
  TOTAL += SETS[key].length;
});

function $(id){ return document.getElementById(id); }
function shuffle(a){
  for (var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; }
  return a;
}
function labelOf(key){
  var p = key.split('-'), g = GRADES.filter(function(x){ return x[0]===p[0]; })[0];
  return g[1] + ' · ' + LEVELS[p[1]-1];
}

/* ---- saved settings and records (this browser only) ---- */
var saved = {};
try { saved = JSON.parse(localStorage.getItem('wordbus.v1')) || {}; } catch(e){ saved = {}; }
if (!saved.rec || typeof saved.rec !== 'object') saved.rec = {};
function persist(){ try { localStorage.setItem('wordbus.v1', JSON.stringify(saved)); } catch(e){} }

/* ---- wrong-word notes: word -> times missed, across all levels ---- */
var INDEX = {}, HARD = 5;
Object.keys(SETS).forEach(function(key){ SETS[key].forEach(function(w){ INDEX[w.w] = {key:key, i:w.i}; }); });
if (!saved.wrong || typeof saved.wrong !== 'object') saved.wrong = {};
function addWrong(word){ saved.wrong[word] = (saved.wrong[word] || 0) + 1; persist(); }
function noteList(){
  return Object.keys(saved.wrong).filter(function(w){ return INDEX[w] && saved.wrong[w] > 0; })
    .map(function(w){ var r = INDEX[w], e = SETS[r.key][r.i]; return {w:w, m:e.m, i:e.i, key:r.key, n:saved.wrong[w]}; })
    .sort(function(a,b){ return b.n - a.n || a.w.localeCompare(b.w); });
}
var TABS = ['game','study','notes'];
var tab = TABS.indexOf(saved.tab) >= 0 ? saved.tab : 'game';

/* ---- voice ---- */
var synth = ('speechSynthesis' in window) ? window.speechSynthesis : null;
var voice = null;
function pickVoice(){
  if (!synth) return;
  var vs = [];
  try { vs = synth.getVoices() || []; } catch(e){}
  var us = vs.filter(function(v){ return /^en[-_]US/i.test(v.lang); });
  voice = us.filter(function(v){ return /Samantha|Google US English|Aria|Jenny|Ava|Allison/i.test(v.name); })[0]
       || us[0] || vs.filter(function(v){ return /^en/i.test(v.lang); })[0] || null;
}
if (synth){
  pickVoice();
  try { synth.addEventListener('voiceschanged', pickVoice); } catch(e){}
}
function speak(word){
  if (!synth) return;
  try {
    synth.cancel();
    var u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    if (voice) u.voice = voice;
    u.rate = saved.slow ? 0.65 : 0.95;
    synth.speak(u);
  } catch(e){}
}

/* ---- sound effects ---- */
var actx = null;
function tone(f, t, d, type, vol){
  var o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'sine'; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + d + 0.02);
}
function sfx(name){
  if (saved.sfx === false) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = actx || new AC();
    if (actx.state === 'suspended') actx.resume();
    var t = actx.currentTime;
    if (name === 'ok'){ tone(660,t,.1); tone(880,t+.09,.16); }
    else if (name === 'no'){ tone(196,t,.24,'triangle',.14); }
    else { [523,659,784,1047].forEach(function(f,i){ tone(f, t+i*.13, .22); }); }
  } catch(e){}
}

/* ---- screens ---- */
var screen = 'home', game = null, last = null, timer = null, deck = null, pickKey = null, undo = null;
function show(name){
  ['home','play','done','pick','cards','cardsDone'].forEach(function(id){ $(id).hidden = (id !== name); });
  screen = name;
  try { window.scrollTo(0,0); } catch(e){}
}

var HINTS = {
  game: '단계를 고르면 단어 ' + ROUND + '개가 나와요. 틀린 단어는 맞힐 때까지 다시 나와요.',
  study: '단계를 고르고 외울 단어 수를 정하면, 카드를 뒤집으며 뜻과 소리를 익혀요.',
  notes: '게임에서 틀린 단어가 여기에 모여요. 다 외운 단어는 지워 주세요.'
};
function renderHome(){
  Array.prototype.forEach.call($('tabs').children, function(b){ b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
  var nc = noteList().length;
  $('notesBadge').textContent = nc; $('notesBadge').hidden = !nc;
  $('tabNotes').setAttribute('aria-label', '오답 정리, 단어 ' + nc + '개');
  $('tabHint').textContent = HINTS[tab];
  $('grades').hidden = tab === 'notes';
  $('homeFoot').hidden = tab === 'notes';
  $('notesBox').hidden = tab !== 'notes';
  if (tab === 'notes') renderNotes();
  var box = $('grades'); box.textContent = '';
  GROUPS.forEach(function(grp, gi){
    var sec = document.createElement('div'); sec.className = 'grp';
    var h = document.createElement('h2'); h.textContent = grp[0];
    var sm = document.createElement('small'); sm.textContent = grp[1]; h.appendChild(sm);
    var roll = document.createElement('div'); roll.className = 'roll';
    GRADES.filter(function(g){ return g[3] === gi; }).forEach(function(g){
      var row = document.createElement('div'); row.className = 'grade';
      var nm = document.createElement('div'); nm.className = 'g-name';
      var b = document.createElement('b'); b.textContent = g[1];
      var sp = document.createElement('span'); sp.textContent = g[2];
      nm.appendChild(b); nm.appendChild(sp);
      var lv = document.createElement('div'); lv.className = 'g-lv';
      LEVELS.forEach(function(name, li){
        var key = g[0] + '-' + (li+1), rec = saved.rec[key];
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'lv' + (rec ? ' cleared' : '');
        btn.dataset.key = key;
        btn.setAttribute('aria-label', g[1] + ' 난이도 ' + name + (tab === 'study' ? ' 외우기' : '') + ', 단어 ' + SETS[key].length + '개' + (rec ? ', 성공함' : ''));
        var t = document.createElement('span'); t.textContent = name; btn.appendChild(t);
        if (rec){ var st = document.createElement('span'); st.className = 'st'; st.textContent = '★'; btn.appendChild(st); }
        lv.appendChild(btn);
      });
      row.appendChild(nm); row.appendChild(lv); roll.appendChild(row);
    });
    sec.appendChild(h); sec.appendChild(roll); box.appendChild(sec);
  });
  $('homeFoot').textContent = '학년 13개, 단계 39개, 단어 ' + TOTAL.toLocaleString('ko-KR') + '개. 한 판에 ' + ROUND + '단어가 무작위 순서로 나오고, ★는 성공한 단계예요.';
  $('rateSlow').setAttribute('aria-pressed', String(!!saved.slow));
  $('rateNormal').setAttribute('aria-pressed', String(!saved.slow));
  $('sfxOn').setAttribute('aria-pressed', String(saved.sfx !== false));
  $('sfxOff').setAttribute('aria-pressed', String(saved.sfx === false));
}

/* ---- wrong-word notes ---- */
function renderNotes(){
  var box = $('notesBox'); box.textContent = '';
  var all = noteList();
  if (undo){
    var ub = document.createElement('div'); ub.className = 'undo';
    var us = document.createElement('span'); us.textContent = '"' + undo.w + '"를 오답 정리에서 지웠어요.';
    var ubt = document.createElement('button'); ubt.type = 'button'; ubt.className = 'ghost'; ubt.dataset.act = 'undo'; ubt.textContent = '되돌리기';
    ub.appendChild(us); ub.appendChild(ubt); box.appendChild(ub);
  }
  [ {id:'low', title:'1~4번 틀린 단어', items:all.filter(function(x){ return x.n < HARD; })},
    {id:'high', title:HARD + '번 이상 틀린 단어', items:all.filter(function(x){ return x.n >= HARD; })}
  ].forEach(function(g){
    var sec = document.createElement('div'); sec.className = 'ngrp';
    var hd = document.createElement('div'); hd.className = 'ngrp-hd';
    var h = document.createElement('h2'); h.textContent = g.title;
    var sm = document.createElement('small'); sm.textContent = g.items.length + '개'; h.appendChild(sm);
    var sb = document.createElement('button'); sb.type = 'button'; sb.className = 'ghost';
    sb.dataset.act = 'study'; sb.dataset.grp = g.id; sb.textContent = '카드로 외우기'; sb.disabled = !g.items.length;
    hd.appendChild(h); hd.appendChild(sb);
    var ul = document.createElement('ul'); ul.className = 'nlist';
    if (!g.items.length){
      var e = document.createElement('li'); e.className = 'none'; e.textContent = '아직 없어요.'; ul.appendChild(e);
    }
    g.items.forEach(function(x){
      var li = document.createElement('li');
      var b = document.createElement('button'); b.type = 'button'; b.className = 'say'; b.dataset.w = x.w;
      var w = document.createElement('span'); w.className = 'w'; w.textContent = x.w;
      var m = document.createElement('span'); m.className = 'm'; m.textContent = x.m;
      var n = document.createElement('span'); n.className = 'x'; n.textContent = x.n + '번 틀림 · ' + labelOf(x.key);
      b.appendChild(w); b.appendChild(m); b.appendChild(n);
      var d = document.createElement('button'); d.type = 'button'; d.className = 'del'; d.dataset.w = x.w;
      d.textContent = '지우기'; d.setAttribute('aria-label', x.w + ' 오답 정리에서 지우기');
      li.appendChild(b); li.appendChild(d); ul.appendChild(li);
    });
    sec.appendChild(hd); sec.appendChild(ul); box.appendChild(sec);
  });
}
function studyNotes(grp){
  var items = noteList().filter(function(x){ return grp === 'high' ? x.n >= HARD : x.n < HARD; });
  if (!items.length) return;
  startCards(shuffle(items).map(function(x){ return {w:x.w, m:x.m, i:x.i, key:x.key, n:x.n, gone:false}; }),
    'notes', '오답 · ' + (grp === 'high' ? HARD + '번 이상' : '1~4번'), null);
}

/* ---- study: pick how many, then flip cards ---- */
function openPick(key){
  pickKey = key;
  var n = SETS[key].length, box = $('counts'); box.textContent = '';
  $('pickWhere').textContent = labelOf(key) + ' · 외우기';
  $('pickSub').textContent = '이 단계 단어 ' + n + '개 중에서 무작위로 골라요.';
  for (var c = 10; c <= n; c += 10){
    var b = document.createElement('button'); b.type = 'button'; b.dataset.n = c; b.textContent = c;
    var s = document.createElement('small'); s.textContent = '단어'; b.appendChild(s);
    b.setAttribute('aria-label', '단어 ' + c + '개');
    box.appendChild(b);
  }
  show('pick');
}
function startCards(cards, mode, title, key){
  clearTimeout(timer);
  deck = {mode:mode, key:key, title:title, cards:cards, pos:0, flipped:false};
  $('cardsWhere').textContent = title;
  show('cards');
  renderCard();
}
function renderCard(){
  var c = deck.cards[deck.pos];
  $('cardsCount').textContent = (deck.pos + 1) + ' / ' + deck.cards.length;
  setFlip(false, true);
  $('cardWord').textContent = c.w; $('cardWord2').textContent = c.w; $('cardMean').textContent = c.m;
  $('cardNote').textContent = deck.mode === 'notes' ? c.n + '번 틀린 단어' : '';
  $('cardForget').hidden = deck.mode !== 'notes';
  paintForget();
  $('cardPrev').disabled = deck.pos === 0;
  $('cardNext').textContent = deck.pos === deck.cards.length - 1 ? '다 봤어요' : '다음';
  try { $('flip').focus({preventScroll:true}); } catch(e){}
}
function setFlip(on, instant){
  var c = deck.cards[deck.pos], f = $('flip');
  deck.flipped = on;
  if (instant) f.classList.add('instant');
  f.setAttribute('aria-pressed', String(on));
  f.setAttribute('aria-label', on ? c.w + ', 뜻: ' + c.m : '영어 단어 ' + c.w + '. 눌러서 뜻 보기');
  if (instant){ void f.offsetWidth; f.classList.remove('instant'); }
}
function flipCard(){
  if (!deck) return;
  setFlip(!deck.flipped);
  if (deck.flipped) speak(deck.cards[deck.pos].w);
}
function paintForget(){
  var c = deck.cards[deck.pos], b = $('cardForget');
  b.setAttribute('aria-pressed', String(!!c.gone));
  b.textContent = c.gone ? '지웠어요 · 되돌리기' : '다 외웠어요 · 오답에서 지우기';
}
function toggleForget(){
  var c = deck.cards[deck.pos];
  if (c.gone){ saved.wrong[c.w] = c.n; c.gone = false; }
  else { delete saved.wrong[c.w]; c.gone = true; }
  persist(); paintForget();
}
function nextCard(){
  if (!deck) return;
  if (deck.pos < deck.cards.length - 1){ deck.pos++; renderCard(); }
  else finishCards();
}
function prevCard(){
  if (deck && deck.pos > 0){ deck.pos--; renderCard(); }
}
function finishCards(){
  if (synth) { try { synth.cancel(); } catch(e){} }
  var d = deck, gone = d.cards.filter(function(c){ return c.gone; }).length, left = d.cards.length - gone;
  $('cdTitle').textContent = '카드 끝!';
  $('cdSub').textContent = d.title + ' · 단어 ' + d.cards.length + '개를 다 봤어요.' +
    (d.mode === 'notes' ? (gone ? ' 그중 ' + gone + '개를 오답 정리에서 지웠어요.' : '') : ' 이제 게임으로 확인해 보세요.');
  $('cdGame').hidden = d.mode !== 'level';
  $('cdAgain').hidden = !left;
  $('cdHome').textContent = d.mode === 'notes' ? '오답 정리로' : '단계 고르기';
  show('cardsDone');
  sfx('win');
}

/* ---- game ---- */
function pickDistractors(set, w){
  var mine = {}; w.parts.forEach(function(p){ mine[p] = 1; });
  var ok = set.filter(function(x){ return x !== w && !x.parts.some(function(p){ return mine[p]; }); });
  var same = shuffle(ok.filter(function(x){ return x.k === w.k; }));
  var other = shuffle(ok.filter(function(x){ return x.k !== w.k; }));
  var out = [], used = {};
  same.concat(other).some(function(x){
    if (x.parts.some(function(p){ return used[p]; })) return false;
    x.parts.forEach(function(p){ used[p] = 1; });
    out.push(x);
    return out.length === 3;
  });
  return out;
}

// only: word indexes for a short round (review of missed words, or words just studied); not recorded.
var TAGS = { review:['복습','복습 끝!'], learn:['외운 단어','확인 끝!'] };
function tagOf(g){ return TAGS[g.tag] || TAGS.review; }
function startGame(key, only, tag){
  var set = SETS[key];
  var pool = only ? only.slice() : shuffle(set.map(function(w){ return w.i; })).slice(0, ROUND);
  game = { key:key, total:pool.length, queue:shuffle(pool), cur:null, opts:null, answered:false, picked:null,
           attempts:0, miss:{}, mastered:0, review:!!only, tag:tag || 'review' };
  $('quitBar').hidden = true;
  $('where').textContent = labelOf(key) + (only ? ' · ' + tagOf(game)[0] : '');
  $('noVoice').hidden = !!synth;
  show('play');
  nextQuestion();
}

function nextQuestion(){
  clearTimeout(timer);
  if (!game.queue.length) return finish();
  var set = SETS[game.key];
  game.cur = game.queue.shift();
  var w = set[game.cur];
  game.opts = shuffle([w].concat(pickDistractors(set, w))).map(function(x){ return x.i; });
  game.answered = false; game.picked = null;
  renderQuestion();
  speak(w.w);
}

function renderQuestion(){
  var set = SETS[game.key], w = set[game.cur];
  var W = Math.max(360, w.w.length * 44 + 60);
  var svg = $('wordSvg'), tx = $('wordText');
  svg.setAttribute('viewBox', '0 0 ' + W + ' 124');
  svg.setAttribute('aria-label', '영어 단어 ' + w.w);
  tx.setAttribute('x', W / 2);
  tx.textContent = w.w;
  var box = $('answers'); box.textContent = '';
  game.opts.forEach(function(idx, j){
    var b = document.createElement('button'); b.type = 'button'; b.className = 'ans'; b.dataset.j = j;
    var n = document.createElement('span'); n.className = 'n'; n.textContent = j + 1;
    var t = document.createElement('span'); t.className = 't'; t.textContent = set[idx].m;
    b.appendChild(n); b.appendChild(t); box.appendChild(b);
  });
  $('fbMsg').textContent = ''; $('fbMsg').className = 'fb-msg';
  $('nextBtn').hidden = true;
  hud();
  if (game.answered) paintAnswer();
}

function hud(){
  $('count').textContent = game.mastered + ' / ' + game.total;
  $("busMark").style.setProperty('--p', game.total ? game.mastered / game.total : 0);
  $('left').textContent = game.total - game.mastered;
  var seen = {}, n = 0;
  game.queue.forEach(function(i){ if (game.miss[i] && !seen[i]){ seen[i] = 1; n++; } });
  $('again').textContent = n;
}

function paintAnswer(){
  var set = SETS[game.key], w = set[game.cur], right = game.opts[game.picked] === game.cur;
  Array.prototype.forEach.call($('answers').children, function(b, j){
    b.disabled = true;
    if (game.opts[j] === game.cur) b.classList.add('right');
    else if (j === game.picked) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  var msg = $('fbMsg');
  if (right){ msg.textContent = '정답!'; msg.className = 'fb-msg ok'; }
  else {
    msg.textContent = '정답은 "' + w.m + '"예요. 이 단어는 다시 나와요.';
    msg.className = 'fb-msg no';
    $('nextBtn').hidden = false;
  }
}

function answer(j){
  if (!game || game.answered || j < 0 || j >= game.opts.length) return;
  var set = SETS[game.key], w = set[game.cur];
  game.answered = true; game.picked = j; game.attempts++;
  if (game.opts[j] === game.cur){
    game.mastered++;
    sfx('ok');
    timer = setTimeout(nextQuestion, 800);
  } else {
    game.miss[game.cur] = (game.miss[game.cur] || 0) + 1;
    addWrong(w.w);
    var len = game.queue.length, lo = Math.min(3, len);
    game.queue.splice(lo + Math.floor(Math.random() * (len - lo + 1)), 0, game.cur);
    sfx('no');
    timer = setTimeout(function(){ speak(w.w); }, 500);
  }
  paintAnswer();
  hud();
  if (!$('nextBtn').hidden) { try { $('nextBtn').focus({preventScroll:true}); } catch(e){} }
}

function finish(){
  var set = SETS[game.key];
  var missed = Object.keys(game.miss).map(function(i){ return {i:+i, n:game.miss[i]}; })
    .sort(function(a,b){ return b.n - a.n || set[a.i].w.localeCompare(set[b.i].w); });
  var best = null;
  if (!game.review){
    var rec = saved.rec[game.key] || {clears:0, best:null};
    rec.clears++;
    rec.best = rec.best == null ? game.attempts : Math.min(rec.best, game.attempts);
    saved.rec[game.key] = rec; persist();
    best = rec.best;
  }
  last = { key:game.key, total:game.total, attempts:game.attempts, missed:missed, review:game.review, tag:game.tag, best:best };
  game = null;
  renderDone();
  show('done');
  sfx('win');
}

function renderDone(){
  var set = SETS[last.key];
  $('doneTitle').textContent = last.review ? tagOf(last)[1] : '학교 도착!';
  $('doneSub').textContent = labelOf(last.key) + ' · 단어 ' + last.total + '개를 모두 맞혔어요.';
  $('stFirst').textContent = (last.total - last.missed.length) + ' / ' + last.total;
  $('stTries').textContent = last.attempts + '번';
  $('stBest').textContent = last.best == null ? '-' : last.best + '번';
  $('stBestLbl').textContent = last.review ? tagOf(last)[0] + ' 판은 기록에 넣지 않아요' : '이 단계 최고 기록 (적을수록 좋아요)';
  var ul = $('missedList'); ul.textContent = '';
  last.missed.forEach(function(x){
    var li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.dataset.w = set[x.i].w;
    var w = document.createElement('span'); w.className = 'w'; w.textContent = set[x.i].w;
    var m = document.createElement('span'); m.className = 'm'; m.textContent = set[x.i].m;
    var n = document.createElement('span'); n.className = 'x'; n.textContent = x.n + '번 틀림';
    b.appendChild(w); b.appendChild(m); b.appendChild(n); li.appendChild(b); ul.appendChild(li);
  });
  $('missed').hidden = !last.missed.length;
  $('reviewBtn').hidden = !last.missed.length;
}

/* ---- events ---- */
$('grades').addEventListener('click', function(e){
  var b = e.target.closest('.lv'); if (!b) return;
  if (tab === 'study') openPick(b.dataset.key); else startGame(b.dataset.key);
});
$('tabs').addEventListener('click', function(e){
  var b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === tab) return;
  tab = b.dataset.tab; saved.tab = tab; persist(); undo = null; renderHome();
});
$('notesBox').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('say')) speak(b.dataset.w);
  else if (b.classList.contains('del')){
    undo = {w:b.dataset.w, n:saved.wrong[b.dataset.w]};
    delete saved.wrong[b.dataset.w]; persist(); renderHome();
  }
  else if (b.dataset.act === 'undo' && undo){ saved.wrong[undo.w] = undo.n; undo = null; persist(); renderHome(); }
  else if (b.dataset.act === 'study') studyNotes(b.dataset.grp);
});
$('pickBack').addEventListener('click', goHome);
$('counts').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b || !pickKey) return;
  var key = pickKey;
  startCards(shuffle(SETS[key].slice()).slice(0, +b.dataset.n).map(function(x){ return {w:x.w, m:x.m, i:x.i, key:key, n:0, gone:false}; }),
    'level', labelOf(key) + ' · 외우기', key);
});
$('flip').addEventListener('click', flipCard);
$('cardListen').addEventListener('click', function(){ if (deck) speak(deck.cards[deck.pos].w); });
$('cardForget').addEventListener('click', toggleForget);
$('cardPrev').addEventListener('click', prevCard);
$('cardNext').addEventListener('click', nextCard);
$('cardsQuit').addEventListener('click', goHome);
$('cdGame').addEventListener('click', function(){ if (deck) startGame(deck.key, deck.cards.map(function(c){ return c.i; }), 'learn'); });
$('cdAgain').addEventListener('click', function(){
  if (!deck) return;
  var cards = shuffle(deck.cards.filter(function(c){ return !c.gone; }));
  if (cards.length) startCards(cards, deck.mode, deck.title, deck.key);
});
$('cdHome').addEventListener('click', goHome);
$('answers').addEventListener('click', function(e){
  var b = e.target.closest('.ans'); if (b) answer(+b.dataset.j);
});
$('nextBtn').addEventListener('click', nextQuestion);
$('listenBtn').addEventListener('click', function(){ if (game) speak(SETS[game.key][game.cur].w); });
$('wordSvg').addEventListener('click', function(){ if (game) speak(SETS[game.key][game.cur].w); });
$('quitBtn').addEventListener('click', function(){ $('quitBar').hidden = !$('quitBar').hidden; });
$('quitNo').addEventListener('click', function(){ $('quitBar').hidden = true; });
$('quitYes').addEventListener('click', goHome);
$('homeBtn').addEventListener('click', goHome);
$('againBtn').addEventListener('click', function(){ startGame(last.key); });
$('reviewBtn').addEventListener('click', function(){ startGame(last.key, last.missed.map(function(x){ return x.i; })); });
$('missedList').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (b) speak(b.dataset.w);
});
$('rateSlow').addEventListener('click', function(){ saved.slow = true; persist(); renderHome(); speak('hello'); });
$('rateNormal').addEventListener('click', function(){ saved.slow = false; persist(); renderHome(); speak('hello'); });
$('sfxOn').addEventListener('click', function(){ saved.sfx = true; persist(); renderHome(); sfx('ok'); });
$('sfxOff').addEventListener('click', function(){ saved.sfx = false; persist(); renderHome(); });
document.addEventListener('keydown', function(e){
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (screen === 'cards' && deck){
    var onBtn = e.target && e.target.tagName === 'BUTTON';
    if ((e.key === ' ' || e.key === 'Enter') && !onBtn){ flipCard(); e.preventDefault(); }
    else if (e.key === 'ArrowRight'){ nextCard(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft'){ prevCard(); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R'){ speak(deck.cards[deck.pos].w); }
    return;
  }
  if (screen !== 'play' || !game) return;
  if (e.key >= '1' && e.key <= '4'){ answer(+e.key - 1); e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R'){ speak(SETS[game.key][game.cur].w); }
  else if (e.key === 'Enter' && game.answered && !$('nextBtn').hidden){ nextQuestion(); e.preventDefault(); }
});

function goHome(){
  clearTimeout(timer);
  if (synth) { try { synth.cancel(); } catch(e){} }
  game = null; deck = null; pickKey = null;
  renderHome();
  show('home');
}

/* ---- boot (keeps a game in progress when the page is updated while open) ---- */
function start(data){
  renderHome();
  try {
    if (data && data.screen === 'play' && data.game && SETS[data.game.key]){
      game = data.game;
      $('where').textContent = labelOf(game.key) + (game.review ? ' · ' + tagOf(game)[0] : '');
      $('noVoice').hidden = !!synth;
      show('play');
      if (game.answered && game.opts[game.picked] === game.cur) nextQuestion(); else renderQuestion();
      return;
    }
    if (data && data.screen === 'done' && data.last && SETS[data.last.key]){
      last = data.last; renderDone(); show('done'); return;
    }
  } catch(e){ game = null; }
  show('home');
}
var hot = window.claude && window.claude.hot;
try { if (hot && typeof hot.snapshot === 'function') hot.snapshot(function(){ return {screen:screen, game:game, last:last}; }); } catch(e){}
if (hot && typeof hot.ready === 'function') hot.ready(start); else start((hot && hot.data) || {});
})();

// 설치·오프라인 지원 (https 또는 localhost 에서만 동작)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}
