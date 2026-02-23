# Use official Node.js slim image (Debian-based)
FROM node:20-slim

# Install Chromium, Python3, and required system libraries
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    python3 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell chrome-launcher where to find Chromium
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
