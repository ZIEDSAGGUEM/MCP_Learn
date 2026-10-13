# Lab UI. Built from the insurebot/ folder (docker compose: context ., dockerfile ui/Dockerfile)
# so the original policy file can be baked in for "Restore original".
FROM node:24.21.0-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --ignore-scripts
COPY ui/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.21.0-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3005 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY policy/insurebot.cedar ./policy-default/insurebot.cedar
USER node
EXPOSE 3005
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3005/api/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
