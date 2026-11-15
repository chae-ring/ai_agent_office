FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates poppler-utils unzip && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@0.162.1
WORKDIR /app
COPY package.json ./
COPY db.js codex.js worker.js server.js ./
COPY public ./public
RUN mkdir -p /app/data /home/node/.codex && chown -R node:node /app/data /home/node/.codex
ENV NODE_ENV=production HOME=/home/node CODEX_HOME=/home/node/.codex HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
