export function parseLiveUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Nhập link https://www.tiktok.com/@username/live'); }
  const match = url.pathname.match(/^\/@([a-zA-Z0-9_.]{1,24})\/live\/?$/);
  if (url.protocol !== 'https:' || !['www.tiktok.com', 'tiktok.com'].includes(url.hostname) || url.username || url.password || url.port || !match) throw new Error('Chỉ hỗ trợ link livestream công khai https://www.tiktok.com/@username/live');
  return match[1];
}
export function serializeLiveEvent(type, data) {
  if (type === 'chat' && typeof data?.content === 'string' && !data.comment) {
    data = { ...data, comment: data.content };
  }
  return JSON.stringify({ type, receivedAt: new Date().toISOString(), data }, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
}
