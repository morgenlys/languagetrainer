// tts.js – Web Speech API Wrapper (FR-Voice-Picking + Settings + Checks)
let voices = [];
let ready = false;

function refreshVoices(){
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  ready = true;
}
if ('speechSynthesis' in window){
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}

const settings = { rate:1, pitch:1, voiceURI:null };

export function setSettings({rate, pitch, voiceURI}){
  if (typeof rate === 'number') settings.rate = rate;
  if (typeof pitch === 'number') settings.pitch = pitch;
  if (typeof voiceURI === 'string') settings.voiceURI = voiceURI;
}

export function getVoices(){ return voices; }
export function hasFrenchVoice(){
  return voices.some(v => /^fr([-_]|$)/i.test(v.lang));
}
export function pickFrench(){
  const exact = voices.find(v => /^fr[-_]FR$/i.test(v.lang));
  if (exact) return exact;
  const fr = voices.find(v => /^fr/i.test(v.lang));
  return fr || null;
}

export function speakFR(text){
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const chosen = (settings.voiceURI && voices.find(v=>v.voiceURI === settings.voiceURI)) || pickFrench();
  if (chosen) u.voice = chosen;
  u.lang = (chosen?.lang) || 'fr-FR';
  u.rate = settings.rate;
  u.pitch = settings.pitch;
  try { speechSynthesis.cancel(); } catch(e){}
  setTimeout(()=> speechSynthesis.speak(u), 60);
}

export function defaultFrenchVoiceURI(){
  const v = pickFrench();
  return v ? v.voiceURI : '';
}
