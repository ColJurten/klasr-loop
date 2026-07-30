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


# MVP local reproductible

```bash
cd /root/projects/klasr-oneshot/klasr-loop
export PNPM_HOME=/root/.local/share/pnpm
export PATH="$PNPM_HOME:$PATH"
pnpm install --frozen-lockfile

# Démo fictive, explicitement hors MVP réel
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @klasr/web dev
# ouvrir http://localhost:3000/demo

# MVP local complet : Next.js + NestJS + PostgreSQL + MongoDB + pg-boss
cp apps/api/.env.example apps/api/.env
# Copier aussi apps/web/.env.example vers apps/web/.env.local, remplacer les
# placeholders locaux, puis activer KLASR_LOCAL_MVP=true,
# KLASR_INLINE_WORKER=true et NEXT_PUBLIC_KLASR_LOCAL_MVP=true.
docker compose up -d --wait
pnpm --filter @klasr/api prisma:migrate
pnpm test:integration
pnpm test:e2e
```

En production, `KLASR_LOCAL_MVP=true` et `KLASR_INLINE_WORKER=true` refusent
de démarrer. Le chemin réel Google chiffre le refresh token avec AES-256-GCM,
liste uniquement les métadonnées Drive, stream les octets vers l'OCR, puis les
écarte. Le déplacement/renommage Drive ne passe que par la confirmation
explicite de l'utilisateur. OneDrive reste authentification-only pour ce MVP.
