# Dropwise gateway sidecar: sits in front of Bifrost. Node 22.18+ runs the TypeScript directly and
# there are no runtime dependencies, so the image is Node plus the source. No build step.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8088 \
    DATA_DIR=/app/data

COPY package.json ./
COPY src ./src
COPY data/budgets.json ./data/budgets.json
COPY data/hourly-profile.json ./data/hourly-profile.json

# Receipts, budget usage and benchmark results are written under data/.
RUN mkdir -p data/benchmark && chown -R node:node data
USER node

EXPOSE 8088
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8088)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.ts"]
