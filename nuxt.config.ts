export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: false },
  nitro: { preset: 'node-server' },
  app: { head: { title: 'TikKit — TikTok tools', meta: [{ name: 'description', content: 'Fetch TikTok comments, download videos, and explore live tools.' }], htmlAttrs: { lang: 'vi' } } }
})
