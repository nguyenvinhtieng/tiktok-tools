<script setup>
import { parseLiveUrl } from '../server/utils/live.mjs';
import { WORDS, SOURCES, VOCABULARY } from '../utils/quiz-words.mjs';
import { shoutoutSeconds, shoutoutText, createBrowserShoutout } from '../utils/quiz-shoutout.mjs';
import { POINTS, createGame, startRound, roundHint, drawWord, acceptChat, settleRound, acceptGift, giftCoins, saveGame, restoreGame } from '../utils/quiz.mjs';
const soundEnabled=ref(true), soundBusy=ref(false), soundError=ref(''), musicVolume=ref(25), effectsVolume=ref(35);
let audio;
const speechEnabled=ref(true), speechBusy=ref(false), speechError=ref(''), speechVolume=ref(100);
const questionReadAt=ref(0);
// Browser voices avoid waiting for generated audio.
const shoutVoice=ref('browser'), announcing=ref(false), shoutout=ref(null), browserVietnamese=ref(true);
let shoutoutTimer, shoutoutVoiceTimer, browserShout;
function duck() { audio?.setSpeechActive(speechBusy.value || announcing.value); }
function getBrowserShout() {
  browserShout ||= createBrowserShoutout({onState:busy=>{announcing.value=busy; duck();}});
  browserVietnamese.value=browserShout.hasVietnamese();
  return browserShout;
}
function stopShoutout(hide=true) {
  if(shoutoutVoiceTimer) { clearTimeout(shoutoutVoiceTimer); shoutoutVoiceTimer=undefined; }
  browserShout?.stop(); speech?.stopAnnounce?.();
  if(!hide) return;
  if(shoutoutTimer) { clearTimeout(shoutoutTimer); shoutoutTimer=undefined; }
  shoutout.value=null;
}
function celebrateFastest(result) {
  stopShoutout();
  const id=`${round.value.deadline}-${result.id}`;
  shoutout.value={id,name:result.name || 'Người chơi',avatar:result.avatar,seconds:shoutoutSeconds(result.elapsed),points:result.points,bonus:result.bonus || 0};
  shoutoutTimer=setTimeout(()=>{ if(shoutout.value?.id===id) shoutout.value=null; },5500);
  audio?.cue('fastest');
  if(!speechEnabled.value || shoutVoice.value==='off') return;
  // Let the sparkle land before the voice; audio keeps loading during the wait.
  const delay=soundEnabled.value ? 300 : 0;
  const useBrowser=shoutVoice.value==='browser' && getBrowserShout().available();
  if(!useBrowser) { speech?.announce(result.name,result.elapsed,{delay}); return; }
  shoutoutVoiceTimer=setTimeout(()=>{
    if(shoutout.value?.id===id && !round.value?.revealed) browserShout.speak(shoutoutText(result.name,result.elapsed),speechVolume.value/100);
  },delay);
}
let speech, speechStarting=false, speechReadVersion=0, speechClockRound;
function updateSpeechVolume() { speech?.setVolume(speechVolume.value/100); }
function finishQuestionRead() {
  if(questionReadAt.value && speechClockRound===round.value && !round.value.revealed) round.value.deadline+=Date.now()-questionReadAt.value;
  questionReadAt.value=0; speechClockRound=undefined;
}
async function readRound() {
  if(!speechEnabled.value || !speech || !round.value) return;
  finishQuestionRead();
  const version=++speechReadVersion;
  if(!round.value.revealed) { questionReadAt.value=Date.now(); speechClockRound=round.value; }
  speechError.value='';
  try { return await speech.speak(round.value.word.answer,round.value.revealed); }
  finally { if(version===speechReadVersion) finishQuestionRead(); }
}
async function toggleSpeech(force=false) {
  if(speechStarting) return;
  if(speechEnabled.value && force!==true) { speechEnabled.value=false; stopShoutout(false); speech?.stop(); return; }
  speechStarting=true; speechError.value='';
  try {
    if(!speech) {
      const {createBrowserQuizSpeech}=await import('../utils/quiz-browser-speech.mjs');
      speech=createBrowserQuizSpeech({onState:busy=>{speechBusy.value=busy; duck();},onAnnounce:busy=>{announcing.value=busy; duck();},onError:message=>{speechError.value=message;}});
    }
    updateSpeechVolume(); await speech.start(); speechEnabled.value=true;
    speech.prefetchShoutout(); getBrowserShout();
    readRound(); prepareSpeech();
  } catch(e) { speechError.value=e.message || 'Không bật được giọng đọc.'; }
  finally { speechStarting=false; }
}
function updateAudioLevels() { audio?.setLevels(musicVolume.value/100,effectsVolume.value/100); }
async function toggleAudio(force=false) {
  if(soundBusy.value) return;
  if(soundEnabled.value && force!==true) { audio?.stop(); soundEnabled.value=false; return; }
  soundBusy.value=true; soundError.value='';
  try {
    if(!audio) { const {createQuizAudio}=await import('../utils/quiz-audio.mjs'); audio=createQuizAudio(); }
    updateAudioLevels(); audio.setSpeechActive(speechBusy.value || announcing.value); audio.setPhase(audioPhase.value); audio.setTension(1-timeRatio.value);
    await audio.start(); soundEnabled.value=true;
  } catch(e) { soundError.value=e.message || 'Không bật được âm thanh. Hãy thử lại.'; }
  finally { soundBusy.value=false; }
}
const url=ref(''), status=ref('Chưa kết nối'), error=ref(''), active=ref(false), connected=ref(false);
const game=ref(createGame()), band=ref('mixed'), seconds=ref(30), giftRate=ref(10), auto=ref(true), running=ref(false);
const mode=ref('text');
const choiceMode=computed(()=>(round.value?.mode || mode.value)==='abcd');
const now=ref(Date.now()), screen=ref(null), fullscreen=ref(false), pinned=ref(false), giftNotice=ref(null);
const answerPreview=ref(false), rankChanges=ref({}), failedAvatars=ref({});
// Only what the stage shows is kept: the comment box has no scroll-back, so 10 rows are enough;
// other LIVE events (join, like, follow…) keep just the latest one.
const MAX_COMMENTS=10;
const interactionActivity=ref([]), lastEvent=ref(null);
let pendingActivity=[], activityFrame, persistTimer;
function clearPendingActivity() {
  if(activityFrame!==undefined && typeof cancelAnimationFrame==='function') cancelAnimationFrame(activityFrame);
  activityFrame=undefined; pendingActivity=[];
}
function displayActivity(item) {
  // Scoring has already run. Only the visual feed is batched and bounded.
  if(typeof requestAnimationFrame!=='function') {
    interactionActivity.value=[...interactionActivity.value.slice(1-MAX_COMMENTS),item];
    return;
  }
  pendingActivity.push(item);
  if(pendingActivity.length>MAX_COMMENTS) pendingActivity.shift();
  if(activityFrame!==undefined) return;
  activityFrame=requestAnimationFrame(()=>{
    interactionActivity.value=[...interactionActivity.value,...pendingActivity].slice(-MAX_COMMENTS);
    pendingActivity=[]; activityFrame=undefined;
  });
}
const interactionRows=ref(null);
const resultsOpen=ref(false), scoreAwards=ref({});
let awardAt=0, awardsUntil=0;
watch(interactionActivity,()=>{
  const rows=interactionRows.value;
  if(rows) rows.scrollTop=rows.scrollHeight;
},{flush:'post'});
let feedId=0, rankTimer;
const loadPrevious=ref(false);
let source, timer, nextAt=0, sessionStarted=false;
function persist() {
  if(!sessionStarted) return;
  try { if(saveGame(window.localStorage,game.value)) return; } catch {}
  error.value='Không lưu được tiến trình trên trình duyệt. Hãy kiểm tra quyền lưu trữ hoặc dung lượng trống.';
}
function schedulePersist() {
  if(persistTimer!==undefined) return;
  persistTimer=setTimeout(()=>{ persistTimer=undefined; persist(); },250);
}
const round=computed(()=>game.value.round);
let preparedNext;
function prepareSpeech() {
  if(!speechEnabled.value || !speech || !round.value) return;
  speech.prefetch(round.value.word.answer,true);
  const deckKey=JSON.stringify(game.value.deck);
  if(!preparedNext || preparedNext.game!==game.value || preparedNext.band!==band.value || preparedNext.deckKey!==deckKey) {
    const preview={deck:{...game.value.deck,remaining:game.value.deck.remaining?.slice() ?? null}};
    const word=drawWord(preview,WORDS,band.value);
    preparedNext={game:game.value,band:band.value,deckKey,word,deck:preview.deck};
  }
  if(preparedNext.word) speech.prefetch(preparedNext.word.answer,false);
}
watch(band,()=>{ preparedNext=undefined; prepareSpeech(); });
const bandCounts=computed(()=>Object.fromEntries(Object.keys(POINTS).map(b=>[b, WORDS.filter(w=>w.band===b).length])));
const remainingMs=computed(()=>round.value && !round.value.revealed ? Math.min(round.value.seconds*1000,Math.max(0,round.value.deadline-(questionReadAt.value || now.value))) : 0);
const remaining=computed(()=>Math.ceil(remainingMs.value/1000));
const timeRatio=computed(()=>round.value ? remainingMs.value/(round.value.seconds*1000) : 0);
const ranking=computed(()=>Object.values(game.value.players).sort((a,b)=>b.score-a.score || b.correct-a.correct || a.id.localeCompare(b.id)));
const hint=computed(()=>round.value ? roundHint(round.value,questionReadAt.value || now.value) : null);
const roundResults=computed(()=>[...(round.value?.results || [])].sort((a,b)=>a.time-b.time));
const correctIndex=computed(()=>round.value?.choices?.findIndex(choice=>choice.answer===round.value.word.answer) ?? -1);
watch(remaining,(value,previous)=>{
  if(running.value && !round.value?.revealed && !questionReadAt.value && value>0 && value<=5 && value!==previous) audio?.cue('tick',value);
});
const audioPhase=computed(()=>{
  if(!round.value) return 'lobby';
  if(!round.value.revealed) return questionReadAt.value ? 'reading' : 'countdown';
  return resultsOpen.value ? 'results' : 'break';
});
watch(audioPhase,phase=>audio?.setPhase(phase));
watch(timeRatio,ratio=>audio?.setTension(1-ratio));
const RING=2*Math.PI*44;
const CONFETTI=Array.from({length:36},(_,i)=>({id:i,style:{left:`${(i*53)%100}%`,animationDelay:`${(i*137%900)/1000}s`,animationDuration:`${2.4+(i%5)*.4}s`,background:['#ffd60a','#fe2c55','#25f4ee','#2bd576','#ffffff'][i%5],'--r':`${i*47%360}deg`}}));
const hintWords=computed(()=>{
  if(!round.value) return [];
  if(round.value.revealed) return round.value.word.answer.split(/\s+/).map(word=>Array.from(word));
  return hint.value.text.split(' / ').map(word=>word.split(' '));
});
const pointSteps=computed(()=>{
  if(!round.value) return [];
  const base=POINTS[round.value.word.band], current=round.value.revealed ? 4 : hint.value.divisor;
  return [[1,'0–8 giây'],[2,'8–12 giây'],[3,'sau 12 giây']].map(([divisor,label])=>({divisor,label,points:Math.floor(base/divisor),state:divisor<current ? 'past' : divisor===current ? 'now' : 'next'}));
});
const initialOf=name=>(name || '?').trim().slice(0,1).toUpperCase() || '?';
watch(()=>ranking.value.map(p=>p.id),(ids,previous=[])=>{
  const changes={};
  ids.forEach((id,index)=>{ const old=previous.indexOf(id); if(old>=0 && old!==index) changes[id]=old-index; });
  rankChanges.value=changes;
  clearTimeout(rankTimer); rankTimer=setTimeout(()=>{ rankChanges.value={}; },1800);
});
function toggleAnswerPreview() { answerPreview.value=!answerPreview.value; }
function notice(text) { giftNotice.value={id:++feedId,text}; }
function avatarOf(user) {
  return [user.profilePictureUrl,user.avatarThumb?.urlList?.[0],user.avatarThumb?.url_list?.[0]].find(url=>typeof url==='string' && /^https:\/\//i.test(url)) || '';
}
function recordActivity(type,data,points=0) {
  const user=data.user || data, name=user.nickname || user.uniqueId || 'Người xem';
  const labels={member:'tham gia LIVE',like:'thích LIVE',follow:'theo dõi',share:'chia sẻ LIVE',connected:'Đã kết nối LIVE',disconnected:'Đã ngắt kết nối',streamEnd:'LIVE đã kết thúc',connectionError:'Kết nối gặp lỗi'};
  const gift=`tặng ${data.gift?.name || data.giftDetails?.giftName || data.giftName || 'quà'} ×${data.repeatCount || 1}`;
  const text=type==='chat' ? `${name}: ${data.comment || ''}`
    : type==='gift' ? `${name} ${gift}`
    : labels[type] ? (['member','like','follow','share'].includes(type) ? `${name} ${labels[type]}` : labels[type]) : '';
  if(!text) return;
  const body=type==='chat' ? (points>0 ? 'đã trả lời đúng!' : data.comment || '') : type==='gift' ? gift : text;
  const item={id:++feedId,text,type,name,body,avatar:avatarOf(user),correct:points>0};
  if(type!=='chat' && type!=='gift') { lastEvent.value=item; return; }
  displayActivity(item);
}
function startQuiz() {
  resultsOpen.value=false; awardAt=0; awardsUntil=0; scoreAwards.value={};
  let initial=createGame();
  if(loadPrevious.value) {
    try { initial=restoreGame(window.localStorage); } catch {}
  }
  preparedNext=undefined; game.value=initial; giftNotice.value=null; answerPreview.value=false; failedAvatars.value={};
  sessionStarted=true;
  next();
  persist();
}
function next() {
  if(resultsOpen.value || awardsUntil>Date.now()) return;
  if(running.value && round.value && !round.value.revealed) { reveal(); return; }
  const reserved=preparedNext;
  preparedNext=undefined;
  const useReserved=reserved && reserved.game===game.value && reserved.band===band.value && reserved.deckKey===JSON.stringify(game.value.deck);
  const word=useReserved ? reserved.word : drawWord(game.value,WORDS,band.value);
  if(useReserved && word) game.value.deck=reserved.deck;
  if(!word) { stop(); error.value='Band này đã hết từ trong lượt hiện tại. Chọn band khác hoặc Ngẫu nhiên để tiếp tục; bộ từ chỉ reset khi đã rút hết tất cả.'; return; }
  stopShoutout(); error.value=''; answerPreview.value=false; now.value=Date.now(); nextAt=0;
  startRound(game.value,word,now.value,seconds.value,Math.random,mode.value,WORDS);
  running.value=true; audio?.cue('question'); readRound(); prepareSpeech();
}
function reveal(readAnswer=true) {
  if(!round.value || round.value.revealed) return;
  stopShoutout(); round.value.closedAt=Date.now(); round.value.revealed=true; resultsOpen.value=true; audio?.cue('reveal',round.value.answered.length>0);
  awardAt=Date.now()+5000; nextAt=0;
  if(readAnswer) readRound();
}
function finishResults() {
  if(!resultsOpen.value) return;
  const results=settleRound(game.value);
  if(results.length) audio?.cue('winner');
  scoreAwards.value=Object.fromEntries(results.map(item=>[item.id,item.points]));
  resultsOpen.value=false; awardAt=0; awardsUntil=Date.now()+1800;
  nextAt=awardsUntil;
  persist();
}
function stop(readAnswer=true) { reveal(readAnswer); running.value=false; nextAt=0; }
function updateFastestBonus() {
  const results=round.value.results;
  const fastest=results.reduce((first,result)=>!first || result.time<first.time ? result : first,null);
  // Reassign if an earlier receipt was delayed; never compound or duplicate a bonus.
  for(const result of results) {
    const base=result.points-(result.bonus || 0);
    result.bonus=result===fastest ? Math.floor(base*.5) : 0;
    result.points=base+result.bonus;
  }
  return fastest;
}
function disconnect() { clearPendingActivity(); source?.close(); source=undefined; active.value=false; connected.value=false; status.value='Đã ngắt kết nối'; }
function connect() {
  error.value='';
  try { parseLiveUrl(url.value); } catch(e) { error.value=e.message; return; }
  disconnect(); interactionActivity.value=[]; lastEvent.value=null; active.value=true; status.value='Đang kết nối…';
  const current=new EventSource(`/api/live?url=${encodeURIComponent(url.value.trim())}`); source=current;
  let serverClockOffset;
  current.addEventListener('live',message=>{
    if(source!==current) return;
    try {
      const event=JSON.parse(message.data), data=event.data || {};
      const processedAt=Date.now(), serverReceivedAt=Date.parse(event.receivedAt);
      // Calibrate once on connected; do not mistake a busy browser's queue delay for clock skew.
      if(event.type==='connected' && Number.isFinite(serverReceivedAt)) serverClockOffset=processedAt-serverReceivedAt;
      const hasReceipt=serverClockOffset!==undefined && Number.isFinite(serverReceivedAt);
      const receivedAt=hasReceipt ? Math.min(processedAt,serverReceivedAt+serverClockOffset) : processedAt;
      const answerAt=questionReadAt.value && !round.value?.revealed ? Math.min(receivedAt,questionReadAt.value) : receivedAt;
      let points=event.type==='chat' && running.value ? acceptChat(game.value,data,answerAt,true,hasReceipt) : 0;
      if(points>0) {
        const fastest=updateFastestBonus(), result=round.value.results.at(-1);
        points=result.points;
        if(result===fastest) { try { celebrateFastest(result); } catch {} }
        else audio?.cue('correct');
      }
      recordActivity(event.type,data,points);
      if(event.type==='chat' && speechEnabled.value && shoutVoice.value==='edge') speech?.warmName?.((data.user || data).nickname || (data.user || data).uniqueId);
      if(event.type==='connected') { connected.value=true; status.value='Đang nhận comment & quà'; }
      if(event.type==='gift' && sessionStarted) {
        const points=acceptGift(game.value,data,giftRate.value);
        if(points) notice(`${(data.user || data).nickname || 'Người chơi'} tặng ${data.gift?.name || data.giftDetails?.giftName || data.giftName || 'quà'} +${points}`);
        else if(!Number.isSafeInteger(giftCoins(data)) || giftCoins(data)<=0) notice('Quà thiếu giá trị xu — chưa cộng điểm.');
      }
      if(['disconnected','streamEnd','connectionError'].includes(event.type)) { disconnect(); if(event.type==='connectionError') error.value=data.message || 'Không kết nối được LIVE.'; }
    } catch { error.value='Không đọc được sự kiện LIVE.'; }
  });
  current.onerror=()=>{ if(source!==current) return; disconnect(); error.value='Kết nối gián đoạn. Kiểm tra LIVE rồi kết nối lại.'; };
}
async function toggleFullscreen() {
  if(pinned.value) { pinned.value=false; return; }
  try {
    if(document.fullscreenElement) await document.exitFullscreen();
    else if(screen.value.requestFullscreen) await screen.value.requestFullscreen();
    else pinned.value=true;
  } catch { pinned.value=true; }
}
function syncFullscreen() { fullscreen.value=document.fullscreenElement===screen.value; }
function reset() { if(!window.confirm('Xóa toàn bộ điểm và bắt đầu phiên mới?')) return; preparedNext=undefined; disconnect(); stop(false); stopShoutout(); speech?.stop(); finishQuestionRead(); resultsOpen.value=false; awardAt=0; awardsUntil=0; scoreAwards.value={}; sessionStarted=true; loadPrevious.value=false; game.value=createGame(); giftNotice.value=null; answerPreview.value=false; failedAvatars.value={}; }
function activateDefaultAudio() {
  if(soundEnabled.value) void toggleAudio(true);
  if(speechEnabled.value) void toggleSpeech(true);
  document.removeEventListener('pointerdown',activateDefaultAudio);
  document.removeEventListener('keydown',activateDefaultAudio);
}
onMounted(()=>{
  document.addEventListener('pointerdown',activateDefaultAudio);
  document.addEventListener('keydown',activateDefaultAudio);
  if(typeof window!=='undefined') window.addEventListener?.('pagehide',persist);
  watch(game,schedulePersist,{deep:true,flush:'post'});
  document.addEventListener('fullscreenchange',syncFullscreen);
  timer=setInterval(()=>{
    now.value=Date.now();
    if(awardAt && now.value>=awardAt && !speechBusy.value) finishResults();
    if(awardsUntil && now.value>=awardsUntil) { scoreAwards.value={}; awardsUntil=0; }
    if(!running.value || !round.value) return;
    if(!round.value.revealed && !questionReadAt.value && now.value>=round.value.deadline) reveal();
    if(round.value.revealed && auto.value && nextAt && now.value>=nextAt) next();
  },50);
});
onBeforeUnmount(()=>{ document.removeEventListener('pointerdown',activateDefaultAudio); document.removeEventListener('keydown',activateDefaultAudio); window.removeEventListener?.('pagehide',persist); stopShoutout(); audio?.dispose(); disconnect(); speech?.dispose(); finishResults(); persist(); clearTimeout(persistTimer); clearInterval(timer); clearTimeout(rankTimer); document.removeEventListener('fullscreenchange',syncFullscreen); });
</script>

<template>
  <div class="english-quiz">
    <div class="console">
      <section class="console-card connect-card">
        <h3>Kết nối LIVE</h3>
        <form class="connection" @submit.prevent="connect">
          <label for="quiz-url" class="sr-only">Link TikTok LIVE</label>
          <div class="input-row"><span class="link-icon">↗</span><input id="quiz-url" v-model="url" type="url" required placeholder="https://www.tiktok.com/@username/live" :disabled="active"><button class="primary" :disabled="active">Kết nối</button><button v-if="active" type="button" class="secondary" @click="disconnect">Ngắt kết nối</button></div>
        </form>
        <p role="status" class="conn-status" :class="{online:connected}"><span class="dot" aria-hidden="true"/>{{ status }}<small>Điểm được giữ khi kết nối lại. Đổi phòng hãy tạo phiên mới.</small></p>
      </section>
      <section class="console-card">
        <h3>Cài đặt câu hỏi</h3>
        <div class="settings">
          <label>Chế độ chơi <select v-model="mode" :disabled="running || resultsOpen || Object.keys(scoreAwards).length>0"><option value="text">Trả lời từ tiếng Anh</option><option value="abcd">Chọn A/B/C/D</option></select></label>
          <label>Band <select v-model="band"><option value="mixed">Ngẫu nhiên · ưu tiên A2–C1</option><option v-for="b in Object.keys(POINTS)" :key="b" :value="b" :disabled="!bandCounts[b]">{{ b }} · {{ bandCounts[b] }} từ</option></select></label>
          <label>Thời gian <select v-model.number="seconds"><option :value="15">15 giây</option><option :value="30">30 giây</option><option :value="45">45 giây</option><option :value="60">60 giây</option></select></label>
          <label>Điểm / xu quà <select v-model.number="giftRate" :disabled="active"><option v-for="n in [1,5,10]" :key="n" :value="n">{{ n }}</option></select></label>
        </div>
        <label class="check"><input v-model="auto" type="checkbox"> Tự chuyển câu sau khi cộng điểm</label>
        <label class="check"><input v-model="loadPrevious" type="checkbox" :disabled="running"> Dùng lại dữ liệu phiên trước</label>
      </section>
      <section class="console-card">
        <h3>Điều khiển</h3>
        <div class="controls"><button type="button" class="secondary" :disabled="soundBusy" :aria-pressed="soundEnabled" @click="toggleAudio">{{ soundBusy ? 'Đang bật…' : soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh' }}</button></div>
        <div class="settings">
          <label>Nhạc nền · {{ musicVolume }}% <input v-model.number="musicVolume" type="range" min="0" max="100" aria-label="Âm lượng nhạc nền" @input="updateAudioLevels"></label>
          <label>Hiệu ứng · {{ effectsVolume }}% <input v-model.number="effectsVolume" type="range" min="0" max="100" aria-label="Âm lượng hiệu ứng" @input="updateAudioLevels"></label>
        </div>
        <p class="conn-status">Nhạc game show · hồi hộp và dồn dập dần khi đếm giờ, tự hạ nhỏ khi đang đọc. Bấm bật một lần trước khi live.</p>
        <p v-if="soundError" role="alert" class="error">{{ soundError }}</p>
        <div class="controls"><button type="button" class="secondary" :aria-pressed="speechEnabled" @click="toggleSpeech">{{ speechEnabled ? 'Tắt giọng đọc' : 'Bật giọng đọc' }}</button><button type="button" class="secondary" :disabled="!speechEnabled || !round || speechBusy" @click="readRound">Nghe lại {{ round?.revealed ? 'đáp án' : 'câu hỏi' }}</button></div>
        <div class="settings"><label>Giọng đọc · {{ speechVolume }}% <input v-model.number="speechVolume" type="range" min="0" max="100" aria-label="Âm lượng giọng đọc" @input="updateSpeechVolume"></label><label>Khen người nhanh nhất <select v-model="shoutVoice"><option value="browser">Giọng trình duyệt · tức thì</option><option value="off">Chỉ popup, không đọc</option></select></label></div>
        <p v-if="shoutVoice==='browser' && speechEnabled && !browserVietnamese" class="conn-status">Trình duyệt chưa có giọng tiếng Việt, tên có thể đọc sai. Hãy cài thêm giọng tiếng Việt trong hệ điều hành.</p>
        <p class="conn-status" role="status">{{ speechBusy ? (round?.revealed ? 'Đang chuẩn bị / đọc đáp án…' : 'Đang chuẩn bị / đọc câu hỏi · chưa tính giờ trả lời.') : 'Đọc câu hỏi tiếng Việt; đáp án phát âm tiếng Anh và đọc nghĩa. Dùng giọng trình duyệt, ưu tiên giọng có sẵn trên máy.' }}</p>
        <p v-if="speechError" role="alert" class="error">{{ speechError }}</p>
        <p v-if="!connected" class="conn-status">Có thể chạy quiz khi chưa kết nối LIVE. Kết nối để nhận bình luận và quà tặng.</p>
        <div class="controls"><button class="primary" :disabled="running || resultsOpen || Object.keys(scoreAwards).length>0" @click="startQuiz">Bắt đầu Quiz</button><button class="secondary" :disabled="!running" @click="stop">Dừng</button><button class="secondary" @click="reset">Phiên mới</button></div>
        <div class="controls admin-tools"><button class="secondary" :disabled="!round" :aria-expanded="answerPreview" @click="toggleAnswerPreview">{{ answerPreview ? 'Ẩn đáp án' : 'Xem đáp án' }}</button><button class="secondary" :disabled="!running || resultsOpen || Object.keys(scoreAwards).length>0" @click="next">Câu tiếp →</button></div>
        <p v-if="answerPreview && round" class="admin-answer">Đáp án (chỉ host thấy): <strong>{{ round.word.answer }}</strong></p>
      </section>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>

    <section ref="screen" class="arena" :class="{full:fullscreen || pinned,pinned}" @keydown.esc="pinned=false">
      <div class="stage-top">
        <div class="show-title"><span class="live-tag" :class="{on:connected}">LIVE</span><strong>Đoán từ tiếng Anh</strong></div>
        <ol class="how-to">
          <li><b>1</b>Đọc nghĩa tiếng Việt</li>
          <li><b>2</b>{{ choiceMode ? 'Comment A, B, C hoặc D' : 'Comment từ tiếng Anh' }}</li>
          <li><b>3</b>Càng nhanh càng nhiều điểm</li>
        </ol>
        <button type="button" class="fs-btn" :aria-label="fullscreen || pinned ? 'Thu nhỏ' : 'Toàn màn hình'" @click="toggleFullscreen">{{ fullscreen || pinned ? 'Thu nhỏ' : 'Toàn màn hình' }}</button>
      </div>

      <div class="play-grid">
        <div class="question" :class="{done:round?.revealed}">
          <template v-if="round">
            <div class="q-top">
              <div class="level"><span>Level</span><strong>{{ round.word.band }}</strong></div>
              <ol class="point-ladder" aria-label="Điểm theo thời gian">
                <li v-for="step in pointSteps" :key="step.divisor" :class="step.state"><strong>+{{ step.points }}</strong><small>{{ step.label }}</small></li>
              </ol>
              <div class="timer" :class="{urgent:!round.revealed && remaining<=5}" role="progressbar" aria-label="Thời gian còn lại" :aria-valuenow="remaining" :aria-valuemax="round.seconds" :aria-valuemin="0" :aria-valuetext="`${remaining} giây`">
                <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="timer-bg" r="44" cx="50" cy="50"/><circle class="timer-fg" r="44" cx="50" cy="50" :style="{strokeDasharray:RING,strokeDashoffset:RING*(1-timeRatio)}"/></svg>
                <strong :key="remaining">{{ remaining }}</strong>
              </div>
            </div>
            <div class="question-text-slot" tabindex="0" aria-label="Nghĩa tiếng Việt">
              <p class="prompt-label">Từ tiếng Anh của</p>
              <Transition name="question" mode="out-in"><h3 :key="round.deadline">{{ round.word.vi }}</h3></Transition>
            </div>
            <div v-if="round.mode==='abcd'" class="answer-choices" :class="{revealed:round.revealed}" aria-label="Các lựa chọn">
              <div v-for="(choice,index) in round.choices" :key="`${round.deadline}-${choice.answer}`" class="answer-choice" :class="[`choice-${'abcd'[index]}`,{correct:round.revealed && index===correctIndex,wrong:round.revealed && index!==correctIndex}]" :style="{animationDelay:`${index*.07}s`}">
                <b class="choice-key">{{ 'ABCD'[index] }}</b>
                <span class="choice-text">{{ choice.answer }}</span>
                <span v-if="round.revealed && index===correctIndex" class="choice-check" aria-label="Đáp án đúng"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7"/></svg></span>
              </div>
            </div>
            <div v-else class="answer-slot" tabindex="0" :aria-label="round.revealed ? `Đáp án: ${round.word.answer}` : `Gợi ý: ${hint.text}`">
              <div class="letters" :style="{'--n':Math.max(...hintWords.map(word=>word.length))}">
                <span v-for="(word,w) in hintWords" :key="`${round.deadline}-${w}`" class="letter-word">
                  <span v-for="(letter,i) in word" :key="`${i}-${letter}`" class="letter-tile" :class="{revealed:letter!=='_'}" :style="round.revealed ? {animationDelay:`${(w*4+i)*.04}s`} : null">{{ letter==='_' ? '' : letter }}</span>
                </span>
              </div>
            </div>
            <div class="q-foot">
              <span v-if="round.mode!=='abcd'" class="q-meta">{{ hintWords.length }} từ · {{ round.word.answer.replace(/\s/g,'').length }} chữ cái</span>
              <span v-if="round.mode==='abcd'" class="q-meta">Comment đúng một chữ A, B, C hoặc D</span>
              <span :key="round.answered.length" class="solved-count" :class="{some:round.answered.length}">{{ round.answered.length }} người<span class="wide-only"> đã đoán</span> đúng</span>
            </div>
          </template>
          <div v-else class="lobby">
            <p class="lobby-kicker">Mini game trên LIVE</p>
            <h3>Đoán từ<br>tiếng Anh</h3>
            <div v-if="choiceMode" class="lobby-demo" aria-label="Ví dụ: quả táo, comment B nếu B là apple">
              <span class="demo-vi">“quả táo”</span>
              <span class="demo-arrow" aria-hidden="true">→</span>
              <span class="demo-keys"><i class="choice-a">A</i><i class="choice-b pick">B</i><i class="choice-c">C</i><i class="choice-d">D</i></span>
            </div>
            <div v-else class="lobby-demo" aria-label="Ví dụ: quả táo, comment apple">
              <span class="demo-vi">“quả táo”</span>
              <span class="demo-arrow" aria-hidden="true">→</span>
              <span class="demo-tiles"><i>a</i><i>p</i><i>p</i><i>l</i><i>e</i></span>
            </div>
            <p class="lobby-note">Host sắp bắt đầu. Chuẩn bị comment nhé!</p>
          </div>
          <Transition name="shoutout">
            <div v-if="shoutout && round && !round.revealed" :key="shoutout.id" class="shoutout" role="status" aria-live="polite">
              <span class="shout-avatar">
                <img v-if="shoutout.avatar && failedAvatars[shoutout.id]!==shoutout.avatar" :src="shoutout.avatar" alt="" referrerpolicy="no-referrer" @error="failedAvatars[shoutout.id]=shoutout.avatar">
                <span v-else>{{ initialOf(shoutout.name) }}</span>
                <i class="bolt" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg></i>
              </span>
              <span class="shout-body"><small>Nhanh nhất! · Bonus +{{ shoutout.bonus }}</small><strong>{{ shoutout.name }}</strong><span>trả lời đúng trong <b>{{ shoutout.seconds }}</b> giây</span></span>
              <b class="shout-points">+{{ shoutout.points }}</b>
            </div>
          </Transition>
          <p class="comment-cta"><span class="bubble" aria-hidden="true"/>Comment<span class="wide-only"> đáp án</span> <em>{{ choiceMode ? 'A, B, C hoặc D' : 'tiếng Anh' }}</em><span class="cta-tail"> để ghi điểm</span></p>
        </div>

        <div class="side">
          <aside class="leaderboard">
            <div class="lb-head"><h3>Bảng xếp hạng</h3><span>{{ ranking.length }} người chơi</span></div>
            <TransitionGroup v-if="ranking.length" name="rank" tag="ol">
              <li v-for="(p,i) in ranking.slice(0,10)" :key="p.id" :class="{'rank-up':rankChanges[p.id]>0,'rank-down':rankChanges[p.id]<0,'podium':i<3,'gold':i===0,'silver':i===1,'bronze':i===2}">
                <span class="rank">{{ i+1 }}</span>
                <span class="avatar">
                  <svg v-if="i===0" class="crown" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 0 3l6 4 6-7 6 7 6-4-2 11z"/></svg>
                  <img v-if="p.avatar && failedAvatars[p.id]!==p.avatar" :src="p.avatar" alt="" referrerpolicy="no-referrer" @error="failedAvatars[p.id]=p.avatar">
                  <span v-else>{{ initialOf(p.name) }}</span>
                </span>
                <div class="player-name"><strong>{{ p.name }}</strong><small v-if="rankChanges[p.id]" class="rank-change" :aria-label="`${rankChanges[p.id]>0 ? 'Tăng' : 'Giảm'} ${Math.abs(rankChanges[p.id])} hạng`">{{ rankChanges[p.id]>0 ? '▲' : '▼' }} {{ Math.abs(rankChanges[p.id]) }}</small><small v-else-if="p.correct">{{ p.correct }} câu đúng</small></div>
                <Transition name="score" mode="out-in"><b :key="p.score">{{ p.score }}</b></Transition>
                <span v-if="scoreAwards[p.id]" :key="`award-${round.deadline}-${p.id}`" class="score-award">+{{ scoreAwards[p.id] }}</span>
              </li>
            </TransitionGroup>
            <div v-else class="waiting">
              <div class="podium-ghost" aria-hidden="true"><span>2</span><span>1</span><span>3</span></div>
              <h4>Bảng đang trống</h4>
              <p>Ai trả lời đúng đầu tiên sẽ đứng hạng 1.</p>
            </div>
          </aside>
          <div class="gift-strip" aria-live="polite">
            <div v-if="giftNotice" class="ticker"><Transition name="feed"><p :key="giftNotice.id"><span class="gift-icon" aria-hidden="true"/>{{ giftNotice.text }}</p></Transition></div>
            <p v-else class="gift-tip"><span class="gift-icon" aria-hidden="true"/><span class="wide-only">Tặng quà để cộng điểm · </span>1 xu quà = {{ giftRate }} điểm</p>
          </div>
          <section class="live-activity">
            <div class="activity-heading"><span>Bình luận</span><span class="conn" :class="{online:connected}">{{ connected ? 'Đang kết nối' : 'Chưa kết nối' }}</span></div>
            <div ref="interactionRows" class="activity-rows">
              <p v-if="!interactionActivity.length" class="activity-empty">Bình luận và quà sẽ hiện ở đây…</p>
              <p v-for="item in interactionActivity" :key="item.id" class="chat-row" :class="[item.type,{correct:item.correct}]" :title="item.body">
                <span class="chat-avatar"><img v-if="item.avatar && !failedAvatars[`chat-${item.id}`]" :src="item.avatar" alt="" referrerpolicy="no-referrer" @error="failedAvatars[`chat-${item.id}`]=true"><span v-else>{{ initialOf(item.name) }}</span></span>
                <span class="chat-text"><b>{{ item.name }}</b> {{ item.body }}</span>
              </p>
            </div>
          </section>
        </div>
      </div>

      <Transition name="results">
        <div v-if="resultsOpen" class="results-overlay">
          <div class="burst" aria-hidden="true"/>
          <div v-if="roundResults.length" class="confetti" aria-hidden="true"><i v-for="c in CONFETTI" :key="c.id" :style="c.style"/></div>
          <section class="round-results" role="dialog" aria-modal="true" aria-labelledby="round-results-title" tabindex="0">
            <p class="stamp">Hết giờ!</p>
            <p id="round-results-title" class="result-label">Đáp án là<b v-if="round.mode==='abcd' && correctIndex>=0" class="result-key" :class="`choice-${'abcd'[correctIndex]}`">{{ 'ABCD'[correctIndex] }}</b></p>
            <p class="result-answer" :aria-label="round.word.answer"><span v-for="(ch,i) in Array.from(round.word.answer)" :key="i" :class="{gap:ch===' '}" :style="{animationDelay:`${.35+i*.05}s`}" aria-hidden="true">{{ ch }}</span></p>
            <p class="result-meaning">{{ round.word.vi }}</p>
            <ol v-if="roundResults.length" class="result-list">
              <li v-for="(item,i) in roundResults.slice(0,8)" :key="item.id" :class="{first:i===0}" :style="{animationDelay:`${.7+i*.09}s`}">
                <span class="pos">{{ i+1 }}</span>
                <span class="avatar"><img v-if="item.avatar && failedAvatars[item.id]!==item.avatar" :src="item.avatar" alt="" referrerpolicy="no-referrer" @error="failedAvatars[item.id]=item.avatar"><span v-else>{{ initialOf(item.name) }}</span></span>
                <strong>{{ item.name || 'Người chơi' }}<small v-if="i===0" class="fastest">Nhanh nhất<span v-if="item.bonus"> · Bonus +{{ item.bonus }}</span></small></strong>
                <time>{{ (item.elapsed/1000).toLocaleString('vi-VN',{maximumFractionDigits:1}) }}s</time>
                <b>+{{ item.points }}</b>
              </li>
            </ol>
            <p v-if="roundResults.length>8" class="result-more">và {{ roundResults.length-8 }} người khác cũng đúng</p>
            <div v-if="!roundResults.length" class="no-winner"><strong>Chưa ai đoán ra!</strong><span>Câu tiếp theo là cơ hội của bạn.</span></div>
            <div class="result-timer" aria-hidden="true"><span :style="{animationPlayState:speechBusy ? 'paused' : 'running'}"/></div>
            <p class="result-footer"><span v-if="roundResults.length" class="wide-only">{{ roundResults.length }} người trả lời đúng · </span>{{ speechBusy ? 'Đang đọc đáp án…' : `Cộng điểm sau ${Math.max(0,Math.ceil((awardAt-now)/1000))} giây` }}</p>
          </section>
        </div>
      </Transition>
    </section>

    <details class="sources"><summary>Luật chơi & nguồn từ vựng · {{ WORDS.length }} từ</summary><p>Mỗi người được điểm một lần mỗi câu, tất cả đáp án đúng trong thời gian đều được tính. Bình luận chỉ cần chứa đáp án hoặc cách viết thay thế, không phân biệt hoa/thường và dấu. Hết giờ hiện đáp án và danh sách trả lời đúng theo thời gian trong 5 giây, sau đó cộng điểm và cập nhật bảng xếp hạng trước khi chuyển câu. Điểm và tiến trình được lưu tự động trên trình duyệt này. Mặc định bắt đầu với điểm và bộ từ mới. Tick “Dùng lại dữ liệu phiên trước” trước khi bắt đầu để khôi phục điểm và tiến trình đã lưu. Phiên mới sẽ xóa điểm đã lưu.</p><p>Quà = giá trị xu của quà × số lượng × điểm/xu. Mặc định 1 xu = 10 điểm, bằng điểm gốc một câu A1 đúng. Chuỗi quà chỉ cộng phần tăng thêm. Quà thiếu giá trị xu hoặc mã nhận diện sẽ không được cộng.</p><p>Từ và nghĩa Việt lấy từ PDF được cung cấp: {{ VOCABULARY.sourceRows }} mục, gộp còn {{ WORDS.length }} từ/cụm từ duy nhất. Level A1–C2 do Quiz ước lượng, không phải chứng nhận CEFR của Oxford. Rút ngẫu nhiên không hoàn lại, ưu tiên A2–C1 khi còn từ. Khi rút hết toàn bộ, tự nạp lại bộ từ cho lượt mới. Đổi band hoặc kết nối lại không xóa lịch sử rút; Phiên mới sẽ reset toàn bộ.</p><a v-for="s in SOURCES" :key="s.url" :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.name }} ↗</a></details>
  </div>
</template>

<style scoped>
/* Host console: follows the site theme. */
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.console{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}
.console-card{min-width:0;padding:18px 20px;border:1px solid #e1e3d8;border-radius:12px;background:#fafaf6}
.connect-card{grid-column:1/-1}
.console-card h3{margin:0 0 14px;font-size:15px;font-weight:700;letter-spacing:-.2px}
.conn-status{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:12px 0 0;font-size:13px;font-weight:600;color:#6c7062}
.conn-status small{width:100%;font-size:12px;font-weight:400;color:#8a8e80}
.conn-status .dot{width:8px;height:8px;border-radius:50%;background:#b9bcae}
.conn-status.online{color:#4d6b22}.conn-status.online .dot{background:#6fa52b;box-shadow:0 0 0 4px #6fa52b26}
.settings{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
.settings label{display:flex;flex-direction:column;gap:6px;margin:0;font-size:12px;color:#6d7362}
select{width:100%;padding:10px;border:1px solid #d9dccf;border-radius:8px;font:inherit;font-size:13px;background:#fff;color:#26331e}
.check{display:flex;align-items:center;gap:8px;margin:8px 0 0;font-size:13px;font-weight:500}
.check input{margin:0;accent-color:#52702f}
.controls{display:flex;flex-wrap:wrap;gap:8px}
.controls .primary{padding:12px 18px}
.admin-tools{margin-top:12px;padding-top:12px;border-top:1px dashed #dcdfd2}
.admin-answer{margin:10px 0 0;font-size:13px;color:#527c26}
button:disabled{opacity:.45;cursor:not-allowed}
.sources{margin-top:20px;font-size:12px;line-height:1.9;color:#75816a}.sources summary{cursor:pointer}.sources a{display:inline-block;margin-right:18px;text-decoration:underline}

/* Stage: its own show look, independent of the site theme. */
.arena{--ink:#15131f;--stage:#141225;--panel:#1d1a33;--row:#27233f;--line:#2e2a4b;--muted:#a19dc0;--cyan:#25f4ee;--pink:#fe2c55;--yellow:#ffd60a;--green:#2bd576;--paper:#fffaf0;--tile-bg:#efe8d6;
  position:relative;display:flex;flex-direction:column;gap:16px;padding:20px;border-radius:20px;overflow:hidden;color:#fff;
  background-color:var(--stage);background-image:radial-gradient(#ffffff0f 1px,transparent 1px);background-size:22px 22px}
.arena::backdrop{background:#141225}
.arena.full{width:100vw;height:100dvh;border-radius:0;padding:clamp(14px,2vw,28px)}
.arena.pinned{position:fixed;inset:0;z-index:1000;padding-top:max(clamp(14px,2vw,28px),env(safe-area-inset-top));padding-bottom:max(clamp(14px,2vw,28px),env(safe-area-inset-bottom))}

.stage-top{display:flex;align-items:center;gap:12px 20px;flex-wrap:wrap}
.show-title{display:flex;align-items:center;gap:12px}
.show-title strong{font-size:clamp(20px,2vw,30px);font-weight:800;letter-spacing:-.6px}
.live-tag{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;background:#3a3654;color:#cfcbe6;font-size:12px;font-weight:800;letter-spacing:.6px}
.live-tag::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
.live-tag.on{background:var(--pink);color:#fff}.live-tag.on::before{animation:blink 1.4s infinite}
.how-to{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 0 auto;padding:0;list-style:none}
.how-to li{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 5px;border:1px solid var(--line);border-radius:999px;background:var(--panel);font-size:13px;font-weight:600;color:#e7e4f7}
.how-to b{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--cyan);color:var(--ink);font-size:12px}
.how-to li:nth-child(2) b{background:var(--pink);color:#fff}.how-to li:nth-child(3) b{background:var(--yellow)}
.fs-btn{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--muted);font-size:12px;font-weight:600}
.fs-btn:hover{color:#fff;border-color:#5a5480}
.arena.full .fs-btn{position:absolute;top:10px;right:10px;z-index:30;background:var(--stage);opacity:0;transition:opacity .2s}.arena.full .fs-btn:hover,.arena.full .fs-btn:focus-visible{opacity:1}

.play-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:18px;min-height:0}
.arena.full .play-grid{flex:1}

/* Question card */
.question{position:relative;display:flex;flex-direction:column;min-width:0;min-height:600px;padding:22px 26px 0;border:3px solid #000;border-radius:20px;background:var(--paper);color:var(--ink);box-shadow:0 8px 0 #000;overflow:hidden}
.arena.full .question{min-height:0}
.q-top{display:flex;align-items:center;gap:14px}
.level{flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;width:66px;height:66px;border-radius:14px;background:var(--ink);color:#fff}
.level span{font-size:10px;font-weight:600;text-transform:uppercase;color:#bdb8d9}
.level strong{font-size:25px;font-weight:800;line-height:1.05}
.point-ladder{flex:1;display:flex;gap:6px;min-width:0;margin:0;padding:0;list-style:none}
.point-ladder li{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 4px;border:2px dashed #d6cfbb;border-radius:12px;color:#8a8370;transition:transform .3s,background-color .3s}
.point-ladder strong{font-size:22px;font-weight:800;line-height:1.1}
.point-ladder small{font-size:11px;font-weight:600;white-space:nowrap}
.point-ladder .now{border:2px solid #000;background:var(--yellow);color:var(--ink);box-shadow:0 4px 0 #000;transform:translateY(-2px);animation:step-in .45s cubic-bezier(.2,1.6,.4,1)}
.point-ladder .past{border-style:solid;opacity:.45}
.point-ladder .past strong{text-decoration:line-through;text-decoration-thickness:3px;text-decoration-color:var(--pink)}
.timer{position:relative;flex-shrink:0;display:grid;place-items:center;width:86px;height:86px}
.timer svg{position:absolute;inset:0;transform:rotate(-90deg)}
.timer circle{fill:none;stroke-width:9}
.timer-bg{stroke:#ece5d3}
.timer-fg{stroke:#14b8a6;stroke-linecap:round;transition:stroke-dashoffset 50ms linear,stroke .3s}
.timer strong{font-size:32px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-1px}
.timer.urgent .timer-fg{stroke:var(--pink)}
.timer.urgent strong{color:var(--pink);animation:tick .5s ease-out}
.prompt-label{margin:0;text-align:center;font-size:14px;font-weight:700;color:#8a8370}
.question-text-slot{flex:1 1 0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-height:0;padding-bottom:18px;text-align:center}
.question h3{margin:6px 0 0;font-size:clamp(34px,4.4vw,64px);font-weight:800;line-height:1.12;letter-spacing:-1.5px;overflow-wrap:anywhere}
.choice-a{--c:var(--pink);--on:#fff}.choice-b{--c:var(--cyan);--on:var(--ink)}.choice-c{--c:var(--yellow);--on:var(--ink)}.choice-d{--c:#8b5cf6;--on:#fff}
.answer-choices{flex:1 0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(76px,auto);align-content:start;gap:14px;padding:4px 4px 12px}
.answer-choice{position:relative;display:flex;align-items:center;gap:14px;min-width:0;padding:12px 18px 12px 12px;border:3px solid #000;border-radius:16px;background:var(--c);color:var(--on);box-shadow:0 5px 0 #000;animation:choice-in .45s cubic-bezier(.2,1.4,.4,1) both;transition:opacity .35s,filter .35s,transform .35s}
.choice-key{flex-shrink:0;display:grid;place-items:center;width:48px;height:48px;border:2px solid #000;border-radius:12px;background:#fff;color:var(--ink);font-size:26px;font-weight:800}
.choice-text{flex:1;min-width:0;font-size:clamp(18px,2.2vw,32px);font-weight:800;line-height:1.15;letter-spacing:-.5px;overflow-wrap:anywhere}
.answer-choice.wrong{animation:none;opacity:.3;filter:grayscale(1);transform:scale(.95)}
.answer-choice.correct{z-index:1;outline:4px solid var(--green);outline-offset:3px;animation:choice-win .7s cubic-bezier(.2,1.6,.4,1) both}
.choice-check{position:absolute;top:-16px;right:-12px;display:grid;place-items:center;width:40px;height:40px;border:3px solid #000;border-radius:50%;background:var(--green);animation:check-pop .5s .25s cubic-bezier(.2,1.8,.4,1) both}
.choice-check svg{width:22px;fill:none;stroke:var(--ink);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}
.demo-keys{display:flex;gap:6px}
.demo-keys i{display:grid;place-items:center;width:38px;height:38px;border:2px solid #000;border-radius:10px;background:var(--c);color:var(--on);font-style:normal;font-size:20px;font-weight:800;opacity:.35}
.demo-keys i.pick{opacity:1;box-shadow:0 4px 0 #000;outline:3px solid var(--green);outline-offset:2px;animation:choice-win .7s .3s cubic-bezier(.2,1.6,.4,1) both}
.result-key{display:inline-grid;place-items:center;width:30px;height:30px;margin-left:8px;border:2px solid #000;border-radius:8px;background:var(--c);color:var(--on);font-size:17px;font-weight:800;vertical-align:middle;animation:check-pop .5s .3s cubic-bezier(.2,1.8,.4,1) both}
.arena.full .answer-choices{grid-auto-rows:minmax(min(13vh,120px),auto)}
.arena.full .choice-text{font-size:clamp(20px,min(2.6vw,4.8vh),48px)}
.arena.full .choice-key{width:min(64px,7vh);height:min(64px,7vh);font-size:min(34px,3.8vh)}
@keyframes choice-in{0%{opacity:0;transform:translateY(18px) scale(.92)}100%{opacity:1;transform:none}}
@keyframes choice-win{0%{transform:scale(1)}45%{transform:scale(1.08) rotate(-1.5deg)}100%{transform:scale(1.03)}}
@keyframes check-pop{0%{opacity:0;transform:scale(0) rotate(-60deg)}100%{opacity:1;transform:none}}
@media (max-width:520px){.answer-choices{gap:10px}.answer-choice{gap:8px;padding:10px}.choice-key{width:36px;height:36px;font-size:20px}}
.answer-slot{flex:1 0 auto;display:grid;place-items:start center;min-height:0;overflow:auto;container-type:inline-size}
.letters{--max:52px;--tile:min(var(--max),calc((100cqw - (var(--n) - 1) * 6px) / var(--n)));display:flex;flex-wrap:wrap;justify-content:center;gap:12px 24px;padding:4px 0 14px}
.letter-word{display:flex;justify-content:center;gap:6px}
.letter-tile{display:grid;place-items:center;width:var(--tile);aspect-ratio:5/6;border:2px solid #d9cfb5;border-bottom-width:5px;border-radius:10px;background:var(--tile-bg);font-size:calc(var(--tile) * .62);font-weight:800;text-transform:uppercase;color:var(--ink)}
.letter-tile.revealed{border-color:#000;background:var(--yellow);animation:tile-flip .55s cubic-bezier(.2,1.4,.4,1) both}
.question.done .letter-tile{background:var(--green)}
.q-foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;padding:10px 0 14px;font-size:14px;font-weight:600;color:#7d7665}
.solved-count{display:inline-flex;align-items:center;gap:8px}
.solved-count::before{content:'';width:8px;height:8px;border-radius:50%;background:#c9c1ab}
.solved-count.some{color:#0f8a4a;animation:bump .45s cubic-bezier(.2,1.6,.4,1)}
.solved-count.some::before{background:var(--green);box-shadow:0 0 0 4px #2bd57633}
.comment-cta{display:flex;align-items:center;justify-content:center;gap:10px;margin:auto -26px 0;padding:14px 16px;background:var(--ink);color:#fff;font-size:clamp(15px,1.5vw,20px);font-weight:800;text-align:center}
.comment-cta em{font-style:normal;color:var(--yellow)}
.bubble{position:relative;flex-shrink:0;width:22px;height:17px;border-radius:6px;background:var(--cyan);animation:nudge 2.4s ease-in-out infinite}
.bubble::after{content:'';position:absolute;left:4px;bottom:-5px;border:5px solid transparent;border-top-color:var(--cyan);border-left-color:var(--cyan)}

/* Waiting screen */
.lobby{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px 0;text-align:center}
.lobby-kicker{margin:0;padding:6px 12px;border-radius:999px;background:var(--ink);color:#fff;font-size:13px;font-weight:700}
.lobby h3{margin:0;font-size:clamp(46px,6vw,88px);line-height:1;letter-spacing:-3px}
.lobby-demo{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:14px;margin-top:10px;padding:16px 20px;border:2px dashed #d6cfbb;border-radius:16px}
.demo-vi{font-size:22px;font-weight:700}
.demo-arrow{font-size:26px;font-weight:800;color:var(--pink);animation:nudge 1.6s ease-in-out infinite}
.demo-tiles{display:flex;gap:4px}
.demo-tiles i{display:grid;place-items:center;width:34px;height:42px;border:2px solid #000;border-bottom-width:4px;border-radius:8px;background:var(--yellow);font-size:22px;font-style:normal;font-weight:800;text-transform:uppercase;animation:tile-flip .5s cubic-bezier(.2,1.4,.4,1) both}
.demo-tiles i:nth-child(2){animation-delay:.08s}.demo-tiles i:nth-child(3){animation-delay:.16s}.demo-tiles i:nth-child(4){animation-delay:.24s}.demo-tiles i:nth-child(5){animation-delay:.32s}
.lobby-note{margin:4px 0 0;font-size:15px;font-weight:600;color:#7d7665}

/* Side column */
.side{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0}
.leaderboard{flex:1;display:flex;flex-direction:column;min-height:0;padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}
.lb-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.lb-head h3{margin:0;font-size:20px;font-weight:800;letter-spacing:-.4px}
.lb-head span{font-size:12px;color:var(--muted)}
.leaderboard ol{position:relative;display:flex;flex-direction:column;gap:6px;min-height:0;margin:14px 0 0;padding:4px 2px 2px;overflow:auto;list-style:none;scrollbar-width:none}
.leaderboard li{position:relative;display:grid;grid-template-columns:24px 40px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 12px 8px 8px;border-radius:12px;background:var(--row);outline:3px solid transparent;transition:outline-color .6s}
.rank{font-size:15px;font-weight:800;text-align:center;color:var(--muted);font-variant-numeric:tabular-nums}
.avatar{position:relative;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#3a3560;color:#fff;font-weight:800}
.avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.crown{position:absolute;top:-12px;left:50%;width:22px;fill:var(--yellow);stroke:#000;stroke-width:1.5;transform:translateX(-50%) rotate(-10deg);animation:crown 2.6s ease-in-out infinite}
.player-name{min-width:0}
.player-name strong{display:block;overflow:hidden;font-size:15px;font-weight:700;white-space:nowrap;text-overflow:ellipsis}
.player-name small{display:block;margin-top:2px;font-size:11px;color:var(--muted)}
.leaderboard li>b{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
.leaderboard li.podium{border:2px solid #000;box-shadow:0 4px 0 #000;color:var(--ink)}
.leaderboard li.podium .rank,.leaderboard li.podium small{color:#3b3627}
.leaderboard li.podium .avatar{border:2px solid #000;background:#fff;color:var(--ink)}
.leaderboard li.gold{grid-template-columns:24px 50px minmax(0,1fr) auto;padding:14px 14px 12px 8px;margin-top:6px;background:var(--yellow)}
.leaderboard li.gold .avatar{width:50px;height:50px}
.leaderboard li.gold>b{font-size:26px}
.leaderboard li.silver{background:#dde2ee}
.leaderboard li.bronze{background:#f4ad74}
.leaderboard li.rank-up{outline-color:var(--green)}
.leaderboard li.rank-down{outline-color:#fe2c5599}
.rank-change{font-weight:800}
.rank-up .rank-change{color:var(--green)!important}.rank-up.podium .rank-change{color:#0f7a40!important}
.rank-down .rank-change{color:var(--pink)!important}
.score-award{position:absolute;right:8px;top:-10px;z-index:2;padding:2px 9px;border:2px solid #000;border-radius:999px;background:var(--green);color:var(--ink);font-size:16px;font-weight:800;pointer-events:none;animation:award-rise 1.8s ease-out both}
.waiting{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px;text-align:center}
.podium-ghost{display:flex;align-items:flex-end;gap:6px;margin-bottom:10px}
.podium-ghost span{display:grid;place-items:start center;width:46px;padding-top:6px;border:2px dashed #4a4470;border-bottom:0;border-radius:8px 8px 0 0;color:#6f6a96;font-weight:800}
.podium-ghost span:nth-child(1){height:44px}.podium-ghost span:nth-child(2){height:64px;border-color:var(--yellow);color:var(--yellow)}.podium-ghost span:nth-child(3){height:32px}
.waiting h4{margin:0;font-size:20px;font-weight:800}
.waiting p{margin:0;font-size:13px;color:var(--muted)}

.gift-strip{position:relative;flex:0 0 auto;min-height:44px;border-radius:12px;background:#ffd60a17;border:1px solid #ffd60a40;overflow:hidden}
.gift-strip p{display:flex;align-items:center;gap:10px;margin:0;padding:11px 14px;font-size:13px;font-weight:700;color:var(--yellow);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gift-strip .gift-tip{color:#d8c88a;font-weight:600}
.ticker{position:relative}
.gift-icon{position:relative;flex-shrink:0;width:16px;height:13px;margin-top:3px;border-radius:2px;background:var(--yellow)}
.gift-icon::before{content:'';position:absolute;left:-2px;right:-2px;top:-4px;height:5px;border-radius:2px;background:var(--yellow)}
.gift-icon::after{content:'';position:absolute;left:7px;top:-4px;bottom:0;width:2px;background:var(--stage)}

.live-activity{flex:0 0 210px;display:flex;flex-direction:column;min-height:0;padding:12px 12px 6px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}
.activity-heading{display:flex;justify-content:space-between;gap:10px;margin:0 4px 8px;font-size:13px;font-weight:700}
.conn{font-size:11px;font-weight:600;color:var(--muted)}.conn.online{color:var(--green)}
.activity-rows{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overflow-anchor:none;scrollbar-width:none;-webkit-mask-image:linear-gradient(transparent,#000 22px)}
.activity-rows::-webkit-scrollbar{display:none}
.activity-empty{margin:24px 0;text-align:center;font-size:13px;color:var(--muted)}
.chat-row{display:flex;align-items:flex-start;gap:8px;margin:0 0 6px;padding:6px 10px 6px 6px;border:1px solid transparent;border-radius:14px;background:#ffffff0d;font-size:14px;line-height:1.35;animation:chat-in .3s ease-out}
.chat-avatar{flex-shrink:0;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#3a3560;font-size:12px;font-weight:800;overflow:hidden}
.chat-avatar img{width:100%;height:100%;object-fit:cover}
.chat-text{min-width:0;padding-top:3px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#e9e6f7}
.chat-text b{margin-right:2px;color:var(--cyan);font-weight:700}
.chat-row.gift{background:#ffd60a1c}.chat-row.gift b{color:var(--yellow)}
.chat-row.correct{border-color:#2bd57680;background:#2bd57622}
.chat-row.correct .chat-text{color:var(--green);font-weight:700}.chat-row.correct b{color:var(--green)}

/* Round results popup */
.results-overlay{position:absolute;inset:0;z-index:20;display:grid;place-items:center;padding:28px 20px 20px;overflow:hidden;background:#0b0a16d9;backdrop-filter:blur(6px)}
.burst{position:absolute;left:50%;top:50%;width:160vmax;height:160vmax;margin:-80vmax 0 0 -80vmax;background:repeating-conic-gradient(#ffd60a12 0 9deg,transparent 9deg 18deg);animation:spin 30s linear infinite;pointer-events:none}
.confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.confetti i{position:absolute;top:-6%;width:10px;height:16px;border-radius:2px;animation-name:confetti-fall;animation-timing-function:linear;animation-fill-mode:both}
.round-results{position:relative;display:flex;flex-direction:column;width:min(620px,100%);max-height:100%;padding:34px 26px 20px;border:3px solid #000;border-radius:24px;background:var(--paper);color:var(--ink);box-shadow:0 10px 0 #000;text-align:center;animation:card-pop .6s cubic-bezier(.2,1.5,.4,1) both}
.stamp{position:absolute;top:-24px;left:50%;margin:0;padding:8px 22px;border:3px solid #000;border-radius:12px;background:var(--pink);color:#fff;font-size:22px;font-weight:800;text-transform:uppercase;white-space:nowrap;transform:translateX(-50%) rotate(-4deg);animation:stamp .5s .15s cubic-bezier(.2,1.6,.4,1) both}
.result-label{margin:6px 0 2px;font-size:14px;font-weight:700;color:#8a8370}
.result-answer{display:flex;flex-wrap:wrap;justify-content:center;margin:0;font-size:clamp(36px,5vw,62px);font-weight:800;line-height:1.15;letter-spacing:-1px;color:#0f8a4a;perspective:600px;overflow-wrap:anywhere}
.result-answer span{display:inline-block;animation:letter-flip .5s cubic-bezier(.2,1.4,.4,1) both}
.result-answer .gap{width:.3em}
.result-meaning{margin:4px 0 16px;font-size:16px;color:#5f5948}
.result-list{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:0;margin:0;padding:4px 2px;overflow:auto;list-style:none;text-align:left}
.result-list li{display:grid;grid-template-columns:22px 36px minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:7px 12px 7px 8px;border-radius:12px;background:#f1ead8;animation:row-in .45s cubic-bezier(.2,1.2,.4,1) both}
.result-list .pos{font-weight:800;text-align:center;color:#8a8370}
.result-list .avatar{width:36px;height:36px;background:#fff;color:var(--ink);border:2px solid #000}
.result-list strong{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;font-size:15px;white-space:nowrap;text-overflow:ellipsis}
.fastest{flex-shrink:0;padding:2px 8px;border-radius:999px;background:var(--ink);color:var(--yellow);font-size:11px;font-weight:700}
.result-list time{font-size:13px;color:#7d7665;font-variant-numeric:tabular-nums}
.result-list b{font-size:18px;font-weight:800;color:#0f8a4a;font-variant-numeric:tabular-nums}
.result-list li.first{border:2px solid #000;background:var(--yellow);box-shadow:0 3px 0 #000}
.result-list li.first .pos,.result-list li.first time{color:var(--ink)}
.result-list li.first b{color:var(--ink);font-size:22px}
.result-more{margin:8px 0 0;font-size:13px;font-weight:600;color:#7d7665}
.no-winner{display:flex;flex-direction:column;gap:4px;padding:18px;border-radius:14px;background:#f1ead8;animation:shake .5s .6s both}
.no-winner strong{font-size:24px}
.no-winner span{font-size:14px;color:#6f6857}
.result-timer{height:8px;margin-top:16px;border-radius:99px;background:#ece5d3;overflow:hidden}
.result-timer span{display:block;height:100%;background:var(--ink);transform-origin:left;animation:drain 5s linear both}
.result-footer{margin:8px 0 0;font-size:13px;color:#7d7665}

/* Transitions */
.results-enter-active{animation:fade .25s ease-out}
.results-leave-active{transition:opacity .3s}.results-leave-to{opacity:0}
.question-enter-active{animation:q-in .45s cubic-bezier(.2,1.3,.4,1)}
.question-leave-active{transition:opacity .2s,transform .2s}.question-leave-to{opacity:0;transform:translateY(-14px)}
.rank-move{transition:transform .75s cubic-bezier(.22,1,.36,1)}
.rank-enter-active{animation:row-in .45s cubic-bezier(.2,1.2,.4,1)}
.rank-leave-active{position:absolute!important;width:100%;transition:opacity .3s}.rank-leave-to{opacity:0}
.score-enter-active{animation:score-pop .45s ease-out}
.score-leave-active{transition:opacity .12s}.score-leave-to{opacity:0}
.feed-enter-active{animation:feed-in .4s cubic-bezier(.2,1.4,.4,1)}
.feed-leave-active{position:absolute;inset:0;transition:opacity .2s,transform .2s}.feed-leave-to{opacity:0;transform:translateY(-100%)}

@keyframes blink{50%{opacity:.25}}
@keyframes nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(4px)}}
@keyframes step-in{0%{transform:scale(.8)}100%{transform:translateY(-2px)}}
@keyframes tick{0%{transform:scale(1.45)}100%{transform:scale(1)}}
@keyframes tile-flip{0%{opacity:0;transform:rotateX(90deg) scale(.8)}100%{opacity:1;transform:none}}
@keyframes bump{0%{transform:scale(1.25)}100%{transform:none}}
@keyframes crown{0%,100%{transform:translateX(-50%) rotate(-10deg)}50%{transform:translateX(-50%) translateY(-3px) rotate(6deg)}}
@keyframes award-rise{0%{opacity:0;transform:translateY(14px) scale(.6)}20%{opacity:1;transform:translateY(0) scale(1.2)}70%{opacity:1;transform:translateY(-4px) scale(1)}100%{opacity:0;transform:translateY(-22px)}}
@keyframes chat-in{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes confetti-fall{0%{top:-6%;transform:rotate(var(--r)) translateX(0)}50%{transform:rotate(calc(var(--r) + 270deg)) translateX(24px)}100%{top:106%;transform:rotate(calc(var(--r) + 540deg)) translateX(-12px)}}
@keyframes card-pop{0%{opacity:0;transform:scale(.6) translateY(30px)}100%{opacity:1;transform:none}}
@keyframes stamp{0%{opacity:0;transform:translateX(-50%) scale(2.2) rotate(-14deg)}100%{opacity:1;transform:translateX(-50%) scale(1) rotate(-4deg)}}
@keyframes letter-flip{0%{opacity:0;transform:rotateX(-90deg) translateY(10px)}100%{opacity:1;transform:none}}
@keyframes row-in{0%{opacity:0;transform:translateX(40px)}100%{opacity:1;transform:none}}
@keyframes shake{0%,100%{transform:none}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
@keyframes drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@keyframes fade{from{opacity:0}}
@keyframes q-in{0%{opacity:0;transform:translateY(24px) scale(.96)}100%{opacity:1;transform:none}}
@keyframes score-pop{0%{transform:scale(1.5);color:var(--green)}100%{transform:none}}
@keyframes feed-in{0%{opacity:0;transform:translateY(100%)}100%{opacity:1;transform:none}}

/* Fullscreen fits one screen; big type for viewers on phones. */
.arena.full .question h3{font-size:clamp(34px,min(5vw,8vh),92px)}
.arena.full .letters{--max:min(76px,8vh)}
.arena.full .live-activity{flex-basis:clamp(150px,26vh,280px)}
@media (orientation:portrait){
  .arena.full .how-to{width:100%;margin:0}
  .arena.full .play-grid{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.5fr) minmax(0,1fr)}
  .arena.full .lb-head h3,.arena.full .lb-head span{white-space:nowrap}
  .arena.full .leaderboard{padding:12px}
  .arena.full .leaderboard li.gold{grid-template-columns:24px 40px minmax(0,1fr) auto;padding:10px 12px 10px 8px}
  .arena.full .leaderboard li.gold .avatar{width:40px;height:40px}
  .arena.full .side{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .arena.full .leaderboard{grid-row:1/3}
  .arena.full .live-activity{min-height:0}
  .arena.full .question h3{font-size:clamp(30px,8vw,72px)}
  .arena.full .letters{--max:min(64px,6vh)}
}
@media (max-width:1000px){
  .arena:not(.full) .play-grid{grid-template-columns:minmax(0,1fr)}
  .arena:not(.full) .leaderboard ol{max-height:380px}
  .question{min-height:520px}
  .how-to{width:100%;margin:0}
}
@media (max-width:700px){
  .console{grid-template-columns:minmax(0,1fr)}
  .settings{grid-template-columns:minmax(0,1fr)}
  .arena{padding:14px;border-radius:16px}
  .question{padding:16px 14px 0}
  .comment-cta{margin:auto -14px 0}
  .q-top{flex-wrap:wrap}
  .point-ladder{order:3;flex-basis:100%}
  .timer{margin-left:auto}
  .how-to li{font-size:12px}
  .result-list li{grid-template-columns:18px 30px minmax(0,1fr) auto auto;gap:6px}
  .result-list .avatar{width:30px;height:30px}
}
/* Phone: compact stage, secondary text dropped. */
@media (max-width:600px){
  .wide-only,.q-meta,.how-to,.lb-head span,.player-name small:not(.rank-change),.conn,.prompt-label,.lobby-kicker,.lobby-note,.podium-ghost{display:none}
  .arena{gap:10px;padding:10px;border-radius:14px}
  .arena.full{padding:10px}
  .arena.pinned{padding-top:max(10px,env(safe-area-inset-top));padding-bottom:max(10px,env(safe-area-inset-bottom))}
  .stage-top{flex-wrap:nowrap;gap:8px}
  .show-title{gap:8px}.show-title strong{font-size:17px;letter-spacing:-.3px}
  .live-tag{padding:3px 7px;font-size:10px}
  .fs-btn{margin-left:auto;padding:6px 10px;font-size:11px}
  .play-grid{gap:10px}
  .question{min-height:0;padding:12px 12px 0;border-width:2px;border-radius:16px;box-shadow:0 5px 0 #000}
  .q-top{flex-wrap:nowrap;gap:8px}
  .level{width:44px;height:44px;border-radius:10px}.level span{font-size:8px}.level strong{font-size:18px}
  .point-ladder{order:0;flex-basis:auto;gap:4px}
  .point-ladder li{padding:4px 2px;border-radius:9px}
  .point-ladder strong{font-size:15px}.point-ladder small{font-size:9px}
  .point-ladder .now{box-shadow:0 3px 0 #000}
  .timer{width:52px;height:52px;margin-left:0}.timer strong{font-size:20px}.timer circle{stroke-width:10}
  .question-text-slot{padding:12px 0 10px}
  .question h3{margin:0;font-size:clamp(26px,8vw,38px);letter-spacing:-1px}
  .letters{--max:44px;gap:8px 14px;padding:2px 0 8px}
  .letter-word{gap:4px}
  .letter-tile{border-radius:7px;border-bottom-width:4px}
  .answer-choices{gap:8px;grid-auto-rows:minmax(52px,auto);padding:2px 2px 8px}
  .answer-choice{gap:8px;padding:8px 10px 8px 8px;border-width:2px;border-radius:12px;box-shadow:0 4px 0 #000}
  .choice-key{width:32px;height:32px;border-radius:8px;font-size:18px}
  .choice-text{font-size:clamp(14px,4.2vw,18px);letter-spacing:-.2px}
  .choice-check{top:-12px;right:-8px;width:30px;height:30px}.choice-check svg{width:16px}
  .q-foot{justify-content:center;padding:4px 0 8px;font-size:12px}
  .comment-cta{margin:auto -12px 0;padding:9px 10px;font-size:14px}
  .lobby{gap:10px;padding:18px 0}
  .lobby h3{font-size:clamp(34px,11vw,48px);letter-spacing:-1.5px}
  .lobby-demo{gap:8px;margin-top:4px;padding:10px 12px}
  .demo-vi{font-size:16px}.demo-arrow{font-size:20px}
  .demo-tiles i{width:26px;height:32px;font-size:16px}
  .demo-keys i{width:30px;height:30px;font-size:16px}
  .side{gap:8px}
  .leaderboard{padding:10px;border-radius:14px}
  .lb-head h3{font-size:15px}
  .leaderboard ol{gap:4px;margin-top:8px}
  .leaderboard li,.leaderboard li.gold{grid-template-columns:18px 28px minmax(0,1fr) auto;gap:7px;padding:5px 8px 5px 5px;border-radius:10px}
  .leaderboard li.podium{border-width:2px;box-shadow:0 3px 0 #000}
  .avatar,.leaderboard li.gold .avatar{width:28px;height:28px;font-size:12px}
  .crown{top:-10px;width:16px}
  .rank{font-size:12px}
  .player-name strong{font-size:13px}
  .leaderboard li>b,.leaderboard li.gold>b{font-size:15px}
  .score-award{top:-8px;padding:1px 6px;font-size:12px}
  .waiting{padding:8px}.waiting h4{font-size:15px}.waiting p{font-size:12px}
  .gift-strip{min-height:32px;border-radius:10px}.gift-strip p{padding:7px 10px;font-size:12px}
  .live-activity{flex-basis:150px;padding:8px 8px 4px;border-radius:14px}
  .activity-heading{margin:0 2px 6px;font-size:12px}
  .chat-row{gap:6px;margin-bottom:4px;padding:4px 8px 4px 4px;border-radius:10px;font-size:12px}
  .chat-avatar{width:20px;height:20px;font-size:10px}
  .chat-text{padding-top:2px}
  .arena:not(.full) .leaderboard ol{max-height:260px}
  .results-overlay{padding:24px 10px 10px}
  .round-results{padding:26px 14px 14px;border-width:2px;border-radius:18px;box-shadow:0 6px 0 #000}
  .stamp{top:-18px;padding:6px 16px;font-size:17px}
  .result-label{font-size:12px}
  .result-answer{font-size:clamp(28px,9vw,40px)}
  .result-meaning{margin-bottom:10px;font-size:14px}
  .result-list{gap:4px}
  .result-list li{grid-template-columns:16px 26px minmax(0,1fr) auto auto;gap:6px;padding:5px 8px 5px 5px}
  .result-list .avatar{width:26px;height:26px;font-size:11px}
  .result-list strong{font-size:13px}
  .fastest{padding:1px 6px;font-size:9px}
  .result-list time{font-size:11px}.result-list b{font-size:14px}.result-list li.first b{font-size:16px}
  .no-winner{padding:12px}.no-winner strong{font-size:18px}
  .result-timer{height:6px;margin-top:10px}
  .result-footer{font-size:12px}
  /* Fullscreen on a phone: question on top, leaderboard and comments side by side below. */
  .arena:not(.full){margin:0 -22px;border-radius:0}
  .show-title{min-width:0}.show-title strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .fs-btn{flex-shrink:0;white-space:nowrap}
  .choice-text{overflow-wrap:break-word;hyphens:auto}
  .comment-cta{white-space:nowrap;font-size:clamp(12px,3.7vw,14px)}
  .arena:not(.full) .point-ladder small,.arena:not(.full) .cta-tail{display:none}
  .arena:not(.full) .answer-choice{gap:6px;padding:8px 8px 8px 6px}
  .arena:not(.full) .choice-key{width:28px;height:28px;font-size:16px}
  .arena:not(.full) .choice-text{font-size:clamp(13px,3.8vw,16px)}
  .arena:not(.full) .question-text-slot,.arena:not(.full) .answer-slot,.arena:not(.full) .answer-choices{flex:0 0 auto}
  .arena.full .play-grid{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.3fr) minmax(0,1fr)}
  .arena.full .side{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .arena.full .leaderboard li,.arena.full .leaderboard li.gold{grid-template-columns:16px 26px minmax(0,1fr) auto;gap:6px}
  .arena.full .leaderboard li.gold .avatar,.arena.full .avatar{width:26px;height:26px}
  .arena.full .gift-strip{grid-column:1/-1;grid-row:1}
  .arena.full .leaderboard{grid-row:2;padding:10px}
  .arena.full .live-activity{grid-row:2;min-height:0}
  .arena.full .leaderboard li.gold{padding:5px 8px 5px 5px}
  .arena.full .question h3{font-size:clamp(30px,10vw,48px)}
  .arena.full .letters{--max:min(50px,6.5vh)}
  .arena.full .answer-choices{grid-auto-rows:minmax(min(64px,8vh),auto)}
  .arena.full .choice-text{font-size:clamp(15px,4.6vw,20px)}
  .arena.full .choice-key{width:34px;height:34px;font-size:19px}
  .arena.full .fs-btn{top:max(6px,env(safe-area-inset-top));right:6px;padding:4px 8px;font-size:10px}
}
.shoutout{position:absolute;left:50%;bottom:74px;z-index:6;display:flex;align-items:center;gap:14px;width:max-content;max-width:calc(100% - 28px);padding:10px 16px 10px 10px;border:3px solid #000;border-radius:999px;background:var(--yellow);color:var(--ink);box-shadow:0 6px 0 #000;transform:translateX(-50%);overflow:hidden}
.shoutout::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,#ffffffb3 50%,transparent 70%);transform:translateX(-100%);animation:shout-shine 1.1s .45s ease-out}
.shout-avatar{position:relative;flex-shrink:0;display:grid;place-items:center;width:54px;height:54px;border:3px solid #000;border-radius:50%;background:#fff;font-size:22px;font-weight:800}
.shout-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.bolt{position:absolute;right:-7px;bottom:-5px;display:grid;place-items:center;width:24px;height:24px;border:2px solid #000;border-radius:50%;background:var(--pink);animation:check-pop .5s .3s cubic-bezier(.2,1.8,.4,1) both}
.bolt svg{width:14px;fill:var(--yellow)}
.shout-body{display:flex;flex-direction:column;min-width:0;line-height:1.2}
.shout-body small{font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--pink)}
.shout-body strong{max-width:min(340px,40vw);overflow:hidden;font-size:clamp(17px,1.8vw,24px);font-weight:800;text-overflow:ellipsis;white-space:nowrap}
.shout-body span{font-size:14px;font-weight:600}.shout-body b{font-size:17px;font-weight:800}
.shout-points{flex-shrink:0;padding:6px 12px;border:2px solid #000;border-radius:999px;background:var(--green);font-size:18px;font-weight:800}
.shoutout-enter-active{animation:shout-in .55s cubic-bezier(.2,1.6,.4,1)}
.shoutout-leave-active{transition:opacity .3s,transform .3s}
.shoutout-leave-to{opacity:0;transform:translate(-50%,14px) scale(.9)}
@keyframes shout-in{0%{opacity:0;transform:translate(-50%,36px) scale(.6)}100%{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes shout-shine{100%{transform:translateX(100%)}}
@media (max-width:600px){.shoutout{gap:10px;bottom:64px;padding:8px 12px 8px 8px}.shout-avatar{width:42px;height:42px}.shout-points{font-size:15px;padding:4px 9px}}
@media (hover:none){.arena.full .fs-btn{opacity:.4}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style>
