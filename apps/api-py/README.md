# API Python — phase 1

Backend FastAPI temporairement situé dans `apps/api-py` afin de conserver le backend
NestJS de `apps/api` exécutable jusqu'à la bascule de phase 3.

Prérequis : Python 3.14, un client OAuth Google Cloud et le service PostgreSQL.
Copier `.env.example`, renseigner les placeholders Google,
`DATABASE_URL`, `INTERNAL_API_SECRET`, `TOKEN_ENCRYPTION_KEY` et les
variables LLM, puis autoriser `http://localhost:3000/api/auth/callback/google`.

```sh
pnpm api:install
pnpm api:migrate
pnpm api:test
pnpm api:lint
pnpm api:start
pnpm api:worker
```

La migration et ses tests utilisent SQLite sans service externe. PostgreSQL reste la
cible de production ; les types dialectaux conservent `TEXT[]`, `JSONB` et
`TIMESTAMP(3)` sur PostgreSQL. La révision initiale crée le schéma complet sur une base
vide, mais adopte les tables Prisma existantes sans les supprimer ni les recréer.
