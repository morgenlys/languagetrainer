import {parseCSV, shuffle, choice, normalize, isAcceptable} from './utils.js';
import {saveProgressCookie, loadProgressCookie, resetProgress, saveProgressDebounced} from './storage.js';
import {newProgressFor, mergeProgress, selectNextItem, allowedModesFor, updateAfterAnswer, distractorsFor} from './srs.js';
import {getVoices, setSettings, speakFR, getDefaultFrenchVoice} from './tts.js';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const state = {
  items: [],        // Vokabeln
  progress: {},     // id -> progress
  session: { onlyDue:false, includeWords:true, includeSentences:true },
  current: null,    // aktueller Datensatz
  settings: { frVoice: null, rate:1, pitch:1 },
  totals: {total:0, new:0, due:0, streak:0}
};

// ---------- Daten laden ----------
async function loadSample(){
  const res = await fetch('./data/sample.json');
  const json = await res.json();
  setItems(json);
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
  saveAll();
  refreshStats();
  showToast(`Geladen: ${state.items.length} Einträge`);
}

function hashItems(items){
  // simpler Hash über IDs & Inhalte
  const s = items.map(i => i.id + '|' + i.de + '|' + i.fr).join('¬');
  let h = 0;
  for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
  return String(h);
}

function tokenizeFr(s){
  return (s||'').split(/[\s]+/).map(t=>t.replace(/[.,!?;:()«»"“”]/g,'')).filter(Boolean);
}

// ---------- UI Grundgerüst ----------
const els = {
  statTotal: $('#stat-total'),
  statNew: $('#stat-new'),
  statDue: $('#stat-due'),
  statStreak: $('#stat-streak'),
  progress: $('#progress'),
  modeContainer: $('#mode-container'),
  feedback: $('#feedback'),
  btnNext: $('#btn-next'),
  chkOnlyDue: $('#chk-only-due'),
  chkWords: $('#chk-include-words'),
  chkSent: $('#chk-include-sentences'),
  btnNewSession: $('#btn-new-session'),
  btnImport: $('#btn-import'),
  fileInput: $('#file-input'),
  btnReset: $('#btn-reset'),
  selVoice: $('#sel-voice'),
  inpRate: $('#inp-rate'),
  inpPitch: $('#inp-pitch'),
  btnTTSTest: $('#btn-tts-test'),
  btnLoadSample: $('#btn-load-sample')
};

function showToast(msg){
  els.feedback.textContent = msg;
  els.feedback.classList.add('show');
  setTimeout(()=> els.feedback.classList.remove('show'), 1400);
}

// ---------- Stats ----------
function refreshStats(){
  const p = state.progress;
  const arr = Object.values(p);
  const total = arr.length;
  const now = Date.now();
  const due = arr.filter(x => (x.due||0) <= now).length;
  const neu = arr.filter(x => x.seen === 0).length;
  const streak = arr.reduce((a,b)=>a + (b.streak||0), 0);

  state.totals = {total, new:neu, due, streak};
  els.statTotal.textContent = total;
  els.statNew.textContent = neu;
  els.statDue.textContent = due;
  els.statStreak.textContent = streak;
  const learned = arr.filter(x=>x.stage>=2 && x.streak>=3).length;
  const pct = total ? Math.round((learned/total)*100) : 0;
  els.progress.style.width = pct+'%';
}

// ---------- Settings (TTS) ----------
function populateVoices(){
  const voices = getVoices();
  els.selVoice.innerHTML = '';
  for (const v of voices){
    const opt = document.createElement('option');
    opt.value = v.voiceURI; opt.textContent = `${v.name} (${v.lang})`;
    els.selVoice.appendChild(opt);
  }
  const def = state.settings.frVoice || getDefaultFrenchVoice();
  if (def) els.selVoice.value = def;
  setSettings({voiceURI: els.selVoice.value, rate: state.settings.rate, pitch: state.settings.pitch});
}
window.speechSynthesis?.addEventListener('voiceschanged', populateVoices);

// ---------- Session ----------
function nextCard(auto=false){
  if (!state.items.length){ return; }
  const opts = {
    onlyDue: els.chkOnlyDue.checked,
    includeWords: els.chkWords.checked,
    includeSentences: els.chkSent.checked
  };
  const item = selectNextItem(state.items, state.progress, opts);
  state.current = item;
  renderModeFor(item);
  if (!auto) showToast('Neue Aufgabe');
}

function renderModeFor(item){
  const p = state.progress[item.id];
  const allowed = allowedModesFor(p);
  const mode = choice(allowed); // zufällig
  const host = els.modeContainer;
  host.innerHTML = '';
  host.classList.add('mode');

  const renderers = {
    'mc_df': renderMCDF,
    'mc_fd': renderMCFD,
    'input_df': renderInputDF,
    'match5': renderMatch5,
    'speech_mc': renderSpeechMC,
    'speech_input': renderSpeechInput,
    'sentence_build': renderSentenceBuilder
  };

  // Satzbuilder nur wenn Satz
  if (item.type !== 'sentence' && mode==='sentence_build'){
    return renderModeFor(item); // wähle neu
  }
  renderers[mode](host, item, p, mode);
}

// ----------- Render: Multiple Choice DE -> FR -----------
function renderMCDF(host, item, p, modeId){
  const dir = 'df';
  const prompt = el('div', 'prompt', item.de);
  const audio = audioBtn(()=> speakFR(item.fr));
  const grid = el('div', 'mc-grid');
  const distractors = distractorsFor(state.items, item, 3, dir);
  const options = shuffle([{id:item.id, text:item.fr, correct:true}].concat(distractors));
  options.forEach(o=>{
    const b = el('button', 'choice', o.text);
    b.addEventListener('click', ()=> finish(o.correct, modeId));
    grid.appendChild(b);
  });
  host.append(prompt, audio, grid, footerNotes(item));
}

// FR -> DE
function renderMCFD(host, item, p, modeId){
  const dir = 'fd';
  const prompt = el('div', 'prompt', item.fr);
  const audio = audioBtn(()=> speakFR(item.fr));
  const grid = el('div', 'mc-grid');
  const distractors = distractorsFor(state.items, item, 3, dir);
  const options = shuffle([{id:item.id, text:item.de, correct:true}].concat(distractors));
  options.forEach(o=>{
    const b = el('button', 'choice', o.text);
    b.addEventListener('click', ()=> finish(o.correct, modeId));
    grid.appendChild(b);
  });
  host.append(prompt, audio, grid, footerNotes(item));
}

// Texteingabe DE -> FR (mit Toleranz)
function renderInputDF(host, item, p, modeId){
  const prompt = el('div', 'prompt', item.de);
  const wrap = el('div', 'input-wrap');
  const input = document.createElement('input');
  input.placeholder = 'auf Französisch eingeben…';
  input.autocapitalize = 'off'; input.autocomplete = 'off'; input.spellcheck = false;
  const btn = el('button', 'btn', 'Prüfen');
  const audio = audioBtn(()=> speakFR(item.fr));
  wrap.append(input, btn);
  host.append(prompt, audio, wrap, footerNotes(item));
  input.focus();
  const submit = ()=>{
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    const ok = res.ok;
    btn.classList.add(ok ? 'correct-hint' : 'wrong-hint');
    finish(ok, modeId, {user:input.value});
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e=>{ if (e.key === 'Enter') submit(); });
}

// 5 Elemente zuordnen (DE ↔ FR)
function renderMatch5(host, item, p, modeId){
  // nimm 5 Items (eins ist current), Mappe DE <-> FR
  const pool = shuffle([item, ...shuffle(state.items.filter(i=>i.id!==item.id)).slice(0,4)]);
  const left = el('div','col');
  const right = el('div','col');
  const map = new Map();
  pool.forEach(it=> map.set(it.id, it));
  const leftItems = shuffle(pool.map(it => ({id: it.id, text: it.de})));
  const rightItems = shuffle(pool.map(it => ({id: it.id, text: it.fr})));
  let activeLeft = null, matches = 0;

  leftItems.forEach(li=>{
    const d = el('div','item', li.text);
    d.addEventListener('click', ()=> { activeLeft = li; highlight(left, d); });
    left.appendChild(d);
  });
  rightItems.forEach(ri=>{
    const d = el('div','item', ri.text);
    d.addEventListener('click', ()=>{
      if (!activeLeft) return;
      const ok = ri.id === activeLeft.id;
      if (ok){
        d.classList.add('matched');
        const leftEl = [...left.children].find(n=>n.textContent===activeLeft.text);
        leftEl?.classList.add('matched');
        activeLeft = null;
        matches++;
        if (matches === pool.length){
          finish(true, modeId);
        }
      } else {
        shake(d);
      }
    });
    right.appendChild(d);
  });

  const grid = el('div','kv');
  grid.append(left, right);
  host.append(el('div','prompt','Zuordnen: Deutsch ↔ Französisch'), grid, footerNotes(item));
}

// Speech → MC (Wort antippen)
function renderSpeechMC(host, item, p, modeId){
  const prompt = el('div','prompt','Was wurde gesagt? (Französisch)');
  const play = el('button','audio-btn'); play.innerHTML = `<svg><use href="#icon-play"/></svg>`;
  play.addEventListener('click', ()=> speakFR(item.fr));
  const grid = el('div','mc-grid');
  const options = shuffle([{text:item.fr, correct:true}, ...distractorsFor(state.items, item, 3, 'df')]);
  options.forEach(o=>{
    const b = el('button','choice', o.text);
    b.addEventListener('click', ()=> finish(!!o.correct, modeId));
    grid.appendChild(b);
  });
  host.append(prompt, play, grid, footerNotes(item));
}

// Speech → Eingabe
function renderSpeechInput(host, item, p, modeId){
  const prompt = el('div','prompt','Schreibe, was du hörst (Französisch)');
  const play = el('button','audio-btn'); play.innerHTML = `<svg><use href="#icon-play"/></svg>`;
  play.addEventListener('click', ()=> speakFR(item.fr));
  const wrap = el('div','input-wrap');
  const input = document.createElement('input'); input.placeholder = 'gehörtes FR-Wort/-Satz…';
  const btn = el('button','btn','Prüfen');
  wrap.append(input, btn);
  host.append(prompt, play, wrap, footerNotes(item));
  input.focus();
  const onSubmit = ()=>{
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    finish(res.ok, modeId, {user: input.value});
  };
  btn.addEventListener('click', onSubmit);
  input.addEventListener('keydown', e=>{ if (e.key==='Enter') onSubmit(); });
}

// Satz zusammenbauen (Bausteine)
function renderSentenceBuilder(host, item, p, modeId){
  const prompt = el('div','prompt', `${item.de} <span class="badge">Satz bauen</span>`);
  const pool = el('div','pool');
  const target = el('div','sentence-target');
  const tiles = shuffle(item.tokens_fr.slice());
  tiles.forEach(t=>{
    const tile = el('div','tile', t);
    tile.addEventListener('click', ()=>{
      pool.removeChild(tile);
      target.appendChild(tile);
      tile.style.transform = 'scale(1.02)';
      setTimeout(()=> tile.style.transform = '', 120);
      check();
    });
    pool.appendChild(tile);
  });
  function check(){
    const built = [...target.children].map(n=>n.textContent).join(' ').trim();
    const goal = item.tokens_fr.join(' ').trim();
    if (normalize(built) === normalize(goal)) {
      finish(true, modeId, {built});
    }
  }
  host.append(prompt, pool, target, footerNotes(item));
}

// ---------- Helpers ----------
function audioBtn(onClick){
  const b = el('button','audio-btn');
  b.innerHTML = `<svg><use href="#icon-sound"/></svg>`;
  b.addEventListener('click', onClick);
  return b;
}
function footerNotes(item){
  const n = el('div','note');
  n.innerHTML = `${item.notes ? item.notes + ' · ' : ''}<span class="muted">FR:</span> ${item.fr} · <span class="muted">DE:</span> ${item.de}`;
  return n;
}
function el(tag, cls, text){
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text !== undefined) d.innerHTML = escapeHtml(text);
  return d;
}
function escapeHtml(s){ return String(s).replace(/[&<>]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function highlight(container, node){
  $$('.item', container).forEach(n=> n.style.outline='');
  node.style.outline='2px solid var(--accent)';
}
function shake(node){
  node.style.transform='translateX(2px)'; setTimeout(()=>node.style.transform='', 140);
}

// ---------- Abschluss einer Aufgabe ----------
function finish(ok, modeId, extra={}){
  const item = state.current;
  const p = state.progress[item.id];
  updateAfterAnswer(p, ok, modeId);
  saveAll();
  refreshStats();

  // Inline Feedback
  const host = els.modeContainer;
  const msg = el('div', ok ? 'correct-hint' : 'wrong-hint',
    ok ? `✔ Richtig!` : `✖ Falsch. Richtig wäre: <strong>${item.fr}</strong>`);
  const actions = el('div','actions');
  const again = el('button','btn ghost','Nochmal'); again.addEventListener('click', ()=> renderModeFor(item));
  const next = el('button','btn primary','Weiter'); next.addEventListener('click', ()=> nextCard());
  actions.append(again, next);
  host.append(msg, actions);
}

// ---------- Import ----------
els.btnImport.addEventListener('click', ()=> els.fileInput.click());
els.fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const text = await f.text();
  if (f.name.endsWith('.json')){
    const json = JSON.parse(text);
    setItems(json);
  } else if (f.name.endsWith('.csv')){
    setItems(parseCSV(text));
  } else {
    showToast('Nur .json oder .csv');
  }
});

els.btnLoadSample.addEventListener('click', loadSample);

// ---------- Reset ----------
els.btnReset.addEventListener('click', ()=>{
  if (confirm('Fortschritt zurücksetzen?')) {
    resetProgress();
    state.progress = newProgressFor(state.items);
    saveAll();
    refreshStats();
    showToast('Fortschritt gelöscht');
  }
});

// ---------- Start & Next ----------
els.btnNewSession.addEventListener('click', ()=> nextCard());
els.btnNext.addEventListener('click', ()=> nextCard());

// ---------- Session Filter ----------
els.chkOnlyDue.addEventListener('change', ()=> state.session.onlyDue = els.chkOnlyDue.checked);
els.chkWords.addEventListener('change', ()=> state.session.includeWords = els.chkWords.checked);
els.chkSent.addEventListener('change', ()=> state.session.includeSentences = els.chkSent.checked);

// ---------- TTS ----------
function initTTS(){
  populateVoicesUI();
  els.inpRate.addEventListener('input', ()=> {
    state.settings.rate = parseFloat(els.inpRate.value);
    setSettings({rate: state.settings.rate});
  });
  els.inpPitch.addEventListener('input', ()=> {
    state.settings.pitch = parseFloat(els.inpPitch.value);
    setSettings({pitch: state.settings.pitch});
  });
  els.selVoice.addEventListener('change', ()=>{
    state.settings.frVoice = els.selVoice.value;
    setSettings({voiceURI: state.settings.frVoice});
  });
  els.btnTTSTest.addEventListener('click', ()=> speakFR('Bonjour, je suis votre voix française.'));
}
function populateVoicesUI(){
  // versucht nach kurzer Zeit erneut, da voices async laden
  const tryFill = ()=>{
    const prev = els.selVoice.innerHTML;
    const vlist = window.speechSynthesis?.getVoices() || [];
    if (!vlist.length){ setTimeout(tryFill, 150); return; }
    els.selVoice.innerHTML = '';
    vlist.forEach(v=>{
      const opt = document.createElement('option'); opt.value = v.voiceURI; opt.textContent = `${v.name} (${v.lang})`;
      if (/fr/i.test(v.lang)) opt.textContent += ' · FR';
      els.selVoice.appendChild(opt);
    });
    const prefer = vlist.find(v=>/fr/i.test(v.lang)) || vlist[0];
    if (prefer) els.selVoice.value = prefer.voiceURI;
    state.settings.frVoice = els.selVoice.value;
    setSettings({voiceURI: state.settings.frVoice, rate: state.settings.rate, pitch: state.settings.pitch});
    if (prev !== els.selVoice.innerHTML) showToast('Stimmen geladen');
  };
  tryFill();
}

// ---------- Save/Load ----------
function saveAll(){
  const payload = {
    progress: state.progress,
    meta: { hash: hashItems(state.items), updated: Date.now() }
  };
  saveProgressDebounced(payload);
}

// ---------- Boot ----------
window.addEventListener('DOMContentLoaded', async ()=>{
  initTTS();
  // Versuche gespeicherte Daten + Beispieldaten, falls leer
  try{
    const res = await fetch('./data/sample.json');
    const sample = await res.json();
    setItems(sample);
  }catch(e){ /* offline */ }
});
