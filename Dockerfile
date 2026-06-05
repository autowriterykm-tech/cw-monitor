FROM node:20-slim

RUN apt-get update && apt-get install -y \
    gnupg \
    wget \
    ca-certificates \
    fonts-noto-cjk \
    --no-install-recommends \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev

COPY src/ ./src/

RUN groupadd -r pptruser && useradd -r -g pptruser pptruser \
    && chown -R pptruser:pptruser /app
USER pptruser

EXPOSE 3000

CMD ["node", "src/index.js"]
