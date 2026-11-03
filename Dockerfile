FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY nuxt.config.ts app.vue ./
COPY server ./server
COPY components ./components
COPY utils ./utils
COPY public ./public
RUN npm run build
FROM node:22-alpine
WORKDIR /app
COPY requirements-tts.txt ./
RUN apk add --no-cache python3 py3-pip \
    && python3 -m venv /opt/tts \
    && /opt/tts/bin/pip install --no-cache-dir -r requirements-tts.txt \
    && mkdir -p /app/.data/quiz-audio \
    && chown -R node:node /app/.data
COPY --from=build --chown=node:node /app/.output ./.output
USER node
ENV HOST=0.0.0.0 PORT=3000
ENV QUIZ_TTS_PYTHON=/opt/tts/bin/python
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
