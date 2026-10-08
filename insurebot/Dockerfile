FROM node:26.9.0-slim@sha256:3a771f83944bb763050c23c0225c260638c4b7899e7a72485ef75e5e570499e5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26.9.0-slim@sha256:3a771f83944bb763050c23c0225c260638c4b7899e7a72485ef75e5e570499e5
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Run as the unprivileged "node" user, not root
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# --import loads OpenTelemetry before the app (step 09)
CMD ["node", "--import", "./dist/telemetry.js", "dist/server.js"]
