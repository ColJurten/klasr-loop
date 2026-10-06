FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @klasr/web

COPY . .
RUN pnpm --filter @klasr/web build

FROM node:20-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --prod --filter @klasr/web
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/next.config.mjs ./apps/web/next.config.mjs

EXPOSE 3000
CMD ["pnpm", "--filter", "@klasr/web", "start"]
