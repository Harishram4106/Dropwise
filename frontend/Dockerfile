# Dropwise dashboard (Next.js). Built in two stages so the final image holds only what it runs.
#
# The NEXT_PUBLIC_* values are read by the BROWSER, not by this container, so they are baked in at build time and must be
# addresses your browser can reach (localhost, as published by docker-compose.yml), not Docker-internal service names.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8088
ARG NEXT_PUBLIC_INTELLIGENCE_URL=http://localhost:8787
ARG NEXT_PUBLIC_REPO_URL=
ARG NEXT_PUBLIC_VIDEO_URL=
ARG NEXT_PUBLIC_DEMO_MODE=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_INTELLIGENCE_URL=$NEXT_PUBLIC_INTELLIGENCE_URL \
    NEXT_PUBLIC_REPO_URL=$NEXT_PUBLIC_REPO_URL \
    NEXT_PUBLIC_VIDEO_URL=$NEXT_PUBLIC_VIDEO_URL \
    NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
