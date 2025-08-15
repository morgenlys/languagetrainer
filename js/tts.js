// tts.js — Web Speech API (robuste FR-Auswahl + Checks)
let voices = [];
let readyResolvers = [];
let ready = false;

function resolveReady(){
  ready = true;
  readyResolvers.forEach(r => r());
  readyResolvers = [];
}

function loadVoicesSync(){
  if (!('speechSynthesis' in window)) return [];
  const v = window.speechSynthesis.getVoices() || [];
  return v;
}

function refreshVoices(){
  voices = loadVoicesSync();
  if (voices.length && !ready) resolveReady();
}

if ('speechSynthesis' in window){
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    refreshVoices();
  };
}

export function waitForVoices(timeoutMs=1500){
  if (ready && voices.length) return Promise.resolve();
  return new Promise((res) => {
    readyResolvers.push(res);
    // Fallback timer
    setTimeout(()=>{
      refreshVoices();
      res();
    }, timeoutMs);
  });
}

function pickFrench(){
  // bevorzuge 'fr-' Sprachen
  const fr = voices.filter(v => /^fr[-_]/i.test(v.lang));
  if (fr.length) return fr[0];
  // probiere FR-Namen
  const nameFR = voices.find(v => /fran|franz|french/i.test(v.name));
  return nameFR || null;
}

let settings = { rate:1, pitch:1, voiceURI:null };

export function setSettings({rate, pitch, voiceURI}){
  if (rate !== undefined) settings.rate = rate;
  if (pitch !== undefined) settings.pitch = pitch;
  if (voiceURI !== undefined) settings.voiceURI = voiceURI;
}

export function getVoices(){ return voices.slice(); }

export function hasFrenchVoice(){
  return getFrenchVoice() !== null;
}

export function getFrenchVoiceURI(){
  const v = getFrenchVoice();
  return v ? v.voiceURI : null;
}

function getFrenchVoice(){
  // Wenn explizit gesetzt, prüfen ob FR:
  if (settings.voiceURI){
    const v = voices.find(v=>v.voiceURI === settings.voiceURI);
    if (v && /^fr[-_]/i.test(v.lang)) return v;
  }
  return pickFrench();
}

export function speakFR(text){
  if (!('speechSynthesis' in window)) return;
  const v = getFrenchVoice();
  const utter = new SpeechSynthesisUtterance(text);
  if (v) {
    utter.voice = v;
    utter.lang = v.lang || 'fr-FR';
  } else {
    // Notfalls zumindest die Sprache setzen
    utter.lang = 'fr-FR';
  }
  utter.rate = settings.rate;
  utter.pitch = settings.pitch;
  try { speechSynthesis.cancel(); } catch(_) {}
  speechSynthesis.speak(utter);
}
