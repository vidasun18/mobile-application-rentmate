FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.js && node src/server.js"]
