import { parseInput } from '../utils/input.mjs';

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store');
  const query = getQuery(event);
  const action = String(query.action || '');
  if (!['comments', 'replies', 'video', 'download'].includes(action)) throw createError({ statusCode: 400, statusMessage: 'Công cụ không hợp lệ.' });
  const parentId = String(query.commentId || '');
  const videoId = String(query.videoId || '');
  if (action === 'replies' && !/^\d{1,30}$/.test(videoId)) throw createError({ statusCode: 400, statusMessage: 'Video ID không hợp lệ.' });
  if (action === 'replies' && !/^\d{1,30}$/.test(parentId)) throw createError({ statusCode: 400, statusMessage: 'Comment ID không hợp lệ.' });
  let input;
  try { input = parseInput(query.url, query.cursor ?? 0); }
  catch (error: any) { throw createError({ statusCode: 400, statusMessage: error.message }); }
  try {
    const response: any = await $fetch(action === 'replies' ? 'https://www.tikwm.com/api/comment/reply' : action === 'comments' ? 'https://www.tikwm.com/api/comment/list' : 'https://www.tikwm.com/api/', {
      query: action === 'replies' ? { comment_id: parentId, video_id: videoId, cursor: input.cursor, count: 50 } : action === 'comments' ? { url: input.url, cursor: input.cursor, count: 50 } : { url: input.url, hd: 1 },
      timeout: 20000, retry: 0,
    });
    if (response.code !== 0 || !response.data) throw new Error('Provider unavailable');
    const data = response.data;
    if (action === 'comments' || action === 'replies') return {
      comments: (data.comments || []).map((c: any) => ({ id: String(c.id || c.cid), videoId: String(c.video_id || videoId), parentId: action === 'replies' ? parentId : null, text: c.text, likes: c.digg_count || 0, date: c.create_time, replies: c.reply_total ?? c.reply_count ?? 0, name: c.user?.nickname || c.user?.unique_id || 'TikTok user', avatar: typeof c.user?.avatar === 'string' && c.user.avatar.startsWith('https://') ? c.user.avatar : null, user: c.user?.unique_id || c.user?.nickname || 'TikTok user' })),
      cursor: data.cursor ?? 0, hasMore: Boolean(data.hasMore ?? data.has_more), total: data.total ?? null,
    };
    if (action === 'download') {
      let media = new URL(data.hdplay || data.play);
      let file: Response | undefined;
      for (let hop = 0; hop < 4; hop++) {
        const domains = ['tikwm.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'byteoversea.com', 'ibytedtos.com'];
        if (media.protocol !== 'https:' || media.port || media.username || media.password || !domains.some(domain => media.hostname === domain || media.hostname.endsWith('.' + domain))) throw new Error('Unsupported media host');
        file = await fetch(media, { signal: AbortSignal.timeout(20000), redirect: 'manual' });
        if (file.status >= 300 && file.status < 400 && file.headers.get('location')) {
          await file.body?.cancel();
          media = new URL(file.headers.get('location')!, media);
          file = undefined;
          continue;
        }
        break;
      }
      if (!file?.ok || !file.body || !/^(video\/|application\/octet-stream)/.test(file.headers.get('content-type') || '')) throw new Error('Download unavailable');
      setResponseHeader(event, 'Content-Type', 'video/mp4');
      setResponseHeader(event, 'Content-Disposition', 'attachment; filename="tiktok-video.mp4"');
      return sendStream(event, file.body);
    }
    return { title: data.title || 'TikTok video', author: data.author?.nickname || '', cover: data.cover, play: data.play, duration: data.duration, likes: data.digg_count, comments: data.comment_count };
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Không lấy được dữ liệu TikTok. Video có thể riêng tư hoặc dịch vụ đang giới hạn. Vui lòng thử lại sau.' });
  }
});
