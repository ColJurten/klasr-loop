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
