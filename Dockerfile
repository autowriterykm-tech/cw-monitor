FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-zygote --single-process --disable-extensions --disable-crash-reporter --disable-breakpad"

WORKDIR /app

COPY package.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev

COPY src/ ./src/

RUN groupadd -r pptruser && useradd -r -g pptruser pptruser \
    && chown -R pptruser:pptruser /app
USER pptruser

EXPOSE 3000

CMD ["node", "src/index.js"]
