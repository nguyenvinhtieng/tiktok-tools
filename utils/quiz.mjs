export const POINTS = { A1:10, A2:20, B1:30, B2:40, C1:50, C2:70 };
const WEIGHTS = { A1:50, A2:30, B1:12, B2:5, C1:2, C2:1 };
export const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu,'').replace(/[đĐ]/g,'d').trim().toLowerCase().replace(/^[\s.!?,;:]+|[\s.!?,;:]+$/g, '').replace(/\s+/g,' ');
export function pickWord(words, previous='', band='mixed', random=Math.random) {
  const pool=words.filter(w => w.answer !== previous && (band==='mixed' || w.band===band));
  const bands=Object.keys(POINTS).filter(b => pool.some(w => w.band===b));
  let roll=random()*bands.reduce((n,b)=>n+WEIGHTS[b],0);
  const selected=bands.find(b => (roll-=WEIGHTS[b])<0) || bands.at(-1);
  const candidates=pool.filter(w=>w.band===selected);
  return candidates[Math.floor(random()*candidates.length)];
}
export function createGame() { return {players:Object.create(null), round:null, gifts:Object.create(null), deck:{remaining:null,cycle:0,last:''}}; }
export function drawWord(game, words, band='mixed', random=Math.random) {
  if (!words.length || !words.some(word => band==='mixed' || word.band===band)) return null;
  const deck=game.deck;
  const answers=new Set(words.map(word=>word.answer));
  if (deck.remaining) deck.remaining=deck.remaining.filter(answer=>answers.has(answer));
  if (!deck.remaining?.length) {
    deck.remaining=[...answers];
    deck.cycle++;
  }
  const remaining=new Set(deck.remaining);
  const eligible=words.filter(word=>remaining.has(word.answer) && (band==='mixed' || word.band===band));
  if (!eligible.length) return null;
  const alternatives=eligible.filter(word=>word.answer!==deck.last);
  const word=pickWord(alternatives.length ? alternatives : eligible, '', band, random);
  deck.remaining=deck.remaining.filter(answer=>answer!==word.answer);
  deck.last=word.answer;
  return word;
}
export function startRound(game, word, now=Date.now(), seconds=30, random=Math.random, mode='text', words=[]) {
  let choices=[];
  if(mode==='abcd') {
    const seen=new Set([normalize(word.answer),...(word.aliases || []).map(normalize)]);
    const candidates=words.filter(candidate=>{
      const answers=[candidate.answer,...(candidate.aliases || [])].map(normalize);
      if(answers.some(answer=>seen.has(answer)) || (word.vi && candidate.vi===word.vi)) return false;
      answers.forEach(answer=>seen.add(answer));
      return true;
    });
    for(let i=candidates.length-1;i>0;i--) {
      const j=Math.floor(random()*(i+1));
      [candidates[i],candidates[j]]=[candidates[j],candidates[i]];
    }
    if(candidates.length<3) throw new Error('Cần ít nhất 4 đáp án khác nhau cho chế độ ABCD.');
    choices=[word,...candidates.slice(0,3)];
    for(let i=choices.length-1;i>0;i--) {
      const j=Math.floor(random()*(i+1));
      [choices[i],choices[j]]=[choices[j],choices[i]];
    }
  }
  const letters=Array.from(word.answer).flatMap((letter,index)=>/\p{L}/u.test(letter) ? [index] : []);
  const candidates=letters.slice(1);
  game.round={word, mode, choices, startedAt:now, deadline:now+seconds*1000, seconds, answered:[], results:[], settled:false, revealed:false,
    hintLetters:[letters[0],candidates[Math.floor(random()*candidates.length)]].filter(index=>index!==undefined)};
}
export function roundHint(round, now=Date.now()) {
  const elapsed=now-(round.deadline-round.seconds*1000);
  const divisor=elapsed>=12000 ? 3 : elapsed>=8000 ? 2 : 1;
  const visible=new Set((round.hintLetters || []).slice(0,divisor-1));
  const text=Array.from(round.word.answer).map((letter,index)=>
    /\s/u.test(letter) ? '/' : /\p{L}/u.test(letter) && !visible.has(index) ? '_' : letter).join(' ');
  return {text:round.mode==='abcd' ? '' : text,divisor,points:Math.floor(POINTS[round.word.band]/divisor)};
}
function identity(data) {
  const user=data.user || data;
  const pictures=[user.profilePictureUrl,user.avatarThumb,user.avatarMedium,user.avatarLarger,user.avatar];
  const avatar=pictures.flatMap(value=>typeof value==='string' ? [value] : value?.urlList || value?.url_list || []).find(url=>typeof url==='string' && /^https:\/\//i.test(url)) || '';
  return {id:String(user.userId || user.id || user.uniqueId || ''),name:user.nickname || user.uniqueId || '',avatar};
}
function player(game, user) {
  const p=game.players[user.id] ||= {id:user.id,name:user.name || 'Người chơi',avatar:'',score:0,correct:0,giftScore:0};
  if(user.name) p.name=user.name;
  if(user.avatar) p.avatar=user.avatar;
  return p;
}
export function acceptChat(game, data, now=Date.now(), defer=false, receivedBeforeReveal=false) {
  const round=game.round, user=identity(data);
  if (!user.id || !round || !Number.isFinite(now) || now<(round.startedAt ?? round.deadline-round.seconds*1000) ||
      round.settled || (round.revealed && !(defer && receivedBeforeReveal && now<round.closedAt)) ||
      now>=round.deadline || round.answered.includes(user.id)) return 0;
  const comment=normalize(data.comment);
  if(round.mode==='abcd') {
    const key=String(data.comment || '').toLowerCase();
    if(!/^[abcd]$/.test(key) || round.choices?.[key.charCodeAt(0)-97]?.answer!==round.word.answer) return 0;
  } else if (![round.word.answer,...(round.word.aliases || [])].some(a=>normalize(a) && comment.includes(normalize(a)))) return 0;
  const points=roundHint(round,now).points;
  if(defer) {
    (round.results ||= []).push({...user,points,time:now,elapsed:Math.max(0,now-(round.deadline-round.seconds*1000))});
    round.answered.push(user.id);
    return points;
  }
  const p=player(game,user);
  p.score+=points; p.correct++; round.answered.push(user.id); return points;
}
export function settleRound(game) {
  const round=game.round;
  if(!round?.revealed || round.settled) return [];
  const results=[...(round.results || [])].sort((a,b)=>a.time-b.time);
  for(const result of results) {
    const p=player(game,result);
    p.score+=result.points; p.correct++;
  }
  round.settled=true;
  return results;
}
// Connector gift metadata uses diamondCount for the gift cost; keep it as a
// compatibility field while exposing the value as coins throughout the game.
export function giftCoins(data) {
  return Number(data.coinCount ?? data.gift?.coinCount ?? data.giftDetails?.coinCount ??
    data.diamondCount ?? data.gift?.diamondCount ?? data.giftDetails?.diamondCount ?? 0);
}
export function acceptGift(game,data,multiplier=10) {
  const user=identity(data), details=data.giftDetails || data.gift || {};
  const coins=giftCoins(data), count=Number(data.repeatCount ?? 1);
  if (!user.id || !Number.isSafeInteger(coins) || coins<=0 || !Number.isSafeInteger(count) || count<=0 || !Number.isSafeInteger(multiplier) || multiplier<=0) return 0;
  const group=data.groupId && String(data.groupId)!=='0' ? String(data.groupId) : '';
  // Without a stable event/streak identifier, do not guess and double-credit gifts.
  const key=group ? `${user.id}:${data.giftId || details.id}:${group}` : (data.msgId || data.common?.msgId) ? `${user.id}:msg:${data.msgId || data.common.msgId}` : '';
  if (!key) return 0;
  const total=coins*count*multiplier;
  if(!Number.isSafeInteger(total)) return 0;
  const points=Math.max(0,total-(game.gifts[key] || 0)); game.gifts[key]=Math.max(total,game.gifts[key] || 0);
  if (!points) return 0;
  const p=player(game,user); p.score+=points; p.giftScore+=points; return points;
}

export const STORAGE_KEY = 'tiktok-english-quiz-v1';
export function saveGame(storage, game) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(game)); return true; }
  catch { return false; }
}
export function restoreGame(storage) {
  try {
    const saved=JSON.parse(storage.getItem(STORAGE_KEY));
    if (!saved || typeof saved.players!=='object' || !saved.players || Array.isArray(saved.players) ||
        typeof saved.gifts!=='object' || !saved.gifts || Array.isArray(saved.gifts) ||
        !saved.deck || !(saved.deck.remaining===null || Array.isArray(saved.deck.remaining)) ||
        !Number.isSafeInteger(saved.deck.cycle) || typeof saved.deck.last!=='string' ||
        Object.values(saved.players).some(p=>!p || typeof p.id!=='string' || typeof p.name!=='string' ||
          !['score','correct','giftScore'].every(k=>Number.isSafeInteger(p[k]) && p[k]>=0)) ||
        Object.values(saved.gifts).some(n=>!Number.isSafeInteger(n) || n<0)) return createGame();
    const game=createGame();
    Object.assign(game.players,saved.players); Object.assign(game.gifts,saved.gifts);
    game.deck=saved.deck;
    if (saved.round?.word && typeof saved.round.word.answer==='string' && Array.isArray(saved.round.answered))
      game.round={...saved.round,revealed:true};
    settleRound(game);
    return game;
  } catch { return createGame(); }
}
