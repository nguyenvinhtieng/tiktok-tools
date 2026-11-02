export function parseInput(value, cursor = 0) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Nhập URL TikTok hợp lệ.'); }
  if (url.protocol !== 'https:' || !['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname) || url.username || url.password || url.port || url.pathname === '/') {
    throw new Error('Chỉ hỗ trợ link video HTTPS từ TikTok.');
  }
  const page = Number(cursor);
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Cursor không hợp lệ.');
  return { url: url.href, cursor: page };
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
