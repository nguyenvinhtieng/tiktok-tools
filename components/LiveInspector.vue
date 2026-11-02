<script setup>
import { parseLiveUrl } from '../server/utils/live.mjs';
const url = ref('');
const status = ref('Chưa kết nối');
const error = ref('');
const active = ref(false);
const events = ref([]);
const total = ref(0);
let source;
let sequence = 0;
const groups = computed(() => {
  const grouped = new Map(['chat', 'gift'].map(type => [type, []]));
  for (const event of events.value) {
    if (!grouped.has(event.type)) grouped.set(event.type, []);
    grouped.get(event.type).push(event);
  }
  return [...grouped].map(([type, items]) => ({ type, items }));
});
function disconnect() {
  source?.close(); source = undefined; active.value = false;
  status.value = 'Đã ngắt kết nối';
}
function connect() {
  error.value = '';
  try { parseLiveUrl(url.value); } catch (e) { error.value = e.message; return; }
  disconnect();
  events.value = []; total.value = 0;
  active.value = true; status.value = 'Đang kết nối…';
  const current = new EventSource(`/api/live?url=${encodeURIComponent(url.value.trim())}`);
  source = current;
  current.addEventListener('live', message => {
    if (source !== current) return;
    const event = JSON.parse(message.data);
    if (event.type === 'heartbeat') return;
    total.value++;
    events.value.unshift({ ...event, id: ++sequence });
    if (events.value.length > 500) events.value.pop();
    if (event.type === 'connected') status.value = 'Đang nhận sự kiện';
    if (['disconnected', 'streamEnd', 'connectionError'].includes(event.type)) {
      disconnect();
      if (event.type === 'connectionError') error.value = event.data.message;
    }
  });
  current.onerror = () => {
    if (source !== current) return;
    disconnect(); error.value = 'Kết nối bị lỗi hoặc gián đoạn. Kiểm tra link LIVE và bấm kết nối lại.';
  };
}
function summary(event) {
  const data = event.data || {};
  const user = data.user || data;
  return [user.nickname || user.uniqueId, data.comment, data.giftDetails?.giftName || data.giftName || data.gift?.name, data.repeatCount ? `×${data.repeatCount}` : ''].filter(Boolean).join(' · ') || 'Mở để xem toàn bộ JSON';
}
onBeforeUnmount(disconnect);
</script>

<template>
  <div class="live-inspector">
    <form @submit.prevent="connect">
      <label for="live-url">Link livestream công khai</label>
      <div class="live-input"><input id="live-url" v-model="url" type="url" required placeholder="https://www.tiktok.com/@username/live" :disabled="active"><button class="primary" :disabled="active">Kết nối</button><button v-if="active" type="button" class="secondary" @click="disconnect">Ngắt kết nối</button></div>
    </form>
    <p class="hint">Nhận sự kiện từ lúc kết nối, gồm bình luận và quà tặng. Mở từng action và sự kiện để xem toàn bộ payload thư viện trả về; không có dữ liệu lịch sử trước đó.</p>
    <div class="live-toolbar"><span role="status">● {{ status }} · {{ total }} sự kiện</span><button type="button" class="secondary" @click="events = []; total = 0">Xóa log</button></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p class="hint">Nhận nguyên payload quà tặng và người gửi; không tải danh mục metadata quà mở rộng vì endpoint này cần gói Business. Giữ 500 sự kiện mới nhất trên UI. Quà tặng theo chuỗi có thể phát nhiều sự kiện; kiểm tra repeatCount / repeatEnd trong JSON.</p>
    <details v-for="group in groups" :key="group.type" class="event-group" open>
      <summary>{{ group.type === 'chat' ? 'Bình luận / chat' : group.type === 'gift' ? 'Người tặng quà / gift' : group.type }} <span>{{ group.items.length }}</span></summary>
      <p v-if="!group.items.length" class="hint">Chưa nhận sự kiện.</p>
      <details v-for="event in group.items" :key="event.id" class="event-item">
        <summary><time>{{ new Date(event.receivedAt).toLocaleTimeString('vi-VN') }}</time> {{ summary(event) }}</summary>
        <pre>{{ JSON.stringify(event, null, 2) }}</pre>
      </details>
    </details>
  </div>
</template>

<style scoped>
.live-inspector{padding-bottom:28px}.live-input{display:flex;gap:10px;flex-wrap:wrap}.live-input input{flex:1;min-width:210px;padding:14px;border:1px solid #d9dfd0;border-radius:5px;font:inherit}.live-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:22px;font-size:13px;color:#526b33}.event-group{margin-top:18px;border:1px solid #d9dfd0;border-radius:7px;padding:15px}.event-group>summary{font-weight:600}.event-group>summary span{margin-left:8px;color:#71805f;font-size:13px}.event-item{border-top:1px solid #e6e9df;margin-top:12px;padding-top:12px}summary{cursor:pointer;overflow-wrap:anywhere;line-height:1.7}.event-item summary{font-size:13px}.event-item time{color:#818873;margin-right:10px}pre{max-height:480px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6ee;border-radius:5px;padding:15px;font-size:12px;line-height:1.6}button:disabled{opacity:.5;cursor:default}
</style>
