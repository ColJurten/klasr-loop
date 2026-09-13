# Handoff — phase 1 SINGLE-STACK-PY

## Résultat

Le squelette FastAPI, le module DSA, les 14 modèles Prisma/8 enums SQLAlchemy,
la migration Alembic d'adoption, l'accès MongoDB `analyses` et la file SQL `jobs`
sont créés dans `apps/api-py`. Aucun routeur de phase 2 n'a été ajouté.

`apps/api` reste le backend NestJS intact et exécutable. Le répertoire Python est
volontairement provisoire : il sera déplacé vers `apps/api` à la phase 3, au moment
où NestJS sera supprimé.

## Fichiers modifiés

- `apps/api-py/pyproject.toml`, `Dockerfile`, `.env.example`, configurations qualité.
- `apps/api-py/src/main.py`, `core/`, `db/`, `mongo/`, `jobs/`, `dsa/`.
- `apps/api-py/alembic/` et révision initiale `20260913_0001`.
- `apps/api-py/tests/` et `apps/api-py/README.md`.
- `package.json` : wrappers pnpm `api:install`, `api:test`, `api:lint`, `api:migrate`.

## Versions épinglées et vérifiées par pip

- fastapi 0.141.1; uvicorn 0.52.4; pydantic 2.12.5;
  pydantic-settings 2.15.0; sqlalchemy 2.0.52; alembic 1.20.0.
- crewai 1.15.21; crewai-tools 1.15.21; docling 2.126.0; psycopg 3.2.10.
- google-auth 2.58.0; google-api-python-client 2.200.0.
- motor 3.7.1; pymongo 4.18.1; httpx 0.28.1;
  python-multipart 0.0.32.
- pytest 9.1.1; pytest-asyncio 1.4.0; black 26.5.1; flake8 7.3.0.

## Commandes et contrôles

- `python3 -m venv apps/api-py/.venv` : PASS (après installation système de
  `python3.12-venv`, absent de l'image de travail).
- `apps/api-py/.venv/bin/pip install -e 'apps/api-py[dev]'` : PASS.
- `KLASR_DATABASE_URL=sqlite:////tmp/... apps/api-py/.venv/bin/alembic upgrade head` :
  PASS, 14 tables métier + `jobs` + `alembic_version`.
- `KLASR_DATABASE_URL=postgresql+psycopg://... alembic upgrade head` sur une base
  PostgreSQL 16 jetable : PASS, 16 tables dont `alembic_version`, 8 enums Prisma.
- `pnpm api:test` : PASS, 21 tests, appels LLM réels : 0.
- `pnpm api:lint` : PASS (`black --check`, `flake8`).
- `pnpm --filter @klasr/api build` : PASS, NestJS reste runnable.
- `docker build -t klasr-api-py-phase1 apps/api-py` : PASS.

SQLite est choisi pour le contrôle autonome de migration, faute de PostgreSQL de test
jetable. Les variantes PostgreSQL `TEXT[]`, `JSONB`, enums natifs et `TIMESTAMP(3)`
sont définies dans les modèles.

CrewAI 1.15.21 expose `Crew(tracing=False)`, appliqué aux trois crews. Les variables
`CREWAI_DISABLE_TELEMETRY=true` et `OTEL_SDK_DISABLED=true` sont aussi écrasées
avant l'import : tracing et télémétrie restent deux invariants distincts.

## Invariants

- Aucun octet/texte documentaire n'est journalisé ni persisté ; les temporaires
  `NamedTemporaryFile` sont supprimés en `finally`.
- MongoDB refuse tout champ hors métadonnées et pose son index TTL.
- Les tâches n'ont aucun `output_file`; le verbose est désactivé par défaut et forcé
  à faux en conteneur; les sorties CLI sont des objets Pydantic JSON validés.
- Les descriptions CrewAI rendent explicitement le contenu extrait et, pour le
  classement, chaque chemin candidat; les agents ne reçoivent jamais les octets.
- Une destination absente de l'arborescence fournie échoue fermée.

## REAC

- C1 : environnement Python épinglé et wrappers pnpm.
- C3/C6 : composant métier DSA et architecture FastAPI/worker modulaire.
- C7 : modèles relationnels et migration Alembic.
- C8 : accès SQLAlchemy et MongoDB metadata-only avec TTL.
- C9 : tests pytest déterministes avec un faux `BaseLLM` exécutant réellement les crews,
  le rendu YAML et la validation Pydantic.
- C10/C11 : Dockerfile, santé, migration et commandes uniformes.

## Compromis connus

- Audit de migration exécuté sur SQLite autonome, pas sur PostgreSQL : la parité
  PostgreSQL devra être rejouée avec la base d'intégration disponible avant cutover.
- La concurrence PostgreSQL (`SKIP LOCKED`, index unique partiel) reste non couverte
  par SQLite et exige un test d'intégration PostgreSQL avant cutover.
- `inline_worker` et `consuming` sont des indicateurs de phase 2 fournis au constructeur,
  pas encore dérivés d'un worker actif. La garde NestJS interdisant
  `KLASR_INLINE_WORKER` en production sera portée avec le worker en phase 2.
- Les identifiants Python utilisent `uuid4().hex` plutôt que les `cuid()` Prisma : choix
  accepté pour éviter une dépendance; les deux restent des chaînes uniques opaques.
- Les avertissements de dépréciation TestClient/Alembic proviennent des versions
  épinglées et n'affectent pas les contrôles.
- Vérification UI non applicable : aucune interface n'est modifiée en phase 1.

Mode Codex utilisé : session de construction directe (pas de `/goal` persistant).
