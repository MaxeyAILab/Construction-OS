FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @constructionos/api...

FROM deps AS build
COPY packages/config packages/config
COPY packages/schemas packages/schemas
COPY apps/api apps/api
RUN pnpm --filter @constructionos/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=build /repo/node_modules /repo/node_modules
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
