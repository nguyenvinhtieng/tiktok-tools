<script setup>
import { mergePage, runBulk } from './utils/bulk.mjs';
import { csvCell } from './server/utils/input.mjs';
const route = useRoute();
const tool = computed(() => route.query.tool === 'download' ? 'download' : ['live-1', 'live-2', 'live-3'].includes(String(route.query.tool)) ? String(route.query.tool) : 'comments');
const isLive = computed(() => tool.value.startsWith('live-'));
const url = ref('');
const busy = ref(false);
const error = ref('');
const comments = ref([]);
const video = ref(null);
const cursor = ref(0);
const hasMore = ref(false);
const searched = ref(false);
const sourceUrl = ref('');
const filter = ref('');
const liveOpen = ref(false);
const bulkReplies = ref(false);
const bulk = reactive({ running: false, status: '', pages: 0, current: '' });
let bulkController;
let generation = 0;
const commentPage = reactive({ items: [], cursor: 0, hasMore: true, loaded: false });
const replyCount = computed(() => Object.values(threads).reduce((sum, thread) => sum + thread.items.length, 0));
function stopBulk() { bulkController?.abort(); }
function syncComments() {
  comments.value = commentPage.items;
  cursor.value = commentPage.cursor;
  hasMore.value = commentPage.hasMore;
}
async function loadBulk() {
  if (busy.value) return;
  const requested = url.value.trim();
  if (!requested) return;
  if (sourceUrl.value !== requested) {
    Object.assign(commentPage, { items: [], cursor: 0, hasMore: true, loaded: false, seenCursors: new Set() });
    Object.keys(threads).forEach(key => delete threads[key]);
    bulk.pages = 0;
  }
  sourceUrl.value = requested;
  searched.value = true;
  const version = generation;
  const controller = new AbortController();
  bulkController = controller;
  bulk.running = true; bulk.status = 'Đang tải'; busy.value = true; error.value = '';
  const includeReplies = bulkReplies.value;
  try {
    const status = await runBulk({
      comments: commentPage, threads, includeReplies, signal: controller.signal,
      fetchPage: ({ signal, ...query }) => {
        bulk.current = query.action === 'replies' ? `Trả lời của comment ${query.commentId}` : 'Bình luận chính';
        return $fetch('/api/tool', { query: { ...query, url: requested }, signal });
      },
      onPage: ({ action, state }) => {
        if (version !== generation) return;
        if (action === 'replies') state.error = '';
        syncComments(); bulk.pages++;
      },
    });
    if (version === generation) bulk.status = status === 'complete' ? 'Đã tải hết dữ liệu API cung cấp' : 'Đã dừng — có thể tiếp tục';
  } catch (e) {
    if (version === generation) { bulk.status = 'Tạm dừng do lỗi — có thể tiếp tục'; error.value = e.data?.statusMessage || e.message || 'Không tải được dữ liệu.'; }
  } finally {
    if (bulkController === controller) { bulk.running = false; busy.value = false; bulk.current = ''; }
  }
}
onBeforeUnmount(stopBulk);
const display = reactive({ avatar: true, name: true, user: true, likes: true, date: false, replies: false });
const displayOptions = [
  { key: 'avatar', label: 'Avatar', csv: 'Avatar URL' },
  { key: 'name', label: 'Tên hiển thị', csv: 'Name' },
  { key: 'user', label: 'Username', csv: 'Username' },
  { key: 'likes', label: 'Lượt tim', csv: 'Likes' },
  { key: 'date', label: 'Thời gian', csv: 'Date' },
  { key: 'replies', label: 'Số trả lời', csv: 'Replies' },
];
const shownCount = computed(() => Object.values(display).filter(Boolean).length);
function formatDate(value) {
  const date = new Date(Number(value) * 1000);
  return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date) : '—';
}

const showReplies = ref(true);
const threads = reactive({});
const matches = c => `${c.user} ${c.name || ''} ${c.text}`.toLowerCase().includes(filter.value.toLowerCase());
const filtered = computed(() => comments.value.filter(c => matches(c) || (showReplies.value && threads[c.id]?.items.some(matches))));
const visibleRows = computed(() => filtered.value.flatMap(c => {
  const rows = [c];
  const thread = threads[c.id];
  if (showReplies.value && thread?.open) rows.push(...thread.items.filter(reply => matches(c) || matches(reply)).map(reply => ({ ...reply, parentId: c.id, parentName: c.name || c.user })));
  return rows;
}));
const renderedRows = computed(() => {
  const rows = [];
  for (const parent of filtered.value) {
    rows.push(parent);
    const thread = threads[parent.id];
    if (showReplies.value && thread?.open) {
      rows.push(...thread.items.filter(reply => matches(parent) || matches(reply)).map(reply => ({ ...reply, parentId: parent.id, parentName: parent.name || parent.user })));
      rows.push({ id: `controls-${parent.id}`, control: parent });
    }
  }
  return rows;
});
async function toggleReplies(comment, more = false) {
  if (bulk.running) return;
  threads[comment.id] ||= { items: [], open: false, loaded: false, busy: false, error: '', cursor: 0, hasMore: true };
  const thread = threads[comment.id];
  if (thread.busy) return;
  if (!more && thread.open) { thread.open = false; return; }
  thread.open = true;
  if (thread.loaded && !more) return;
  thread.busy = true; thread.error = '';
  const version = generation;
  try {
    const result = await $fetch('/api/tool', { query: { action: 'replies', url: sourceUrl.value, commentId: comment.id, videoId: comment.videoId, cursor: thread.cursor } });
    if (version !== generation || threads[comment.id] !== thread) return;
    mergePage(thread, result);
  } catch (e) { if (version === generation) thread.error = e.message || 'Không tải được trả lời. Vui lòng thử lại.'; }
  finally { thread.busy = false; }
}
const title = computed(() => isLive.value ? (tool.value === 'live-1' ? 'Live Inspector' : `Live / Test ${tool.value.slice(-1)}`) : tool.value === 'download' ? 'Download video' : 'Fetch comments');
watch(tool, () => { stopBulk(); generation++; error.value = ''; liveOpen.value = false; });
watch(url, () => { stopBulk(); generation++; bulk.status = ''; bulk.pages = 0; Object.assign(commentPage, { items: [], cursor: 0, hasMore: true, loaded: false, seenCursors: new Set() }); Object.keys(threads).forEach(key => delete threads[key]); sourceUrl.value = '';  video.value = null; comments.value = []; searched.value = false; hasMore.value = false; });
async function submit(more = false) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  const selected = tool.value;
  const version = generation;
  const requested = more ? sourceUrl.value : url.value.trim();
  try {
    const result = await $fetch('/api/tool', { query: { action: selected === 'download' ? 'video' : 'comments', url: requested, cursor: more ? cursor.value : 0 } });
    if (version !== generation || selected !== tool.value || requested !== url.value.trim()) return;
    if (selected === 'download') video.value = result;
    else {
      if (!more) Object.keys(threads).forEach(key => delete threads[key]);
      if (!more) { Object.assign(commentPage, { items: [], cursor: 0, hasMore: true, loaded: false, seenCursors: new Set() }); bulk.pages = 0; bulk.status = ''; }
      mergePage(commentPage, result);
      syncComments(); searched.value = true; sourceUrl.value = requested;
    }
  } catch (e) { if (version === generation) error.value = e.data?.statusMessage || e.message || 'Không thể kết nối. Vui lòng thử lại.'; }
  finally { busy.value = false; }
}
function exportCsv() {
  const fields = displayOptions.filter(option => display[option.key]);
  const rows = [['Comment ID', 'Parent Comment ID', ...fields.map(option => option.csv), 'Comment'], ...visibleRows.value.map(c => [c.id, c.parentId || '',
    ...fields.map(option => option.key === 'date' ? formatDate(c.date) : c[option.key] ?? ''), c.text,
  ])];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'tiktok-comments.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
const number = value => Intl.NumberFormat('en', { notation: 'compact' }).format(value || 0);
</script>

<template>
  <div class="shell">
    <header>
      <NuxtLink class="brand" to="/?tool=comments"><span class="logo">♪</span> tik<span>kit</span></NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/?tool=comments" :class="{ active: tool === 'comments' }">Fetch comments</NuxtLink>
        <NuxtLink to="/?tool=download" :class="{ active: tool === 'download' }">Download video</NuxtLink>
        <div class="dropdown" @keydown.esc="liveOpen = false">
          <button :class="{ active: isLive }" :aria-expanded="liveOpen" @click="liveOpen = !liveOpen">Live <span class="tiny-dot"/> <span class="chevron">⌄</span></button>
          <div v-if="liveOpen" class="menu"><NuxtLink v-for="i in 3" :key="i" :to="`/?tool=live-${i}`" @click="liveOpen = false">{{ i === 1 ? 'Live Inspector' : `Test ${i}` }} <span>↗</span></NuxtLink></div>
        </div>
      </nav>
    </header>

    <main>
      <div class="page-heading"><div><div class="eyebrow">TIKKIT / WORKSPACE</div><h1>TikTok tools<span>↗</span></h1></div></div>

      <div class="workspace">
        <aside>
          <div class="aside-label">CÔNG CỤ <span>02</span></div>
          <NuxtLink class="tool-link" :class="{ selected: tool === 'comments' }" to="/?tool=comments"><span class="icon">☷</span><span>Fetch comments<small>Lấy & xuất bình luận</small></span><b>↗</b></NuxtLink>
          <NuxtLink class="tool-link" :class="{ selected: tool === 'download' }" to="/?tool=download"><span class="icon">↓</span><span>Download video<small>Tải video MP4</small></span><b>↗</b></NuxtLink>
          <div class="aside-label live-label">LIVE <span class="lab-badge">THỬ NGHIỆM</span></div>
          <NuxtLink v-for="i in 3" :key="i" :to="`/?tool=live-${i}`" class="lab-link" :class="{ selected: tool === `live-${i}` }"><span>0{{ i }}</span> {{ i === 1 ? 'Live Inspector' : `Test ${i}` }} <b>↗</b></NuxtLink>
        </aside>

        <section class="panel" :aria-label="title">
          <div class="panel-top"><span class="tool-category">{{ isLive ? 'LIVE / EXPERIMENT' : tool === 'download' ? '02 / VIDEO' : '01 / COMMENTS' }}</span></div>
          <h2>{{ title }}<span class="title-dot">.</span></h2>

          <template v-if="!isLive">
            <form @submit.prevent="submit(false)">
              <label for="video-url">TikTok video URL</label>
              <div class="input-row"><span class="link-icon">↗</span><input id="video-url" v-model="url" type="url" placeholder="https://www.tiktok.com/@username/video/..." required :disabled="busy" autocomplete="off"><button class="primary" :disabled="busy">{{ busy ? 'Đang xử lý…' : tool === 'download' ? 'Get video' : 'Fetch comments' }} <span v-if="!busy">↗</span></button></div>
            </form>
            <div v-if="tool === 'comments'" class="bulk-controls">
              <label><input v-model="bulkReplies" type="checkbox" :disabled="busy"> Tải kèm toàn bộ trả lời</label>
              <button v-if="!bulk.running" class="secondary" :disabled="busy || !url.trim() || Object.values(threads).some(thread => thread.busy)" @click="loadBulk">{{ searched ? 'Tải toàn bộ / Tiếp tục' : 'Tải toàn bộ comment' }}</button>
              <button v-else class="secondary" @click="stopBulk">Dừng tải</button>
            </div>
            <div v-if="bulk.status" class="bulk-progress" role="status" aria-live="polite">
              <progress v-if="bulk.running" aria-label="Đang tải bình luận"/>
              <strong>{{ bulk.status }}</strong>
              <span>{{ comments.length.toLocaleString('vi-VN') }} comment · {{ replyCount.toLocaleString('vi-VN') }} trả lời · {{ bulk.pages }} trang bulk</span>
              <small v-if="bulk.running">{{ bulk.current }}</small>
            </div>
            <p v-if="error" class="error" role="alert">{{ error }}</p>
            <div v-if="tool === 'comments' && searched" class="results">
              <div class="results-head"><h3>Comments <span>{{ comments.length }}</span></h3><div class="result-actions">
                <details class="display-dropdown" @keydown.esc="$event.currentTarget.open = false">
                  <summary class="secondary">Hiển thị <span>{{ shownCount }}/6</span> ⌄</summary>
                  <div class="display-menu"><p>Thông tin bình luận</p><label v-for="option in displayOptions" :key="option.key"><input v-model="display[option.key]" type="checkbox">{{ option.label }}</label><label class="reply-setting"><input v-model="showReplies" type="checkbox">Hiện trả lời theo nhóm</label><small>Nội dung luôn hiển thị.<br>CSV theo các trường đã chọn.</small></div>
                </details>
                <button class="secondary" :disabled="!filtered.length" @click="exportCsv">↓ Export CSV</button>
              </div></div>
              <input v-model="filter" class="search" placeholder="Tìm người dùng hoặc nội dung…" aria-label="Search comments">
              <div class="table-wrap"><table class="comments-table"><thead><tr><th>BÌNH LUẬN</th><th v-if="display.likes" class="metric">TIM</th><th v-if="display.replies" class="metric">TRẢ LỜI</th><th v-if="display.date" class="date-cell">THỜI GIAN</th></tr></thead><tbody>
                <template v-for="c in renderedRows" :key="c.id">
                <tr v-if="c.control" class="reply-row"><td :colspan="1 + Number(display.likes) + Number(display.replies) + Number(display.date)">
                  <button v-if="threads[c.control.id].hasMore" class="thread-toggle" :disabled="threads[c.control.id].busy || bulk.running" @click="toggleReplies(c.control, true)">{{ threads[c.control.id].busy ? 'Đang tải…' : 'Tải thêm trả lời ↓' }}</button>
                  <p v-if="threads[c.control.id].loaded && !threads[c.control.id].items.length" class="thread-note">Không có trả lời khả dụng.</p>
                  <div v-if="threads[c.control.id].error" class="thread-error" role="alert">{{ threads[c.control.id].error }} <button class="thread-toggle" :disabled="bulk.running" @click="toggleReplies(c.control, true)">Thử lại</button></div>
                </td></tr>
                <tr v-else :class="{ 'reply-row': c.parentId }"><td><div v-if="c.parentId" class="reply-to">↳ Trả lời {{ c.parentName }}</div><div class="comment-row">
                  <span v-if="display.avatar" class="comment-avatar"><img v-if="c.avatar && !c.avatarFailed" :src="c.avatar" :alt="`Avatar ${c.name || c.user}`" loading="lazy" referrerpolicy="no-referrer" @error="c.avatarFailed = true"><span v-else aria-hidden="true">{{ (c.name || c.user || '?').slice(0, 1).toUpperCase() }}</span></span>
                  <div class="comment-body"><div v-if="display.name || display.user" class="comment-identity"><span v-if="display.name" class="comment-name">{{ c.name || c.user }}</span><strong v-if="display.user">@{{ c.user }}</strong></div><p>{{ c.text }}</p>
                    <div v-if="!c.parentId && showReplies && c.replies > 0" class="thread-controls">
                      <button class="thread-toggle" :disabled="threads[c.id]?.busy || bulk.running" :aria-expanded="Boolean(threads[c.id]?.open)" @click="toggleReplies(c)">{{ threads[c.id]?.busy ? 'Đang tải…' : threads[c.id]?.open ? 'Ẩn trả lời' : `Xem ${c.replies} trả lời` }} <span>⌄</span></button>

                    </div>
                  </div>
                </div></td><td v-if="display.likes" class="metric">♡ {{ number(c.likes) }}</td><td v-if="display.replies" class="metric">{{ number(c.replies) }}</td><td v-if="display.date" class="date-cell">{{ formatDate(c.date) }}</td></tr></template>
              </tbody></table></div>
              <p v-if="!filtered.length" class="empty-text">{{ comments.length ? 'Không có bình luận khớp tìm kiếm.' : 'Chưa có bình luận để hiển thị.' }}</p>
              <button v-if="hasMore" class="secondary load-more" :disabled="busy" @click="submit(true)">{{ busy ? 'Đang tải…' : 'Load more comments ↓' }}</button>
            </div>
            <div v-else-if="tool === 'download' && video" class="video-result"><video :src="video.play" :poster="video.cover" controls preload="none"/><div><span class="tool-category">READY TO SAVE</span><h3>{{ video.title }}</h3><p>@{{ video.author }} · {{ video.duration }}s</p><p>♡ {{ number(video.likes) }} &nbsp; ☷ {{ number(video.comments) }}</p><a class="primary download" :href="`/api/tool?action=download&url=${encodeURIComponent(url.trim())}`">Download MP4 ↓</a><small>Nếu tải thất bại, provider có thể đang giới hạn yêu cầu.</small></div></div>
            <div v-else class="empty-state"><h3>{{ tool === 'download' ? 'Chưa có video' : 'Chưa có bình luận' }}</h3></div>
          </template>
          <LiveInspector v-else-if="tool === 'live-1'" />
          <div v-else class="empty-state live-empty"><span class="live-symbol">◉</span><h3>Live test {{ tool.slice(-1) }}</h3><p>Công cụ này đang chờ được phát triển.</p></div>
        </section>
      </div>

    </main>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap');
:root{font-family:'Be Vietnam Pro',Arial,sans-serif;color:#20211e;background:#f4f4ef;font-size:16px;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input{font:inherit}a{color:inherit;text-decoration:none}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}button,a,input{ -webkit-tap-highlight-color:transparent}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #6b8733;outline-offset:4px}header{height:92px;padding:0 4%;display:flex;align-items:center;justify-content:space-between;gap:32px;border-bottom:1px solid #d4d5cd;background:#f4f4ef}.brand{display:flex;align-items:center;font-weight:800;font-size:32px;letter-spacing:-2px}.logo{font-family:Arial,sans-serif;display:grid;place-items:center;background:#20211e;color:#d8fc71;width:40px;height:40px;margin-right:10px;border-radius:50%;font-size:32px;letter-spacing:0}.brand>span:not(.logo){color:#20211e}nav{display:flex;align-items:center;gap:6px}nav>a,nav button{display:inline-flex;align-items:center;gap:8px;padding:13px 19px;border:0;border-radius:7px;background:transparent;font-size:15px;font-weight:500;white-space:nowrap;color:#5a5c52}nav .active{background:#20211e;color:#fff}nav>a:hover:not(.active),nav button:hover:not(.active){background:#e6e7dd}.tiny-dot{width:6px;height:6px;border-radius:50%;background:#7c9c43;display:inline-block}.chevron{margin-left:10px}.dropdown{position:relative}.menu{position:absolute;right:0;top:52px;background:#fff;border:1px solid #d6d8cc;border-radius:9px;min-width:180px;padding:8px;z-index:5;box-shadow:0 10px 25px #20211e12}.menu a{display:flex;justify-content:space-between;padding:13px 12px;font-size:15px;border-radius:5px}.menu a:hover{background:#e5f8b9}.header-tag{font-size:13px;color:#686b5e}.header-tag span{margin-left:16px;font-size:24px;color:#222}main{max-width:1320px;padding:52px 40px 64px;margin:auto}.page-heading{display:flex;justify-content:space-between;align-items:center;padding-bottom:38px;border-bottom:1px solid #d4d5cd}.eyebrow{font-size:12px;font-weight:500;letter-spacing:1px;color:#75786b}h1{font-size:clamp(42px,5.2vw,68px);letter-spacing:-3px;font-weight:700;line-height:1.15;margin:17px 0 15px}h1 span{display:inline-grid;place-items:center;background:#d8fc71;border-radius:50%;width:58px;height:58px;font-size:44px;font-weight:400;margin-left:20px;vertical-align:middle;letter-spacing:0}.intro{font-size:17px;line-height:1.8;color:#65685e;margin:0}.edition{font-size:12px;line-height:1.9;letter-spacing:1px;color:#65685e;text-align:right;transform:rotate(-5deg);border:1px solid #a8ac9a;border-radius:50%;width:150px;height:97px;display:flex;flex-direction:column;justify-content:center;align-items:center}.edition b{font-size:14px;color:#20211e}.workspace{display:grid;grid-template-columns:245px minmax(0,1fr);gap:40px;margin-top:38px;align-items:start}.aside-label{display:flex;align-items:center;justify-content:space-between;margin:10px 12px 15px;font-size:12px;font-weight:500;color:#76796b;letter-spacing:.7px}.aside-label>span{font-size:11px}.tool-link{display:flex;align-items:center;gap:12px;margin:6px 0;padding:17px 12px;font-size:14px;font-weight:600;border-radius:8px}.tool-link small{display:block;font-size:12px;font-weight:400;color:#727568;margin-top:7px}.tool-link b,.lab-link b{margin-left:auto;font-size:18px;font-weight:400}.tool-link.selected{background:#e3e7d6}.icon{width:32px;flex-shrink:0;font-size:27px;text-align:center}.live-label{margin-top:38px}.lab-badge{background:#e6e7df;padding:5px 7px;border-radius:4px;font-size:9px!important;letter-spacing:0}.lab-link{display:flex;align-items:center;gap:18px;padding:13px 16px;margin:3px 0;border-radius:6px;font-size:15px;color:#686c5f}.lab-link>span{font-size:12px;color:#919582}.lab-link.selected{background:#e3e7d6;color:#20211e}.aside-note{border-top:1px solid #d4d5cd;display:flex;gap:15px;margin:38px 12px 0;padding-top:22px}.aside-note>span{font-size:30px;color:#747b60}.aside-note p{font-size:13px;line-height:1.8;color:#74786a;margin:0}.panel{min-width:0;background:#fff;border:1px solid #d8dacf;border-radius:12px;padding:32px 34px 0}.panel-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.tool-category{font-size:12px;color:#727969;letter-spacing:.6px;font-weight:500}.pill{font-size:12px;color:#526044;display:inline-flex;align-items:center;gap:7px}.pill>span{width:6px;height:6px;display:inline-block;background:#86a84b;border-radius:50%}h2{font-size:34px;font-weight:600;letter-spacing:-1.3px;margin:22px 0 12px}.title-dot{display:none}.description{font-size:15px;color:#73766c;line-height:1.9;margin:0 0 30px}label{font-size:14px;font-weight:500;display:block;margin-bottom:12px}.input-row{display:flex;align-items:center;gap:12px;background:#f8f9f5;border:1px solid #cfd3c4;border-radius:7px;padding:7px 7px 7px 15px}.input-row:focus-within{border-color:#798951;box-shadow:0 0 0 3px #e7efdc}.link-icon{font-size:24px;color:#6a735b}.input-row input{width:100%;min-width:0;outline:0;border:0;background:transparent;font-size:15px;padding:12px 0;color:#252820}.input-row input::placeholder{color:#92978a}.primary{display:inline-flex;align-items:center;justify-content:center;gap:16px;padding:16px 20px;border:1px solid #c6e66b;border-radius:5px;background:#d8fc71;color:#202718;font-size:14px;font-weight:600;white-space:nowrap;transition:background .15s}.primary:hover{background:#c5ee53}.primary>span{font-size:20px;line-height:1}.hint{font-size:12px;color:#777f6a;margin:12px 0 0;line-height:1.7}.empty-state{margin:34px 0;background:#f7f8f3;border:1px solid #e6e9df;border-radius:8px;padding:30px}.empty-heading{display:flex;gap:17px;align-items:center}.empty-mark{font-size:34px;background:#e7eddc;width:53px;height:53px;display:grid;place-items:center;flex-shrink:0;border-radius:50%;color:#5a6945}.empty-state h3{font-size:16px;font-weight:500;margin:0 0 8px;letter-spacing:-.3px}.empty-state p{font-size:13px;color:#7a806f;margin:0;line-height:1.7}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:32px;padding-top:23px;border-top:1px solid #dfe4d5}.steps>div{display:flex;flex-direction:column;gap:8px}.steps span{font-size:12px;color:#8a927d}.steps p{font-size:12px;color:#58624b}.panel-footer{margin:0 -34px;border-top:1px solid #e6e9df;padding:19px 34px;display:flex;gap:9px;font-size:12px;line-height:1.8;color:#7c8272}.panel-footer>span{font-size:16px}.results{margin-top:34px;padding-bottom:28px}.results-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.results-head h3{font-size:20px;font-weight:500}.results-head h3 span{font-size:13px;padding:4px 8px;background:#e7f4cd;border-radius:4px;margin-left:8px}.secondary{font-size:13px;background:#fff;border:1px solid #cdd4c1;border-radius:5px;padding:12px 15px;color:#465437}.secondary:hover{background:#f2f6e9}.search{font-size:15px;padding:14px;border:1px solid #d9dfd0;border-radius:5px;width:100%;margin:8px 0 16px}.table-wrap{max-height:470px;overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:15px}th{font-weight:500;font-size:11px;background:#f4f6ee;padding:14px;color:#737c65;letter-spacing:.5px}td{padding:17px 14px;border-bottom:1px solid #e8ecdf;vertical-align:top}td:first-child{overflow-wrap:anywhere}td:last-child{white-space:nowrap;font-size:13px;color:#707967}td strong{font-size:13px;font-weight:500;color:#526b33}td p{margin:8px 0 0;line-height:1.8}.load-more{display:block;margin:24px auto 0}.empty-text{font-size:14px;text-align:center;color:#818873;padding:24px}.error{background:#fff0ec;color:#9a422f;font-size:14px;line-height:1.8;padding:16px;border-radius:5px}.video-result{display:flex;gap:24px;margin:32px 0}.video-result video{width:35%;max-height:380px;border-radius:7px;background:#22281b}.video-result>div{flex:1;min-width:0}.video-result h3{font-size:18px;line-height:1.7;overflow-wrap:anywhere}.video-result p{font-size:14px;color:#777e6d;line-height:1.7}.video-result small{display:block;margin-top:14px;font-size:12px;color:#818775;line-height:1.8}.download{margin-top:12px}.live-empty{min-height:260px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}.live-symbol{font-size:48px;color:#7b914f;margin-bottom:22px}footer{border-top:1px solid #d4d5cd;max-width:1240px;margin:auto;padding:24px 0 30px;display:flex;justify-content:space-between;align-items:center;gap:20px;color:#7a7f6e;font-size:12px}.footer-brand{font-size:24px;font-weight:800;letter-spacing:-1px;color:#303528}.footer-brand span{font-size:12px;vertical-align:top;margin-left:3px}footer a{color:#414b34}
@media(max-width:1100px){.header-tag{display:none}.workspace{grid-template-columns:220px minmax(0,1fr);gap:24px}.panel{padding:28px 24px 0}.panel-footer{margin:0 -24px;padding:18px 24px}.input-row{flex-wrap:wrap}.input-row input{width:calc(100% - 42px)}.input-row .primary{width:100%}footer{margin:0 40px}}
@media(max-width:760px){header{height:auto;min-height:130px;flex-wrap:wrap;padding:19px 24px 10px;gap:16px}.brand{font-size:30px}nav{width:100%;justify-content:space-between;gap:4px}nav>a,nav button{font-size:14px;padding:12px 13px}.menu{top:48px}main{padding:32px 24px 40px}.page-heading{padding-bottom:28px}h1{font-size:46px;letter-spacing:-2px}h1 span{width:40px;height:40px;font-size:31px;margin-left:12px}.intro{font-size:15px}.edition{display:none}.workspace{display:block;margin-top:27px}aside{display:none}.panel{padding:24px 22px 0}h2{font-size:29px}.description{font-size:15px;line-height:1.8;margin-bottom:25px}.panel-top{gap:8px}.tool-category{font-size:11px}.pill{font-size:11px}.input-row input{font-size:16px}.primary{font-size:15px;padding:16px}.empty-state{margin:28px 0;padding:24px 20px}.empty-state h3{font-size:15px}.empty-heading{gap:12px}.empty-mark{width:43px;height:43px;font-size:28px}.steps{gap:12px}.steps p{font-size:12px}.panel-footer{margin:0 -22px;padding:17px 22px;font-size:12px}footer{margin:0 24px;flex-wrap:wrap;gap:18px}footer>span:nth-child(2){order:3;width:100%}.video-result{gap:16px}.video-result h3{font-size:16px}.download{font-size:13px}.results-head h3{font-size:18px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
.result-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.display-dropdown{position:relative}.display-dropdown summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center}.display-dropdown summary::-webkit-details-marker{display:none}.display-dropdown summary>span{font-size:11px;color:#737e66}.display-dropdown summary:focus-visible{outline:3px solid #6b8733;outline-offset:3px}.display-menu{position:absolute;right:0;top:calc(100% + 8px);width:245px;padding:17px;background:white;border:1px solid #d5ddca;box-shadow:0 12px 28px #242d1920;border-radius:8px;z-index:4}.display-menu>p{font-size:12px;color:#747e67;margin:0 0 12px}.display-menu label{display:flex;align-items:center;gap:12px;padding:9px 0;margin:0;font-size:14px;font-weight:400;cursor:pointer}.display-menu input{width:17px;height:17px;margin:0;accent-color:#506a2d}.display-menu small{display:block;border-top:1px solid #e5e9df;padding-top:12px;margin-top:12px;font-size:12px;line-height:1.7;color:#7a836e}.comment-row{display:flex;gap:13px;align-items:flex-start}.comment-avatar{flex-shrink:0;width:42px;height:42px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#e5edda;color:#577239;font-size:17px;font-weight:500}.comment-avatar img{display:block;width:100%;height:100%;object-fit:cover}.comment-body{min-width:0;flex:1}.comment-identity{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 9px}.comment-name{font-size:14px;font-weight:600;color:#30392a}.comments-table td .comment-body p{font-size:15px;color:#30382c;white-space:normal;margin:7px 0 0;line-height:1.8}.comments-table td .comment-body p:first-child{margin-top:0}.comments-table td:first-child{min-width:230px;white-space:normal}.comments-table .metric{width:80px;white-space:nowrap;color:#707967;font-size:13px}.comments-table .date-cell{min-width:125px;font-size:12px;color:#7a826e;line-height:1.8}.comments-table td:first-child:last-child{width:100%}.results-head{flex-wrap:wrap;margin-bottom:12px}.results-head h3{margin:12px 0}.comments-table th.metric{font-size:11px}@media(max-width:760px){.result-actions{width:100%;justify-content:space-between}.display-menu{right:auto;left:0}.comment-avatar{width:36px;height:36px}.comment-row{gap:10px}.comments-table td{padding:15px 10px}.comments-table td:first-child{min-width:215px}}
.thread-controls{display:flex;gap:6px 16px;align-items:center;flex-wrap:wrap;margin-top:8px}.thread-toggle{border:0;background:transparent;color:#536d34;font-size:13px;padding:7px 0;text-align:left;font-weight:500}.thread-toggle:hover{text-decoration:underline}.thread-toggle span{margin-left:7px}.reply-setting{border-top:1px solid #e5e9df;margin-top:8px!important;padding-top:15px!important}.reply-row{background:#f8faf4}.comments-table .reply-row td:first-child{padding-left:48px}.reply-row .comment-row{border-left:2px solid #cfddba;padding-left:15px}.reply-row .comment-avatar{width:32px;height:32px}.reply-to{font-size:12px;color:#778664;margin:0 0 10px 17px;white-space:normal}.thread-error{font-size:12px;color:#a34d36;width:100%;line-height:1.8}.comments-table .thread-controls .thread-note{font-size:12px;color:#7a836f;margin:0}@media(max-width:760px){.comments-table .reply-row td:first-child{padding-left:25px}.reply-row .comment-row{padding-left:10px}}
.panel{padding-bottom:30px}h2{margin-bottom:28px}.empty-state{min-height:150px;display:grid;place-items:center;border-style:dashed;background:transparent;margin-bottom:0}.empty-state h3{color:#8a907f;font-size:14px;font-weight:400}.results{padding-bottom:0}.video-result{margin-bottom:0}
.bulk-controls{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:18px}.bulk-controls label{display:flex;align-items:center;gap:8px;margin:0;font-size:13px}.bulk-controls input{accent-color:#506a2d}.bulk-progress{display:flex;flex-direction:column;gap:9px;background:#f3f7e9;border:1px solid #dbe5c9;padding:16px;border-radius:7px;margin-top:16px;font-size:13px;color:#52663a}.bulk-progress progress{width:100%;accent-color:#698b36}.bulk-progress small{overflow-wrap:anywhere}
</style>
