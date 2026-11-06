export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: false },
  buildDir: process.env.NODE_ENV === 'production' ? '.nuxt-build' : '.nuxt',
  nitro: { preset: 'node-server', externals: { inline: [/\/utils\/quiz-(words|shoutout)\.mjs$/] } },
  app: { head: { title: 'TikKit — TikTok tools', meta: [{ name: 'description', content: 'Fetch TikTok comments, download videos, and explore live tools.' }], htmlAttrs: { lang: 'vi' } } }
})
