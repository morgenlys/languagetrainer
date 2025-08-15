import {parseCSV, shuffle, choice, normalize, isAcceptable, uniqueText} from './utils.js';
import {saveProgressCookie, loadProgressCookie, resetProgress, saveProgressDebounced} from './storage.js';
import {newProgressFor, mergeProgress, selectNextItem, allowedModesFor, updateAfterAnswer, distractorsFor} from './srs.js';
import {getVoices, setSettings, speakFR, defaultFrenchVoiceURI, hasFrenchVoice} from './tts.js';

// Shortcuts
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// Global State
const state = {
  items: [],
  progress: {},
  session: { onlyDue:false, includeWords:true, includeSentences:true },
  current: null,
  settings: { frVoice: null, rate:1, pitch:1, autoplay:true },
  totals: {total:0, new:0, due:0, streak:0},
  answered: false
};

// Elements
const el = {
  statTotal: $('#stat-total'), statNew: $('#stat-new'), statDue: $('#stat-due'), statStreak: $('#stat-streak'),
  modeContainer: $('#mode-container'),
  actionBar: $('#action-bar'), actionMsg: $('#action-msg'), primary: $('#primary-action'),
  // options modal
  btnOptions: $('#btn-options'), modalOptions: $('#modal-options'), modalVoice: $('#modal-voice'),
  chkOnlyDue: $('#chk-only-due'), chkWords: $('#chk-include-words'), chkSent: $('#chk-include-sentences'),
  btnNew: $('#btn-new-session'), btnNext: $('#btn-next'), btnReset: $('#btn-reset'),
  btnImport: $('#btn-import'), fileInput: $('#file-input'),
  selVoice: $('#sel-voice'), inpRate: $('#inp-rate'), inpPitch: $('#inp-pitch'), btnTTSTest: $('#btn-tts-test'),
  btnSample: $('#btn-load-sample'),
  themeToggle: $('#theme-toggle'), themeLabel: $('#theme-label')
};

/* =================== Theming =================== */
(function initTheme(){
  const persisted = localStorage.getItem('vt_theme') || 'light';
  document.documentElement.setAttribute('data-theme', persisted);
  el.themeToggle.checked = (persisted === 'dark');
  el.themeLabel.textContent = el.themeToggle.checked ? 'Dunkel' : 'Hell';
  el.themeToggle.addEventListener('change', ()=>{
    const mode = el.themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('vt_theme', mode);
    el.themeLabel.textContent = el.themeToggle.checked ? 'Dunkel' : 'Hell';
  });
})();

/* =================== Data Load / Save =================== */
function tokenizeFr(s){ return (s||'').split(/[\s]+/).map(t=>t.replace(/[.,!?;:()«»"“”]/g,'')).filter(Boolean); }
function hashItems(items){
  const s = items.map(i => i.id + '|' + i.de + '|' + i.fr).join('¬');
  let h = 0; for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
  return String(h);
}
function setItems(items){
  state.items = items.map(x => ({
    ...x,
    id: x.id || normalize(x.fr).replace(/\s+/g,'_'),
    tokens_fr: x.tokens_fr && x.tokens_fr.length ? x.tokens_fr : tokenizeFr(x.fr)
  }));
  const old = loadProgressCookie();
  if (old && old.progress && old.meta && old.meta.hash === hashItems(state.items)){
    state.progress = mergeProgress(state.items, old.progress);
  } else {
    state.progress = newProgressFor(state.items);
  }
  saveAll(); refreshStats();
  showMsg('Daten geladen.');
}

/* =================== Modals =================== */
function openModal(mod){ mod.setAttribute('aria-hidden','false'); }
function closeModal(mod){ mod.setAttribute('aria-hidden','true'); }
el.btnOptions.addEventListener('click', ()=> openModal(el.modalOptions));
$$('[data-close]').forEach(btn=> btn.addEventListener('click', e=> closeModal(e.target.closest('.modal'))));
el.modalOptions.querySelector('.modal-backdrop').addEventListener('click', ()=> closeModal(el.modalOptions));
el.modalVoice.querySelector('.modal-backdrop').addEventListener('click', ()=> closeModal(el.modalVoice));

/* =================== Stats =================== */
function refreshStats(){
  const p = state.progress;
  const arr = Object.values(p);
  const total = arr.length, now = Date.now();
  const due = arr.filter(x => (x.due||0) <= now).length;
  const neu = arr.filter(x => x.seen === 0).length;
  const streak = arr.reduce((a,b)=>a + (b.streak||0), 0);
  state.totals = {total, new:neu, due, streak};
  el.statTotal.textContent = total;
  el.statNew.textContent = neu;
  el.statDue.textContent = due;
  el.statStreak.textContent = streak;
}

/* =================== TTS =================== */
function populateVoicesUI(){
  const voices = getVoices();
  el.selVoice.innerHTML = '';
  voices.forEach(v=>{
    const o = document.createElement('option');
    o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`;
    el.selVoice.appendChild(o);
  });
  const prefer = state.settings.frVoice || defaultFrenchVoiceURI();
  if (prefer) el.selVoice.value = prefer;
  setSettings({voiceURI: el.selVoice.value, rate: state.settings.rate, pitch: state.settings.pitch});
  if (!hasFrenchVoice()) openModal(el.modalVoice);
}
function initTTS(){
  populateVoicesUI();
  el.selVoice.addEventListener('change', ()=>{
    state.settings.frVoice = el.selVoice.value;
    setSettings({voiceURI: state.settings.frVoice});
  });
  el.inpRate.addEventListener('input', ()=>{
    state.settings.rate = parseFloat(el.inpRate.value);
    setSettings({rate: state.settings.rate});
  });
  el.inpPitch.addEventListener('input', ()=>{
    state.settings.pitch = parseFloat(el.inpPitch.value);
    setSettings({pitch: state.settings.pitch});
  });
  el.btnTTSTest.addEventListener('click', ()=> speakFR('Bonjour, je suis votre voix française.'));
}

/* =================== Audio FX (richtig/falsch) =================== */
function playFX(type='ok'){
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  const t0 = ctx.currentTime;
  if (type==='ok'){
    o.type='sine'; o.frequency.setValueAtTime(660, t0);
    o.frequency.exponentialRampToValueAtTime(880, t0+0.12);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.15, t0+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+0.18);
    o.start(t0); o.stop(t0+0.2);
  } else {
    o.type='square'; o.frequency.setValueAtTime(220, t0);
    g.gain.setValueAtTime(0.0001, t0);
    for(let i=0;i<3;i++){
      const a = t0 + i*0.08;
      g.gain.exponentialRampToValueAtTime(0.2, a+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, a+0.06);
    }
    o.start(t0); o.stop(t0+0.26);
  }
}

/* =================== Misc UI =================== */
function showMsg(text){ el.actionMsg.innerHTML = text; }
function clearFeedback(){ el.actionBar.classList.remove('ok','bad'); el.actionMsg.textContent=''; }
function setActionLabel(text, kind='primary'){
  el.primary.textContent = text;
  el.primary.classList.remove('ok','bad','primary');
  el.primary.classList.add(kind === 'primary' ? 'primary' : kind);
}
function stableCheckMode(){ setActionLabel('Überprüfen','primary'); }

/* =================== Emoji Hints =================== */
function emojiFor(item){
  const fr = normalize(item.fr);
  const map = {
    'maison':'🏠','bonjour':'👋','merci':'🙏','fromage':'🧀','pain':'🥖','eau':'💧',
    'chat':'🐱','chien':'🐶','voiture':'🚗','gare':'🚉','ecole':'🏫','école':'🏫',
    'cafe':'☕','café':'☕','pomme':'🍎','banane':'🍌','soleil':'☀️','pluie':'🌧️'
  };
  return map[fr] || '';
}

/* =================== Rendering =================== */
function render(item){
  state.current = item; state.answered = false; clearFeedback(); stableCheckMode();
  const host = el.modeContainer; host.innerHTML = '';
  const p = state.progress[item.id];
  const allowed = allowedModesFor(p);
  let mode = choice(allowed);
  if (item.type !== 'sentence' && mode==='sentence_build'){ mode = 'mc_df'; } // fallback

  if (mode === 'mc_df') renderMC(host, item, p, 'df');
  else if (mode === 'mc_fd') renderMC(host, item, p, 'fd');
  else if (mode === 'input_df') renderInputDF(host, item, p);
  else if (mode === 'match5') renderMatch5(host, item, p);
  else if (mode === 'speech_mc') renderSpeechMC(host, item, p);
  else if (mode === 'speech_input') renderSpeechInput(host, item, p);
  else if (mode === 'sentence_build') renderSentenceBuilder(host, item, p);
}

/* ---------- MC (beide Richtungen) ---------- */
function renderMC(host, item, p, dir){
  const isDF = dir==='df';
  const prompt = div('prompt', isDF ? item.de : item.fr);
  const emoji = emojiFor(item);
  const emojiEl = emoji ? div('emoji-hint', emoji) : null;

  const grid = div('mc-grid');
  // Build options unique
  const key = isDF ? 'fr' : 'de';
  const correct = {id:item.id, text:item[key], correct:true};
  let opts = [correct, ...distractorsFor(state.items, item, 6, dir)]; // hol mehr
  // Entferne Duplikate & auf 4 runter
  opts = uniqueText(opts).slice(0,4);
  // Falls <4, fülle mit weiteren eindeutigen aus dem Pool
  if (opts.length < 4){
    const pool = shuffle(state.items.filter(i=>i.id!==item.id));
    for (const cand of pool){
      const obj = {id:cand.id, text:cand[key]};
      if (uniqueText([...opts, obj]).length > opts.length) opts.push(obj);
      if (opts.length===4) break;
    }
  }
  opts = shuffle(opts);
  opts.forEach(o=>{
    const b = button('choice', o.text);
    b.addEventListener('click', ()=>{
      if (state.answered) return;
      const ok = !!o.correct || normalize(o.text)===normalize(item[key]);
      finish(ok, {modeId: isDF?'mc_df':'mc_fd', correctAnswer: item[key]});
    });
    grid.appendChild(b);
  });

  host.append(prompt);
  if (emojiEl) host.append(emojiEl);
  host.append(grid);

  // Auto-TTS, wenn FR sichtbar (FR->DE)
  if (!isDF) setTimeout(()=> speakFR(item.fr), 90);
}

/* ---------- Texteingabe DE -> FR ---------- */
function renderInputDF(host, item){
  const prompt = div('prompt', item.de);
  const wrap = div('input-wrap');
  const input = document.createElement('input'); input.placeholder='auf Französisch eingeben…';
  input.autocapitalize='off'; input.autocomplete='off'; input.spellcheck=false;
  wrap.append(input);
  host.append(prompt, wrap);
  input.focus();

  el.primary.onclick = ()=>{
    if (state.answered) { nextCard(); return; }
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    finish(res.ok, {modeId:'input_df', correctAnswer:item.fr});
  };
}

/* ---------- Match 5 ---------- */
function renderMatch5(host, item){
  const title = div('prompt','Zuordnen: Deutsch ↔ Französisch');
  const grid = div('kv');
  const left = div('col'), right = div('col');
  const pool = shuffle([item, ...shuffle(state.items.filter(i=>i.id!==item.id)).slice(0,4)]);
  const leftItems = shuffle(pool.map(it => ({id: it.id, text: it.de})));
  const rightItems = shuffle(pool.map(it => ({id: it.id, text: it.fr})));
  let activeLeft = null, matches = 0;

  leftItems.forEach(li=>{
    const d = div('item', li.text);
    d.addEventListener('click', ()=> { activeLeft = li; highlight(left, d); });
    left.appendChild(d);
  });
  rightItems.forEach(ri=>{
    const d = div('item', ri.text);
    d.addEventListener('click', ()=>{
      if (!activeLeft) return;
      const ok = ri.id === activeLeft.id;
      if (ok){
        d.classList.add('matched');
        const leftEl = [...left.children].find(n=>n.textContent===activeLeft.text);
        leftEl?.classList.add('matched');
        activeLeft = null;
        matches++;
        if (matches === pool.length){ finish(true, {modeId:'match5', correctAnswer:''}); }
      } else {
        shake(d);
      }
    });
    right.appendChild(d);
  });

  grid.append(left, right);
  host.append(title, grid);

  el.primary.onclick = ()=> { if (state.answered) nextCard(); };
}

/* ---------- Speech MC ---------- */
function renderSpeechMC(host, item){
  const prompt = div('prompt','Was wurde gesagt? (Französisch)');
  const play = audioBtn(()=> speakFR(item.fr));
  const grid = div('mc-grid');

  let opts = uniqueText([{text:item.fr, correct:true}, ...distractorsFor(state.items, item, 6, 'df')]).slice(0,4);
  if (opts.length<4){
    const pool = shuffle(state.items.filter(i=>i.id!==item.id));
    for (const c of pool){
      const o = {text:c.fr};
      if (uniqueText([...opts, o]).length > opts.length) opts.push(o);
      if (opts.length===4) break;
    }
  }
  opts = shuffle(opts);
  opts.forEach(o=>{
    const b = button('choice', o.text);
    b.addEventListener('click', ()=>{
      if (state.answered) return;
      const ok = !!o.correct || normalize(o.text)===normalize(item.fr);
      finish(ok, {modeId:'speech_mc', correctAnswer:item.fr});
    });
    grid.appendChild(b);
  });

  host.append(prompt, play, grid);
  // Auto
  setTimeout(()=> speakFR(item.fr), 90);
  el.primary.onclick = ()=> { if (state.answered) nextCard(); };
}

/* ---------- Speech Input ---------- */
function renderSpeechInput(host, item){
  const prompt = div('prompt','Schreibe, was du hörst (Französisch)');
  const play = audioBtn(()=> speakFR(item.fr));
  const wrap = div('input-wrap');
  const input = document.createElement('input'); input.placeholder='gehörtes FR-Wort/-Satz…';
  wrap.append(input);
  host.append(prompt, play, wrap);
  input.focus();

  setTimeout(()=> speakFR(item.fr), 110);

  el.primary.onclick = ()=>{
    if (state.answered) { nextCard(); return; }
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    finish(res.ok, {modeId:'speech_input', correctAnswer:item.fr});
  };
}

/* ---------- Satzbauer (Ziel oben, Pool unten, Fly-Up) ---------- */
function renderSentenceBuilder(host, item){
  const wrap = div('sentence-builder');
  const target = div('sentence-target');
  const pool = div('pool');
  const tiles = shuffle(item.tokens_fr.slice());
  tiles.forEach(t=>{
    const tile = div('tile', t);
    tile.addEventListener('click', ()=> moveTile(tile, pool, target));
    pool.appendChild(tile);
  });
  wrap.append(target, pool); // Ziel oben, Auswahl unten
  const prompt = div('prompt', `${item.de} <span class="badge"></span>`);
  host.append(prompt, wrap);

  el.primary.onclick = ()=>{
    if (state.answered) { nextCard(); return; }
    const built = [...target.children].map(n=>n.textContent).join(' ').trim();
    const ok = normalize(built) === normalize(item.tokens_fr.join(' ').trim());
    finish(ok, {modeId:'sentence_build', correctAnswer:item.fr});
  };

  function moveTile(tile, from, to){
    // Clone for flight
    const rectFrom = tile.getBoundingClientRect();
    const clone = tile.cloneNode(true);
    clone.classList.add('fly-clone');
    Object.assign(clone.style, {
      left: rectFrom.left+'px', top: rectFrom.top+'px', width: rectFrom.width+'px'
    });
    document.body.appendChild(clone);

    // append to target (hidden), but place after anim
    to.appendChild(tile);

    // compute destination (tile now at end of target)
    const rectTo = tile.getBoundingClientRect();
    const dx = rectTo.left - rectFrom.left;
    const dy = rectTo.top - rectFrom.top;

    clone.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${dx}px, ${dy-8}px) scale(1.06)` }
    ], { duration: 240, easing:'cubic-bezier(.2,.8,.2,1)' }).onfinish = ()=> clone.remove();
  }
}

/* =================== Common helpers =================== */
function div(cls, html){ const d=document.createElement('div'); if(cls) d.className=cls; if(html!==undefined) d.innerHTML=html; return d; }
function button(cls, html){ const b=document.createElement('button'); if(cls) b.className=cls; b.innerHTML=html; return b; }
function audioBtn(onClick){ const b = button('audio-btn', `<svg><use href="#icon-sound"/></svg>`); b.addEventListener('click', onClick); return b; }
function highlight(container, node){ $$('.item', container).forEach(n=> n.style.outline=''); node.style.outline='2px solid var(--accent)'; }
function shake(node){ node.animate([{transform:'translateX(0)'},{transform:'translateX(3px)'},{transform:'translateX(0)'}], {duration:140}); }

/* =================== Finish / Feedback =================== */
function finish(ok, {modeId, correctAnswer}){
  if (state.answered) return;
  state.answered = true;

  const item = state.current;
  const p = state.progress[item.id];
  updateAfterAnswer(p, ok, modeId);
  saveAll(); refreshStats();

  // Sound + Leiste färben + Nachricht
  playFX(ok ? 'ok' : 'bad');
  el.actionBar.classList.remove('ok','bad');
  el.actionBar.classList.add(ok ? 'ok' : 'bad');
  if (ok){
    showMsg('✔ Richtig!');
    setActionLabel('Weiter','ok');
  } else {
    showMsg(`✖ Falsch. Richtig: <strong>${correctAnswer || item.fr}</strong>`);
    setActionLabel('Weiter','bad');
  }

  // Weiter
  el.primary.onclick = ()=> nextCard();
}

/* =================== Session / Flow =================== */
function nextCard(){
  if (!state.items.length) return;
  const opts = { onlyDue: el.chkOnlyDue.checked, includeWords: el.chkWords.checked, includeSentences: el.chkSent.checked };
  const item = selectNextItem(state.items, state.progress, opts);
  render(item);
}

/* =================== Import / Sample / Reset =================== */
el.btnImport.addEventListener('click', ()=> el.fileInput.click());
el.fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const text = await f.text();
  if (f.name.endsWith('.json')) setItems(JSON.parse(text));
  else if (f.name.endsWith('.csv')) setItems(parseCSV(text));
});
el.btnSample.addEventListener('click', async ()=>{
  const res = await fetch('./data/sample.json'); const json = await res.json(); setItems(json);
});
el.btnReset.addEventListener('click', ()=>{
  if (confirm('Fortschritt zurücksetzen?')){
    resetProgress(); state.progress = newProgressFor(state.items); saveAll(); refreshStats(); showMsg('Fortschritt gelöscht.');
  }
});

/* =================== Options toggles =================== */
el.chkOnlyDue.addEventListener('change', ()=> state.session.onlyDue = el.chkOnlyDue.checked);
el.chkWords.addEventListener('change', ()=> state.session.includeWords = el.chkWords.checked);
el.chkSent.addEventListener('change', ()=> state.session.includeSentences = el.chkSent.checked);

el.btnNew.addEventListener('click', ()=> { closeModal(el.modalOptions); nextCard(); });
el.btnNext.addEventListener('click', ()=> nextCard());

/* =================== Save =================== */
function saveAll(){
  const payload = { progress: state.progress, meta: { hash: hashItems(state.items), updated: Date.now() } };
  saveProgressDebounced(payload);
}

/* =================== Boot =================== */
window.addEventListener('DOMContentLoaded', async ()=>{
  initTTS();
  // Autoload sample once
  try{ const res = await fetch('./data/sample.json'); const json = await res.json(); setItems(json); }catch(e){}

  // Primary action is "Überprüfen" by default – but many Modi rechnen das im Handler
  el.primary.onclick = ()=> {}; // wird pro Renderer gesetzt
});
