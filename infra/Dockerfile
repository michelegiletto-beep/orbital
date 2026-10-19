FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run verify && npm run sbom
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/web/serve.mjs ./apps/web/serve.mjs
COPY --from=build --chown=node:node /app/docs/supply-chain ./docs/supply-chain
COPY --from=build --chown=node:node /app/docs/earth-imagery.md ./docs/earth-imagery.md
COPY --from=build --chown=node:node /app/LICENSE ./LICENSE
USER node
EXPOSE 4317 4318
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4318/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","dist/api/apps/api/src/server.js"]
