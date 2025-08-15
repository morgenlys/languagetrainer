// srs.js – Spaced Repetition & Auswahl-Logik
import {shuffle, choice} from './utils.js';

const now = () => Date.now();

export function newProgressFor(items){
  const map = {};
  for (const it of items){
    map[it.id] = {
      id: it.id,
      seen: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      stage: 0,             // 0: neu; 1: MC reverse; 2+: frei
      ef: 2.5,              // SM-2 Easiness
      interval: 0,          // in Tagen
      due: 0,               // timestamp (ms)
      typingUnlocked: false,
      modeHistory: []
    };
  }
  return map;
}

export function mergeProgress(items, progress){
  const ids = new Set(items.map(i=>i.id));
  for (const id of Object.keys(progress)){
    if(!ids.has(id)) delete progress[id];
  }
  for (const it of items){
    if(!progress[it.id]) progress[it.id] = newProgressFor([it])[it.id];
  }
  return progress;
}

function scheduleNext(p, grade){ // grade: 0..5
  const dnow = now();
  if (grade >= 3){
    if (p.interval === 0) p.interval = 1;
    else if (p.interval === 1) p.interval = 3;
    else p.interval = Math.round(p.interval * p.ef);
    p.ef = Math.max(1.3, p.ef + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
    p.due = dnow + p.interval*24*60*60*1000;
  } else {
    p.interval = 0;
    p.due = dnow + 12*60*60*1000;
  }
}

export function updateAfterAnswer(p, wasCorrect, modeId){
  p.seen++;
  p.modeHistory.push({t: now(), mode: modeId, ok: wasCorrect});
  if (wasCorrect){ p.correct++; p.streak++; } else { p.wrong++; p.streak = 0; }
  if (wasCorrect){
    if (p.stage === 0) p.stage = 1;
    else if (p.stage === 1) { p.stage = 2; p.typingUnlocked = true; }
  } else {
    if (p.stage > 0) p.stage = Math.max(0, p.stage-1);
  }
  const grade = wasCorrect ? (p.streak >= 2 ? 5 : 4) : (p.streak === 0 ? 2 : 1);
  scheduleNext(p, grade);
}

export function selectNextItem(items, progress, {onlyDue, includeWords, includeSentences}){
  const pool = items.filter(it=>{
    if (it.type === 'word' && !includeWords) return false;
    if (it.type === 'sentence' && !includeSentences) return false;
    return true;
  });
  const scored = pool.map(it=>{
    const p = progress[it.id];
    const overdue = now() - (p.due || 0);
    const dueScore = overdue > 0 ? 3 : 0;
    const freshPenalty = p.seen < 2 ? 1 : 0;
    const recentWrong = p.modeHistory.slice(-3).some(h=>!h.ok) ? 2 : 0;
    let base = (onlyDue ? (overdue>0? 10:0) : (5 + dueScore + recentWrong - freshPenalty));
    if (p.seen === 0) base += 6;
    return {it, score: base};
  });
  let ticket = Math.random() * scored.reduce((acc,s)=>acc+s.score,0);
  for (const s of scored){
    ticket -= s.score;
    if (ticket <= 0) return s.it;
  }
  return choice(pool);
}

export function allowedModesFor(p){
  const modes = [];
  if (p.stage === 0){
    modes.push('mc_df');
  } else if (p.stage === 1){
    modes.push('mc_fd','mc_df');
  } else {
    modes.push('mc_df','mc_fd','input_df','match5','speech_mc','speech_input','sentence_build');
  }
  return modes;
}

export function distractorsFor(items, target, n=3, direction='df'){
  const key = direction === 'df' ? 'fr' : 'de';
  const pool = items.filter(x=>x.id !== target.id);
  const tagged = pool.filter(x => x.tags?.some(t => target.tags?.includes(t)));
  shuffle(tagged); shuffle(pool);
  const chosen = (tagged.concat(pool)).slice(0, n);
  return chosen.map(x => ({id:x.id, text:x[key]}));
}
