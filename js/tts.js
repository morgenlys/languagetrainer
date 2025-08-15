// tts.js – Web Speech API Wrapper (FR-Voice-Picking + Settings)
let voices = [];
const loadVoices = () => {
  voices = window.speechSynthesis.getVoices();
};
if ('speechSynthesis' in window){
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

const pickFrench = () => {
  const fr = voices.filter(v => /fr/i.test(v.lang));
  return fr[0] || voices[0] || null;
};

let settings = { rate:1, pitch:1, voiceURI:null };

export function setSettings({rate, pitch, voiceURI}){
  if (rate) settings.rate = rate;
  if (pitch) settings.pitch = pitch;
  if (voiceURI !== undefined) settings.voiceURI = voiceURI;
}

export function getVoices(){ return voices; }

export function getDefaultFrenchVoice(){
  const v = pickFrench();
  return v ? v.voiceURI : null;
}

export function speakFR(text){
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = voices.find(v=>v.voiceURI === settings.voiceURI) || pickFrench();
  if (v) u.voice = v;
  u.lang = (v?.lang) || 'fr-FR';
  u.rate = settings.rate;
  u.pitch = settings.pitch;
  speechSynthesis.cancel(); // stop previous
  speechSynthesis.speak(u);
}
