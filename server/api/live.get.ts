import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { parseLiveUrl, serializeLiveEvent } from '../utils/live.mjs';

export default defineEventHandler(async (event) => {
  let username: string;
  try { username = parseLiveUrl(getQuery(event).url); }
  catch (error: any) { throw createError({ statusCode: 400, statusMessage: error.message }); }
  setResponseHeaders(event, { 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  const stream = createEventStream(event);
  const connection = new TikTokLiveConnection(username, { enableExtendedGiftInfo: false, processInitialData: false });
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  let heartbeat: ReturnType<typeof setInterval>;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer); clearInterval(heartbeat);
    void connection.disconnect().catch(() => {});
  };
  const send = (type: string, data: unknown) => {
    if (!closed) void stream.push({ event: 'live', data: serializeLiveEvent(type, data) }).catch(cleanup);
  };
  const finish = (type: string, data: unknown) => {
    if (closed) return;
    send(type, data);
    cleanup();
    void stream.close();
  };
  stream.onClosed(cleanup);
  for (const type of new Set(Object.values(WebcastEvent))) {
    connection.on(type as any, (data: unknown) => send(type, data));
  }
  // The connector also emits recoverable errors while trying fallback providers.
  // Only a rejected connect() or a disconnect should terminate the stream.
  const describeError = (error: any) => {
    const exception = error?.exception || error;
    const clean = (value: unknown) => String(value || '').replace(/https?:\/\/[^\s]+/g, '[upstream URL]').slice(0, 600);
    return {
      message: clean(exception?.message || error?.info || 'Lỗi kết nối TikTok LIVE'),
      name: clean(exception?.name),
      code: clean(exception?.code),
      statusCode: exception?.response?.statusCode || exception?.statusCode,
      info: clean(error?.info),
    };
  };
  connection.on(ControlEvent.ERROR, (error: unknown) => send('connectorError', describeError(error)));
  connection.on(ControlEvent.DISCONNECTED, () => finish('disconnected', { message: 'Kết nối LIVE đã đóng.' }));
  timer = setTimeout(() => finish('connectionError', { message: 'Kết nối quá 45 giây. Vui lòng thử lại.' }), 45_000);
  heartbeat = setInterval(() => send('heartbeat', {}), 15_000);
  void connection.connect().then(async (state) => {
    if (closed) { await connection.disconnect(); return; }
    clearTimeout(timer);
    send('connected', state);
    send('roomInfo', connection.roomInfo);
  }).catch((error: unknown) => finish('connectionError', describeError(error)));
  return stream.send();
});
