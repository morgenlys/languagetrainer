import {parseCSV, shuffle, choice, normalize, isAcceptable, uniqueText} from './utils.js';
import {saveProgressCookie, loadProgressCookie, resetProgress, saveProgressDebounced} from './storage.js';
import {newProgressFor, mergeProgress, selectNextItem, allowedModesFor, updateAfterAnswer, distractorsFor} from './srs.js';
import {getVoices, setSettings, speakFR, defaultFrenchVoiceURI, hasFrenchVoice} from './tts.js';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const state = {
  items: [],
  progress: {},
  session: { onlyDue:false, includeWords:true, includeSentences:true },
  current: null,
  settings: { frVoice: null, rate:1, pitch:1, autoplay:true },
  totals: {total:0, new:0, due:0, streak:0},
  answered: false
};

const el = {
  statTotal: $('#stat-total'), statNew: $('#stat-new'), statDue: $('#stat-due'), statStreak: $('#stat-streak'),
  modeContainer: $('#mode-container'),
  actionBar: $('#action-bar'), actionMsg: $('#action-msg'), primary: $('#primary-action'),
  btnOptions: $('#btn-options'), modalOptions: $('#modal-options'), modalVoice: $('#modal-voice'),
  chkOnlyDue: $('#chk-only-due'), chkWords: $('#chk-include-words'), chkSent: $('#chk-include-sentences'),
  btnNew: $('#btn-new-session'), btnNext: $('#btn-next'), btnReset: $('#btn-reset'),
  btnImport: $('#btn-import'), fileInput: $('#file-input'),
  selVoice: $('#sel-voice'), inpRate: $('#inp-rate'), inpPitch: $('#inp-pitch'), btnTTSTest: $('#btn-tts-test'),
  btnSample: $('#btn-load-sample'),
  themeToggle: $('#theme-toggle'), fxOk: $('#fx-ok'), fxBad: $('#fx-bad')
};

/* ===== THEME ===== */
(function initTheme(){
  const persisted = localStorage.getItem('vt_theme') || 'light';
  document.documentElement.setAttribute('data-theme', persisted);
  el.themeToggle.checked = (persisted === 'dark');
  el.themeToggle.addEventListener('change', ()=>{
    const mode = el.themeToggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('vt_theme', mode);
  });
})();

/* ===== DATA ===== */
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
  state.progress = (old && old.progress && old.meta && old.meta.hash === hashItems(state.items))
    ? mergeProgress(state.items, old.progress)
    : newProgressFor(state.items);

  saveAll(); refreshStats();
  showMsg('Daten geladen.');
}

/* ===== MODALS ===== */
function openModal(mod){ mod.setAttribute('aria-hidden','false'); }
function closeModal(mod){ mod.setAttribute('aria-hidden','true'); }
el.btnOptions.addEventListener('click', ()=> openModal(el.modalOptions));
$$('[data-close]').forEach(btn=> btn.addEventListener('click', e=> closeModal(e.target.closest('.modal'))));
el.modalOptions.querySelector('.modal-backdrop').addEventListener('click', ()=> closeModal(el.modalOptions));
el.modalVoice.querySelector('.modal-backdrop').addEventListener('click', ()=> closeModal(el.modalVoice));

/* ===== STATS ===== */
function refreshStats(){
  const arr = Object.values(state.progress);
  const total = arr.length, now = Date.now();
  const due = arr.filter(x => (x.due||0) <= now).length;
  const neu = arr.filter(x => x.seen === 0).length;
  const streak = arr.reduce((a,b)=>a + (b.streak||0), 0);
  el.statTotal.textContent = total;
  el.statNew.textContent = neu;
  el.statDue.textContent = due;
  el.statStreak.textContent = streak;
}

/* ===== TTS ===== */
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

/* ===== SOUNDS ===== */
async function playOgg(audioEl, fallbackType){
  if (!audioEl) return playFX(fallbackType);
  try{
    const p = audioEl.play();
    if (p && p.catch) await p.catch(()=> playFX(fallbackType));
  }catch(e){ playFX(fallbackType); }
}
function playFX(type='ok'){
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  const t0 = ctx.currentTime;
  if (type==='ok'){
    o.type='sine'; o.frequency.setValueAtTime(660, t0);
    o.frequency.exponentialRampToValueAtTime(880, t0+0.12);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+0.20);
    o.start(t0); o.stop(t0+0.22);
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

/* ===== helpers ===== */
function showMsg(text){ el.actionMsg.innerHTML = text; }
function setActionLabel(text, cls=null){
  el.actionBar.classList.remove('ok','bad');
  el.primary.classList.remove('ok','bad');
  el.primary.textContent = text;
  if (cls){
    el.actionBar.classList.add(cls);
    el.primary.classList.add(cls);
  }
}
function setPrimaryEnabled(on){ el.primary.disabled = !on; }
function clearForNext(){
  el.actionBar.classList.remove('ok','bad');
  el.actionMsg.textContent = '';
  setActionLabel('Überprüfen');
  setPrimaryEnabled(false);
}

/* Prompt-Größe 36/24/18 je Länge */
function applyPromptSize(node, text){
  const len = (text||'').length;
  let px = 36; if (len > 60) px = 18; else if (len > 28) px = 24;
  node.style.fontSize = px + 'px';
}

/* Emoji: aus JSON (item.emoji) – Fallback auf interne Map */
function emojiFor(item){
  if (item && item.emoji) return item.emoji;
  const fr = normalize(item.fr);
  const map = { 'maison':'🏠','bonjour':'👋','merci':'🙏','fromage':'🧀','pain':'🥖','eau':'💧','chat':'🐱','chien':'🐶','voiture':'🚗','gare':'🚉','ecole':'🏫','école':'🏫','cafe':'☕','café':'☕','pomme':'🍎','banane':'🍌','soleil':'☀️','pluie':'🌧️' };
  return map[fr] || '';
}

/* ===== RENDER ===== */
function render(item){
  state.current = item; state.answered = false; clearForNext();

  const host = el.modeContainer; host.innerHTML = '';
  const p = state.progress[item.id];
  const allowed = allowedModesFor(p);
  let mode = choice(allowed);
  if (item.type !== 'sentence' && mode==='sentence_build'){ mode = 'mc_df'; }

  if (mode === 'mc_df') renderMC(host, item, 'df');
  else if (mode === 'mc_fd') renderMC(host, item, 'fd');
  else if (mode === 'input_df') renderInputDF(host, item);
  else if (mode === 'match5') renderMatch5(host, item);
  else if (mode === 'speech_mc') renderSpeechMC(host, item);
  else if (mode === 'speech_input') renderSpeechInput(host, item);
  else if (mode === 'sentence_build') renderSentenceBuilder(host, item);
}

/* MC */
function renderMC(host, item, dir){
  const isDF = dir==='df';
  const wrap = div('mc-wrap');

  const emoji = emojiFor(item);
  if (emoji) wrap.append(div('emoji-hint', emoji));

  const prompt = div('prompt', isDF ? item.de : item.fr);
  applyPromptSize(prompt, isDF ? item.de : item.fr);
  wrap.append(prompt);

  const grid = div('mc-grid');
  const key = isDF ? 'fr' : 'de';
  const correct = {id:item.id, text:item[key], correct:true};
  let opts = [correct, ...distractorsFor(state.items, item, 6, dir)];
  opts = uniqueText(opts).slice(0,4);
  if (opts.length < 4){
    const pool = shuffle(state.items.filter(i=>i.id!==item.id));
    for (const cand of pool){
      const obj = {id:cand.id, text:cand[key]};
      if (uniqueText([...opts, obj]).length > opts.length) opts.push(obj);
      if (opts.length===4) break;
    }
  }
  opts = shuffle(opts);

  let selected = null;
  opts.forEach(o=>{
    const b = button('choice', o.text);
    b.addEventListener('click', ()=>{
      $$('.choice', grid).forEach(n => n.classList.remove('selected'));
      b.classList.add('selected'); selected = o; setPrimaryEnabled(true);
      if (isDF) speakFR(o.text);
    });
    grid.appendChild(b);
  });

  wrap.append(grid);
  host.append(wrap);
  if (!isDF) setTimeout(()=> speakFR(item.fr), 90);

  el.primary.onclick = ()=>{
    if (state.answered || !selected) return;
    const ok = !!selected.correct || normalize(selected.text)===normalize(item[key]);
    finish(ok, {modeId: isDF?'mc_df':'mc_fd', correctAnswer: item[key]});
  };
}

/* Input DF */
function renderInputDF(host, item){
  const emoji = emojiFor(item); if (emoji) host.append(div('emoji-hint', emoji));
  const prompt = div('prompt', item.de); applyPromptSize(prompt, item.de); host.append(prompt);

  const wrap = div('input-wrap');
  const input = document.createElement('input');
  input.placeholder='auf Französisch eingeben…';
  input.autocapitalize='off'; input.autocomplete='off'; input.spellcheck=false; input.setAttribute('autofocus','true');
  wrap.append(input); host.append(wrap);
  setTimeout(()=> input.focus(), 0);
  input.addEventListener('input', ()=> setPrimaryEnabled(input.value.trim().length>0));
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !el.primary.disabled){ el.primary.click(); } });
  setPrimaryEnabled(false);

  el.primary.onclick = ()=>{
    if (state.answered || !input.value.trim()) return;
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    finish(res.ok, {modeId:'input_df', correctAnswer:item.fr});
  };
}

/* Match 5 – beidseitig, mobil zwei Reihen à 5 nebeneinander */
function renderMatch5(host, item){
  const emoji = emojiFor(item); if (emoji) host.append(div('emoji-hint', emoji));
  const title = div('prompt','Zuordnen: Deutsch ↔ Französisch'); applyPromptSize(title, title.textContent); host.append(title);

  const grid = div('kv'); const left = div('col'), right = div('col');
  const pool = shuffle([item, ...shuffle(state.items.filter(i=>i.id!==item.id)).slice(0,4)]);
  const leftItems = shuffle(pool.map(it => ({id: it.id, text: it.de, side:'de'})));
  const rightItems = shuffle(pool.map(it => ({id: it.id, text: it.fr, side:'fr'})));

  let active = null;
  function onPick(obj, elNode){
    if (obj.side==='fr') speakFR(obj.text);
    if (active && active.el === elNode){ active.el.classList.remove('selected'); active=null; return; }
    if (!active){
      active = { ...obj, el: elNode }; elNode.classList.add('selected'); setPrimaryEnabled(true);
    } else {
      const ok = active.id === obj.id && active.side !== obj.side;
      if (ok){
        active.el.classList.add('matched'); elNode.classList.add('matched');
        active.el.classList.remove('selected'); active=null;
        const done = $$('.item', left).filter(n=>!n.classList.contains('matched')).length===0;
        if (done){ finish(true, {modeId:'match5', correctAnswer:''}); return; }
      } else {
        active.el.classList.remove('selected'); active=null;
        playOgg(el.fxBad, 'bad');
      }
    }
  }

  leftItems.forEach(li=>{ const d = div('item', li.text); d.addEventListener('click', ()=> onPick(li, d)); left.appendChild(d); });
  rightItems.forEach(ri=>{ const d = div('item', ri.text); d.addEventListener('click', ()=> onPick(ri, d)); right.appendChild(d); });
  grid.append(left,right); host.append(grid);

  el.primary.onclick = ()=> { if (state.answered) nextCard(); };
}

/* Speech MC */
function renderSpeechMC(host, item){
  const emoji = emojiFor(item); if (emoji) host.append(div('emoji-hint', emoji));
  const prompt = div('prompt','Was wurde gesagt? (Französisch)'); applyPromptSize(prompt, prompt.textContent); host.append(prompt);
  const playBtn = audioBtn(()=> speakFR(item.fr)); host.append(playBtn);

  const grid = div('mc-grid'); let opts = uniqueText([{text:item.fr, correct:true}, ...distractorsFor(state.items, item, 6, 'df')]).slice(0,4);
  if (opts.length<4){
    const pool = shuffle(state.items.filter(i=>i.id!==item.id));
    for (const c of pool){ const o = {text:c.fr}; if (uniqueText([...opts, o]).length > opts.length) opts.push(o); if (opts.length===4) break; }
  }
  opts = shuffle(opts);
  let selected = null;
  opts.forEach(o=>{
    const b = button('choice', o.text);
    b.addEventListener('click', ()=>{
      speakFR(o.text);
      $$('.choice', grid).forEach(n => n.classList.remove('selected'));
      b.classList.add('selected'); selected = o; setPrimaryEnabled(true);
    });
    grid.appendChild(b);
  });
  host.append(grid);
  setTimeout(()=> speakFR(item.fr), 90);

  el.primary.onclick = ()=>{
    if (state.answered || !selected) return;
    const ok = !!selected.correct || normalize(selected.text)===normalize(item.fr);
    finish(ok, {modeId:'speech_mc', correctAnswer:item.fr});
  };
}

/* Speech Input */
function renderSpeechInput(host, item){
  const emoji = emojiFor(item); if (emoji) host.append(div('emoji-hint', emoji));
  const prompt = div('prompt','Schreibe, was du hörst (Französisch)'); applyPromptSize(prompt, prompt.textContent); host.append(prompt);
  const playBtn = audioBtn(()=> speakFR(item.fr)); host.append(playBtn);
  const wrap = div('input-wrap'); const input = document.createElement('input'); input.placeholder='gehörtes FR-Wort/-Satz…';
  input.autocapitalize='off'; input.autocomplete='off'; input.spellcheck=false; input.setAttribute('autofocus','true');
  wrap.append(input); host.append(wrap); setTimeout(()=> input.focus(), 0);
  input.addEventListener('input', ()=> setPrimaryEnabled(input.value.trim().length>0));
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !el.primary.disabled){ el.primary.click(); } });
  setPrimaryEnabled(false); setTimeout(()=> speakFR(item.fr), 110);

  el.primary.onclick = ()=>{
    if (state.answered || !input.value.trim()) return;
    const res = isAcceptable(input.value, item.fr, item.alts?.fr || []);
    finish(res.ok, {modeId:'speech_input', correctAnswer:item.fr});
  };
}

/* Satzbau – Slots + Rückwärtsbewegung */
function renderSentenceBuilder(host, item){
  const emoji = emojiFor(item); if (emoji) host.append(div('emoji-hint', emoji));
  const prompt = div('prompt', item.de); applyPromptSize(prompt, item.de); host.append(prompt);

  const wrap = div('sentence-builder'); const target = div('sentence-target'); const pool = div('pool');
  const tiles = shuffle(item.tokens_fr.slice()); let placed = 0;

  const slotsById = new Map();

  tiles.forEach((t, idx)=>{
    const tile = div('tile', t);
    const slot = div('pool-slot'); slot.appendChild(tile); pool.appendChild(slot);

    requestAnimationFrame(()=>{ const r = tile.getBoundingClientRect(); slot.style.width=r.width+'px'; slot.style.height=r.height+'px'; });

    const sid = 's'+idx+'_'+Math.random().toString(36).slice(2);
    tile.dataset.slotId = sid; slot.dataset.slotId = sid; slotsById.set(sid, slot);

    tile.addEventListener('click', ()=> move(tile));
  });

  wrap.append(target, pool); host.append(wrap);
  setPrimaryEnabled(false);

  el.primary.onclick = ()=>{
    if (state.answered) { nextCard(); return; }
    const built = [...target.children].map(n=>n.textContent).join(' ').trim();
    const ok = normalize(built) === normalize(item.tokens_fr.join(' ').trim());
    finish(ok, {modeId:'sentence_build', correctAnswer:item.fr});
  };

  function move(tile){
    // in Ziel -> zurück
    if (tile.parentElement === target){
      const slot = slotsById.get(tile.dataset.slotId);
      const rectFrom = tile.getBoundingClientRect(); const rectTo = slot.getBoundingClientRect();
      const clone = tile.cloneNode(true); clone.classList.add('fly-clone');
      Object.assign(clone.style,{left:rectFrom.left+'px',top:rectFrom.top+'px',width:rectFrom.width+'px'}); document.body.appendChild(clone);
      const dx = rectTo.left-rectFrom.left; const dy = rectTo.top-rectFrom.top;
      clone.animate([{transform:'translate(0,0)'},{transform:`translate(${dx}px, ${dy}px)`}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'}).onfinish=()=>{
        clone.remove(); slot.classList.remove('empty'); slot.appendChild(tile); placed=Math.max(0,placed-1); setPrimaryEnabled(placed>0);
      };
      return;
    }

    // aus Pool -> ins Ziel
    const slot = slotsById.get(tile.dataset.slotId); slot.classList.add('empty');
    const ghost = document.createElement('span'); ghost.className='ghost-slot'; target.appendChild(ghost);
    const rectFrom = tile.getBoundingClientRect(); const rectGhost = ghost.getBoundingClientRect();
    const clone = tile.cloneNode(true); clone.classList.add('fly-clone');
    Object.assign(clone.style,{left:rectFrom.left+'px',top:rectFrom.top+'px',width:rectFrom.width+'px'}); document.body.appendChild(clone);
    const dx = rectGhost.left-rectFrom.left; const dy = rectGhost.top-rectFrom.top;
    clone.animate([{transform:'translate(0,0)'},{transform:`translate(${dx}px, ${dy-6}px)`}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'}).onfinish=()=>{
      ghost.replaceWith(tile); clone.remove(); placed++; setPrimaryEnabled(placed>0);
    };
  }
}

/* helpers */
function div(cls, html){ const d=document.createElement('div'); if(cls) d.className=cls; if(html!==undefined) d.innerHTML=html; return d; }
function button(cls, html){ const b=document.createElement('button'); if(cls) b.className=cls; b.innerHTML=html; return b; }
function audioBtn(onClick){ const b = button('audio-btn', `<svg><use href="#icon-sound"/></svg>`); b.addEventListener('click', onClick); return b; }

/* Abschluss */
function finish(ok, {modeId, correctAnswer}){
  if (state.answered) return;
  state.answered = true;

  const item = state.current;
  const p = state.progress[item.id];
  updateAfterAnswer(p, ok, modeId);
  saveAll(); refreshStats();

  // Sounds
  playOgg(ok ? el.fxOk : el.fxBad, ok ? 'ok' : 'bad');

  if (ok){ showMsg('✔ Richtig!'); setActionLabel('Weiter','ok'); }
  else   { showMsg(`✖ Falsch. Richtig: <strong>${correctAnswer || item.fr}</strong>`); setActionLabel('Weiter','bad'); }

  el.primary.onclick = ()=> nextCard();
}

/* Flow */
function nextCard(){
  if (!state.items.length) return;
  const opts = { onlyDue: el.chkOnlyDue.checked, includeWords: el.chkWords.checked, includeSentences: el.chkSent.checked };
  const item = selectNextItem(state.items, state.progress, opts);
  clearForNext(); render(item);
}

/* Import / Sample / Reset */
$('#btn-import')?.addEventListener('click', ()=> el.fileInput.click());
el.fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const text = await f.text();
  if (f.name.endsWith('.json')) setItems(JSON.parse(text));
  else if (f.name.endsWith('.csv')) setItems(parseCSV(text));
});
$('#btn-load-sample')?.addEventListener('click', async ()=>{
  const res = await fetch('./data/sample.json'); const json = await res.json(); setItems(json);
});
$('#btn-reset')?.addEventListener('click', ()=>{
  if (confirm('Fortschritt zurücksetzen?')){
    resetProgress(); state.progress = newProgressFor(state.items); saveAll(); refreshStats(); showMsg('Fortschritt gelöscht.');
  }
});

/* Options toggles */
el.chkOnlyDue.addEventListener('change', ()=> state.session.onlyDue = el.chkOnlyDue.checked);
el.chkWords.addEventListener('change', ()=> state.session.includeWords = el.chkWords.checked);
el.chkSent.addEventListener('change', ()=> state.session.includeSentences = el.chkSent.checked);
el.btnNew.addEventListener('click', ()=> { closeModal(el.modalOptions); nextCard(); });
el.btnNext.addEventListener('click', ()=> nextCard());

/* Save */
function saveAll(){
  const payload = { progress: state.progress, meta: { hash: hashItems(state.items), updated: Date.now() } };
  saveProgressDebounced(payload);
}

/* Boot */
window.addEventListener('DOMContentLoaded', async ()=>{
  initTTS();
  try{ const res = await fetch('./data/sample.json'); const json = await res.json(); setItems(json); }catch(e){}
  el.primary.onclick = ()=> {}; // wird im Renderer gesetzt
});
