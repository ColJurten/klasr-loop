# API Python — phase 1

Backend FastAPI temporairement situé dans `apps/api-py` afin de conserver le backend
NestJS de `apps/api` exécutable jusqu'à la bascule de phase 3.

```sh
pnpm api:install
pnpm api:migrate
pnpm api:test
pnpm api:lint
```

La migration et ses tests utilisent SQLite sans service externe. PostgreSQL reste la
cible de production ; les types dialectaux conservent `TEXT[]`, `JSONB` et
`TIMESTAMP(3)` sur PostgreSQL. La révision initiale crée le schéma complet sur une base
vide, mais adopte les tables Prisma existantes sans les supprimer ni les recréer.
