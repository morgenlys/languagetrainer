import {parseCSV, shuffle, choice, normalize, isAcceptable} from './utils.js';
import {saveProgressCookie, loadProgressCookie, resetProgress, saveProgressDebounced} from './storage.js';
import {newProgressFor, mergeProgress, selectNextItem, allowedModesFor, updateAfterAnswer, distractorsFor} from './srs.js';
import {getVoices, setSettings, speakFR, getFrenchVoiceURI, waitForVoices, hasFrenchVoice} from './tts.js';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const state = {
  items: [],
  progress: {},
  session: { onlyDue:false, includeWords:true, includeSentences:true },
  current: null,
  settings: { frVoice: null, rate:1, pitch:1 },
  totals: {total:0, new:0, due:0, streak:0},
  theme: 'light'
};

// ---------- Regions ----------
const regions = {
  qHeader: $('.q-header'),
  qBody: $('.q-body'),
  qFooter: $('.q-footer')
};

// ---------- Toast ----------
const toastEl = $('#toast');
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(()=> toastEl.classList.remove('show'), 1400);
}

// ---------- Stats ----------
const statEls = {
  total: $('#stat-total'),
  neu: $('#stat-new'),
  due: $('#stat-due'),
  streak: $('#stat-streak'),
  progress: $('#progress'),
};
function refreshStats(){
  const p = state.progress;
  const arr = Object.values(p);
  const total = arr.length;
  const now = Date.now();
  const due = arr.filter(x => (x.due||0) <= now).length;
  const neu = arr.filter(x => x.seen === 0).length;
  const streak = arr.reduce((a,b)=>a + (b.streak||0), 0);
  state.totals = {total, new:neu, due, streak};
  statEls.total.textContent = total;
  statEls.neu.textContent = neu;
  statEls.due.textContent = due;
  statEls.streak.textContent = streak;
  const learned = arr.filter(x=>x.stage>=2 && x.streak>=3).length;
  const pct = total ? Math.round((learned/total)*100) : 0;
  statEls.progress.style.width = pct+'%';
}

// ---------- Theme ----------
const themeToggle = $('#toggle-theme');
function loadTheme(){
  const t = localStorage.getItem('vt_theme') || 'light';
  state.theme = t;
  document.body.classList.toggle('theme-dark', t === 'dark');
  themeToggle.checked = (t === 'dark');
}
function saveTheme(){
  localStorage.setItem('vt_theme', state.theme);
}
themeToggle.addEventListener('change', ()=>{
  state.theme = themeToggle.checked ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', state.theme === 'dark');
  saveTheme();
});

// ---------- Data ----------
function tokenizeFr(s){ return (s||'').split(/[\s]+/).map(t=>t.replace(/[.,!?;:()«»"“”]/g,'')).filter(Boolean); }
function hashItems(items){
  const s = items.map(i => i.id + '|' + i.de + '|' + i.fr).join('¬');
  let h = 0;
  for (let i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; }
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
  saveAll();
  refreshStats();
  showToast(`Geladen: ${state.items.length} Einträge`);
}

async function loadSample(){
  const res = await fetch('./data/sample.json');
  const json = await res.json();
  setItems(json);
}

// ---------- Modals ----------
function openModal(id){ const m = document.getElementById(id); if(m) m.hidden = false; }
function closeModal(id){ const m = document.getElementById(id); if(m) m.hidden = true; }
$$('.modal .icon-btn[data-close]').forEach(b=>{
  b.addEventListener('click', ()=> closeModal(b.getAttribute('data-close')));
});
$('#btn-options').addEventListener('click', ()=> openModal('modal-options'));

// ---------- Options Controls ----------
const els = {
  btnLoadSample: $('#btn-load-sample'),
  btnNewSession: $('#btn-new-session'),
  btnNewSession2: $('#btn-new-session-2'),
  btnNext: $('#btn-next'),
  chkOnlyDue: $('#chk-only-due'),
  chkWords: $('#chk-include-words'),
  chkSent: $('#chk-include-sentences'),
  btnImport: $('#btn-import'),
  fileInput: $('#file-input'),
  btnReset: $('#btn-reset'),
  selVoice: $('#sel-voice'),
  inpRate: $('#inp-rate'),
  inpPitch: $('#inp-pitch'),
  btnTTSTest: $('#btn-tts-test'),
  btnVoiceRetry: $('#btn-voices-retry'),
  btnTTSTestVoice: $('#btn-tts-test-voice'),
};

els.btnLoadSample.addEventListener('click', loadSample);
els.btnNewSession.addEventListener('click', ()=> nextCard());
els.btnNewSession2.addEventListener('click', ()=> { closeModal('modal-options'); nextCard(); });
els.btnNext.addEventListener('click', ()=> nextCard());

els.chkOnlyDue.addEventListener('change', ()=> state.session.onlyDue = els.chkOnlyDue.checked);
els.chkWords.addEventListener('change', ()=> state.session.includeWords = els.chkWords.checked);
els.chkSent.addEventListener('change', ()=> state.session.includeSentences = els.chkSent.checked);

els.btnImport.addEventListener('click', ()=> els.fileInput.click());
els.fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const text = await f.text();
  try{
    if (f.name.endsWith('.json')) setItems(JSON.parse(text));
    else if (f.name.endsWith('.csv')) setItems(parseCSV(text));
    else showToast('Nur .json oder .csv');
  }catch(err){ showToast('Datei konnte nicht gelesen werden'); }
});

els.btnReset.addEventListener('click', ()=>{
  if (confirm('Fortschritt zurücksetzen?')) {
    resetProgress();
    state.progress = newProgressFor(state.items);
    saveAll();
    refreshStats();
    showToast('Fortschritt gelöscht');
  }
});

// ---------- TTS / Voices ----------
function populateVoicesUI(){
  const list = getVoices();
  els.selVoice.innerHTML = '';
  list.forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})${/^fr[-_]/i.test(v.lang) ? ' · FR' : ''}`;
    els.selVoice.appendChild(opt);
  });
  // Vorauswahl: FR
  const prefer = getFrenchVoiceURI() || list[0]?.voiceURI || null;
  if (prefer) els.selVoice.value = prefer;
  state.settings.frVoice = els.selVoice.value || null;
  setSettings({voiceURI: state.settings.frVoice, rate: state.settings.rate, pitch: state.settings.pitch});
}

function setupVoiceHandlers(){
  els.selVoice.addEventListener('change', ()=>{
    state.settings.frVoice = els.selVoice.value;
    setSettings({voiceURI: state.settings.frVoice});
  });
  els.inpRate.addEventListener('input', ()=>{
    state.settings.rate = parseFloat(els.inpRate.value);
    setSettings({rate: state.settings.rate});
  });
  els.inpPitch.addEventListener('input', ()=>{
    state.settings.pitch = parseFloat(els.inpPitch.value);
    setSettings({pitch: state.settings.pitch});
  });
  els.btnTTSTest.addEventListener('click', ()=> speakFR('Bonjour, je suis votre voix française.'));
  els.btnTTSTestVoice.addEventListener('click', ()=> speakFR('Bonjour, test de la voix française.'));
  els.btnVoiceRetry.addEventListener('click', async ()=>{
    showToast('Prüfe Stimmen…');
    await waitForVoices(1200);
    populateVoicesUI();
    if (hasFrenchVoice()) {
      closeModal('modal-voice');
      showToast('Französische Stimme gefunden ✓');
    } else {
      showToast('Keine FR-Stimme gefunden');
    }
  });
}

// ---------- Card Rendering ----------
function clearRegions(){
  regions.qHeader.innerHTML = '';
  regions.qBody.innerHTML = '';
  regions.qFooter.innerHTML = '';
}
function setHeader(content){
  regions.qHeader.innerHTML = '';
  regions.qHeader.appendChild(content);
}
function setBody(...nodes){
  regions.qBody.innerHTML = '';
  nodes.forEach(n => regions.qBody.appendChild(n));
}
function setFooter(...nodes){
  regions.qFooter.innerHTML = '';
  nodes.forEach(n => regions.qFooter.appendChild(n));
}

function audioBtn(onClick){
  const b = document.createElement('button');
  b.className='audio-btn';
  b.innerHTML = `<svg><use href="#icon-sound"/></svg>`;
  b.addEventListener('click', onClick);
  return b;
}
function badgeNote(item){
  const n = document.createElement('div');
  n.className = 'note';
  n.innerHTML = `${item.notes ? item.notes + ' · ' : ''}<span class="muted">FR:</span> ${item.fr} · <span class="muted">DE:</span> ${item.de}`;
  return n;
}
function promptEl(text){
  const d = document.createElement('div');
  d.className='prompt';
  d.textContent = text;
  return d;
}
function actionsAgainNext(item){
  const actions = document.createElement('div');
  actions.className = 'actions';
  const again = document.createElement('button');
  again.className = 'btn ghost';
  again.textContent = 'Nochmal';
  again.addEventListener('click', ()=> renderModeFor(item));
  const next = document.createElement('button');
  next.className = 'btn primary';
  next.innerHTML = `<svg><use href="#icon-refresh"/></svg> Weiter`;
  next.addEventListener('click', ()=> nextCard());
  actions.append(again, next);
  return actions;
}

function finish(ok, modeId){
  const item = state.current;
  const p = state.progress[item.id];
  updateAfterAnswer(p, ok, modeId);
  saveAll();
  refreshStats();
  const msg = document.createElement('div');
  msg.className = ok ? 'correct-hint' : 'wrong-hint';
  msg.innerHTML = ok ? '✔ Richtig!' : `✖ Falsch. Richtig wäre: <strong>${item.fr}</strong>`;
  setFooter(msg, actionsAgainNext(item));
}

// RENDERERS
function renderModeFor(item){
  const p = state.progress[item.id];
  const allowed = allowedModesFor(p);
  const mode = choice(allowed);
  // sentence_build nur wenn Satz
  if (item.type !== 'sentence' && mode==='sentence_build') return renderModeFor(item);

  clearRegions();

  const map = {
    'mc_df': renderMCDF,
    'mc_fd': renderMCFD,
    'input_df': renderInputDF,
    'match5': renderMatch5,
    'speech_mc': renderSpeechMC,
    'speech_input': renderSpeechInput,
    'sentence_build': renderSentenceBuilder
  };
  map[mode](item, p, mode);
}

function renderMCDF(item, p, modeId){
  const head = document.createElement('div');
  head.append(promptEl(item.de), audioBtn(()=> speakFR(item.fr)));
  setHeader(head);

  const grid = document.createElement('div'); grid.className='mc-grid';
  const options = shuffle([{text:item.fr, correct:true}, ...distractorsFor(state.items, item, 3, 'df')]);
  options.forEach(o=>{
    const b = document.createElement('button');
    b.className='choice';
    b.textContent = o.text;
    b.addEventListener('click', ()=> finish(!!o.correct, modeId));
    grid.appendChild(b);
  });
  setBody(grid);
  setFooter(badgeNote(item));
}

function renderMCFD(item, p, modeId){
  const head = document.createElement('div');
  head.append(promptEl(item.fr), audioBtn(()=> speakFR(item.fr)));
  setHeader(head);

  const grid = document.createElement('div'); grid.className='mc-grid';
  const options = shuffle([{text:item.de, correct:true}, ...distractorsFor(state.items, item, 3, 'fd')]);
  options.forEach(o=>{
    const b = document.createElement('button');
    b.className='choice';
    b.textContent = o.text;
    b.addEventListener('click', ()=> finish(!!o.correct, modeId));
    grid.appendChild(b);
  });
  setBody(grid);
  setFooter(badgeNote(item));
}

function renderInputDF(item, p, modeId){
  const head = document.createElement('div');
  head.append(promptEl(item.de), audioBtn(()=> speakFR(item.fr)));
  setHeader(head);

  const wrap = document.createElement('div'); wrap.className='input-wrap';
  const input = document.createElement('input');
  input.placeholder = 'auf Französisch eingeben…';
  input.autocapitalize = 'off'; input.autocomplete = 'off'; input.spellcheck = false;
  const btn = document.createElement('button'); btn.className='btn'; btn.textContent='Prüfen';
  wrap.append(input, btn);
  setBody(wrap);
  setFooter(badgeNote(item));
  input.focus();
  const submit = ()=>{
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    btn.classList.add(res.ok ? 'correct-hint' : 'wrong-hint');
    finish(res.ok, modeId);
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e=>{ if (e.key === 'Enter') submit(); });
}

function renderMatch5(item, p, modeId){
  const head = promptEl('Zuordnen: Deutsch ↔ Französisch');
  setHeader(head);

  const pool = shuffle([item, ...shuffle(state.items.filter(i=>i.id!==item.id)).slice(0,4)]);
  const left = document.createElement('div'); left.className='col';
  const right = document.createElement('div'); right.className='col';
  const kv = document.createElement('div'); kv.className='kv';
  kv.append(left, right);

  const leftItems = shuffle(pool.map(it => ({id: it.id, text: it.de})));
  const rightItems = shuffle(pool.map(it => ({id: it.id, text: it.fr})));
  let activeLeft = null, matches = 0;

  leftItems.forEach(li=>{
    const d = document.createElement('div'); d.className='item'; d.textContent = li.text;
    d.addEventListener('click', ()=> { activeLeft = li; highlight(left, d); });
    left.appendChild(d);
  });
  rightItems.forEach(ri=>{
    const d = document.createElement('div'); d.className='item'; d.textContent = ri.text;
    d.addEventListener('click', ()=>{
      if (!activeLeft) return;
      const ok = ri.id === activeLeft.id;
      if (ok){
        d.classList.add('matched');
        const leftEl = [...left.children].find(n=>n.textContent===activeLeft.text);
        leftEl?.classList.add('matched');
        activeLeft = null;
        matches++;
        if (matches === pool.length) finish(true, modeId);
      } else { shake(d); }
    });
    right.appendChild(d);
  });

  setBody(kv);
  setFooter(badgeNote(item));
}

function renderSpeechMC(item, p, modeId){
  const head = promptEl('Was wurde gesagt? (Französisch)');
  const play = audioBtn(()=> speakFR(item.fr));
  const headWrap = document.createElement('div'); headWrap.append(head, play);
  setHeader(headWrap);

  const grid = document.createElement('div'); grid.className='mc-grid';
  const options = shuffle([{text:item.fr, correct:true}, ...distractorsFor(state.items, item, 3, 'df')]);
  options.forEach(o=>{
    const b = document.createElement('button'); b.className='choice'; b.textContent = o.text;
    b.addEventListener('click', ()=> finish(!!o.correct, modeId));
    grid.appendChild(b);
  });
  setBody(grid);
  setFooter(badgeNote(item));
}

function renderSpeechInput(item, p, modeId){
  const head = promptEl('Schreibe, was du hörst (Französisch)');
  const play = audioBtn(()=> speakFR(item.fr));
  const headWrap = document.createElement('div'); headWrap.append(head, play);
  setHeader(headWrap);

  const wrap = document.createElement('div'); wrap.className='input-wrap';
  const input = document.createElement('input'); input.placeholder = 'gehörtes FR-Wort/-Satz…';
  const btn = document.createElement('button'); btn.className='btn'; btn.textContent = 'Prüfen';
  wrap.append(input, btn);
  setBody(wrap);
  setFooter(badgeNote(item));
  input.focus();
  const onSubmit = ()=>{
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    finish(res.ok, modeId);
  };
  btn.addEventListener('click', onSubmit);
  input.addEventListener('keydown', e=>{ if (e.key==='Enter') onSubmit(); });
}

function renderSentenceBuilder(item, p, modeId){
  const head = document.createElement('div');
  const pill = document.createElement('span'); pill.className='badge'; pill.textContent='Satz bauen';
  const title = promptEl(item.de + ' ');
  head.append(title, pill, audioBtn(()=> speakFR(item.fr)));
  setHeader(head);

  const pool = document.createElement('div'); pool.className='pool';
  const target = document.createElement('div'); target.className='sentence-target';
  const tiles = shuffle(item.tokens_fr.slice());
  tiles.forEach(t=>{
    const tile = document.createElement('div'); tile.className='tile'; tile.textContent = t;
    tile.addEventListener('click', ()=>{
      if (tile.parentElement === pool) { pool.removeChild(tile); target.appendChild(tile); }
      else { target.removeChild(tile); pool.appendChild(tile); }
      tile.style.transform = 'scale(1.02)';
      setTimeout(()=> tile.style.transform = '', 120);
      check();
    });
    pool.appendChild(tile);
  });
  function check(){
    const built = [...target.children].map(n=>n.textContent).join(' ').trim();
    const goal = item.tokens_fr.join(' ').trim();
    if (normalize(built) === normalize(goal)) finish(true, modeId);
  }
  setBody(pool, target);
  setFooter(badgeNote(item));
}

// helpers
function highlight(container, node){ $$('.item', container).forEach(n=> n.style.outline=''); node.style.outline='2px solid var(--accent)'; }
function shake(node){ node.style.transform='translateX(2px)'; setTimeout(()=>node.style.transform='', 140); }

// ---------- Session Flow ----------
function nextCard(){
  if (!state.items.length){ showToast('Keine Daten geladen'); return; }
  const opts = {
    onlyDue: $('#chk-only-due').checked,
    includeWords: $('#chk-include-words').checked,
    includeSentences: $('#chk-include-sentences').checked
  };
  const item = selectNextItem(state.items, state.progress, opts);
  state.current = item;
  renderModeFor(item);
  showToast('Neue Aufgabe');
}

// ---------- Save ----------
function saveAll(){
  const payload = {
    progress: state.progress,
    meta: { hash: hashItems(state.items), updated: Date.now() }
  };
  saveProgressDebounced(payload);
}

// ---------- TTS Check (FR Voice) ----------
async function ensureFrenchVoice(){
  await waitForVoices(1200);
  populateVoicesUI();
  if (!hasFrenchVoice()){
    openModal('modal-voice');
  }
}

function initTTS(){
  setupVoiceHandlers();
  ensureFrenchVoice();
}

// ---------- Boot ----------
window.addEventListener('DOMContentLoaded', async ()=>{
  loadTheme();
  initTTS();
  // Beispieldaten laden (kannst du entfernen, wenn du immer importierst)
  try{
    const res = await fetch('./data/sample.json');
    const sample = await res.json();
    setItems(sample);
  }catch(e){ /* offline */ }
});
