const COOKIE_MAX = 3800;
const COOKIE_PREFIX = "vtp_";
const COOKIE_DAYS = 365;

function setCookie(name, value, days=COOKIE_DAYS){
  const d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}
function getCookie(name){ return document.cookie.split('; ').find(row => row.startsWith(name+'='))?.split('=')[1]; }
function deleteCookie(name){ setCookie(name, '', -1); }
function chunkString(str, size){ const out=[]; for (let i=0;i<str.length;i+=size) out.push(str.slice(i, i+size)); return out; }

export function saveProgressCookie(obj){
  try{
    document.cookie.split('; ').forEach(c=>{
      const [k] = c.split('=');
      if(k.startsWith(COOKIE_PREFIX)) deleteCookie(k);
    });
    const json = JSON.stringify(obj);
    const chunks = chunkString(json, COOKIE_MAX);
    chunks.forEach((ch, idx) => setCookie(`${COOKIE_PREFIX}${idx}`, ch));
    setCookie(`${COOKIE_PREFIX}meta`, String(chunks.length));
  }catch(e){
    localStorage.setItem('vt_progress', JSON.stringify(obj));
  }
}
export function loadProgressCookie(){
  try{
    const n = parseInt(getCookie(`${COOKIE_PREFIX}meta`) || '0', 10);
    if (!n) {
      const ls = localStorage.getItem('vt_progress');
      return ls ? JSON.parse(ls) : null;
    }
    let json = '';
    for (let i=0;i<n;i++){
      const part = getCookie(`${COOKIE_PREFIX}${i}`) || '';
      json += decodeURIComponent(part);
    }
    return JSON.parse(json);
  }catch(e){
    const ls = localStorage.getItem('vt_progress');
    return ls ? JSON.parse(ls) : null;
  }
}
export function resetProgress(){
  document.cookie.split('; ').forEach(c=>{
    const [k] = c.split('=');
    if(k.startsWith(COOKIE_PREFIX)) deleteCookie(k);
  });
  localStorage.removeItem('vt_progress');
}
let _queue = null;
export function saveProgressDebounced(state, delay=300){
  if (_queue) clearTimeout(_queue);
  _queue = setTimeout(()=> saveProgressCookie(state), delay);
}
