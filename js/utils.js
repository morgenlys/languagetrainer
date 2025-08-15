// utils.js – Normalisierung, Zufall, Damerau-Levenshtein, CSV-Parser

export const randInt = (n) => Math.floor(Math.random() * n);
export const choice = (arr) => arr[randInt(arr.length)];
export const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Entfernt Akzente, Punkte, Bindestriche, Apostrophe; lower-case; trim
export const normalize = (s) => (s ?? "")
  .toString()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[’'`´]/g, "")   // apostrophes
  .replace(/[.\-–—,:;!?¿¡()"“”«»]/g, " ") // punctuation -> space
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

// Damerau-Levenshtein
export function damerauLevenshtein(a, b){
  a = normalize(a); b = normalize(b);
  const al = a.length, bl = b.length;
  if(!al || !bl) return Math.max(al, bl);
  const dp = Array.from({length: al+1}, () => new Array(bl+1).fill(0));
  for(let i=0;i<=al;i++) dp[i][0]=i;
  for(let j=0;j<=bl;j++) dp[0][j]=j;
  for(let i=1;i<=al;i++){
    for(let j=1;j<=bl;j++){
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
      if(i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]){
        dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2] + 1);
      }
    }
  }
  return dp[al][bl];
}

// Fehlertolerant
export function isAcceptable(user, expected, alts = []){
  const nUser = normalize(user);
  const candidates = [expected, ...alts].map(normalize);
  if (candidates.includes(nUser)) return {ok:true, distance:0, matched:nUser};
  const distances = candidates.map(c => damerauLevenshtein(nUser, c));
  const best = Math.min(...distances);
  const len = Math.max(nUser.length, normalize(expected).length);
  const threshold = Math.max(1, Math.floor(len/8));
  return {ok: best <= threshold, distance: best, matched:null};
}

// CSV simple
export function parseCSV(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim().length);
  const header = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const parts = [];
    let cur = '', inQ = false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (ch === '"' ) { inQ = !inQ; continue; }
      if (ch === ',' && !inQ){ parts.push(cur); cur=''; }
      else cur += ch;
    }
    parts.push(cur);
    const obj = {};
    header.forEach((h, i) => obj[h] = (parts[i] ?? '').trim());
    return obj;
  });

  const data = rows.map(r => {
    const altsFr = (r.alts_fr || r.altsFR || '').split(/[\|;]+/).map(s=>s.trim()).filter(Boolean);
    const altsDe = (r.alts_de || r.altsDE || '').split(/[\|;]+/).map(s=>s.trim()).filter(Boolean);
    const tags = (r.tags || '').split(/[\|;]+/).map(s=>s.trim()).filter(Boolean);
    const tokens = (r.tokens_fr || '').split(/[\|;]+/).map(s=>s.trim()).filter(Boolean);
    const id = (r.id || normalize(r.fr).replace(/\s+/g,'_')).slice(0,64);
    return {
      id,
      de: r.de || '',
      fr: r.fr || '',
      alts: { fr: altsFr, de: altsDe },
      type: (r.type || 'word').toLowerCase().includes('sent') ? 'sentence' : 'word',
      tags,
      notes: r.notes || '',
      tokens_fr: tokens
    };
  });
  return data.filter(x => x.fr && x.de);
}
