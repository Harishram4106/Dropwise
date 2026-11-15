# Dropwise intelligence API: Evidence Registry, claim checker, right-sizing classifier.
# Node 22.18+ runs the TypeScript sources directly, and there are no runtime dependencies,
# so the image is just Node plus the source and the signed registry. No build step, no npm install.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787

COPY package.json ./
COPY src ./src
COPY registry ./registry
COPY eval ./eval

# The server only writes the Tavily search cache (live claim checks) and quality reports.
RUN mkdir -p .cache eval/results && chown -R node:node .cache eval/results
USER node

EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.ts"]
