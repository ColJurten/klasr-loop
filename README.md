# Klasr

Classement intelligent et automatisé de documents pour Google Drive / OneDrive.
OCR + LLM proposent nom de fichier et dossier de destination dans votre arborescence ;
un clic suffit pour exécuter le rangement.

Monorepo 100 % TypeScript : `apps/api` (NestJS — API, pipeline OCR/LLM, worker) · `apps/web` (Next.js 14, charte klasr).

- Architecture & ADR (REAC): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Engineering loop & agent setup: [`docs/LOOP.md`](docs/LOOP.md)
- Branching & releases: [`docs/BRANCHING.md`](docs/BRANCHING.md)
- Loop state (living memory): [`docs/STATE.md`](docs/STATE.md)
- Project conventions for Claude Code: [`CLAUDE.md`](CLAUDE.md)

Projet fil rouge — Titre professionnel CDA (RNCP niveau 6), Simplon.


# Test local 

```bash
cd /root/projects/klasr-oneshot/klasr-loop
pnpm install

# Credential-free one-shot demo
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @klasr/web dev
Open http://localhost:3000/demo

# Tests
pnpm --filter @klasr/api test
pnpm --filter @klasr/web test

# Optional full backend
cp apps/api/.env.example apps/api/.env
docker compose up -d
pnpm --filter @klasr/api prisma:migrate
pnpm --filter @klasr/api start:dev
```