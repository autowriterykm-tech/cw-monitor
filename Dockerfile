# node:20-slim + Chromium（Puppeteer用）
FROM node:20-slim

# Chromium と依存ライブラリのインストール
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer に Chromium の場所を伝える
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 依存関係インストール（キャッシュ効率化のため package.json を先にコピー）
COPY package.json ./
RUN npm install --omit=dev

# ソースコードをコピー
COPY src/ ./src/

# 非 root ユーザーで実行（セキュリティベストプラクティス）
RUN groupadd -r pptruser && useradd -r -g pptruser pptruser \
    && chown -R pptruser:pptruser /app
USER pptruser

EXPOSE 3000

CMD ["node", "src/index.js"]
