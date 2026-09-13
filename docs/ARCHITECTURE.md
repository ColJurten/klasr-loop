# Klasr — Architecture cible (pilotée par le REAC CDA, RNCP 37873)

## ADR — Séparation du pipeline de compréhension documentaire (2026-08-15)

Le chemin OCR est découpé en extraction typée, analyse structurée, décision de nom et décision de destination. Agents et tâches sont déclarés en YAML; chaque sortie traverse un schéma zod. Le fournisseur LLM est configurable et le mode local déterministe garantit des tests sans appel externe.

L'audit distingue cinq causes : formats/plafonds et normalisation côté extraction; texte brut et double décision côté contexte; chemins aplatis côté arborescence; validation combinée sans motif typé côté parsing; orchestration et persistance mêlées côté architecture. Les destinations utilisent une arborescence typée et toute réponse hors arborescence échoue fermée.

Les octets restent en mémoire entre le téléchargement Drive et l'extraction. Aucun texte, prompt ou résultat brut n'est persisté. Office produit l'avertissement `office_extractor_unavailable`; un extracteur TypeScript approuvé fera l'objet d'une décision ultérieure. REAC : C1, C2, C3, C4/C5, C6, C7/C8, C9, C10/C11.

> Principe directeur : **chaque technologie du stack doit être justifiée soit par une
> compétence du REAC, soit par une exigence produit. Tout le reste est supprimé.**
> Ce document est l'annexe d'architecture du dossier de projet ; chaque décision est
> tracée en ADR (Architecture Decision Record) pour l'entretien technique.

## 1. Vue d'ensemble

```
                    ┌──────────────────────────────────────────────┐
                    │                 apps/web                     │
                    │   Next.js 14 · TypeScript · Tailwind         │
                    │   NextAuth (OAuth Google / Microsoft)        │
                    └──────────────────┬───────────────────────────┘
                                       │ REST (JWT, scope organisation)
                    ┌──────────────────▼───────────────────────────┐
                    │                 apps/api                     │
                    │   FastAPI · Python — monolithe modulaire     │
                    │   Route → Service → Repository SQLAlchemy    │
                    │   ┌────────────────────────────────────────┐ │
                    │   │ Worker (même code, processus séparé)   │ │
                    │   │ table `jobs` PostgreSQL, SKIP LOCKED   │ │
                    │   │ sync → règles → dsa/ → proposition     │ │
                    │   │ dsa/ : CrewAI + Docling, appel direct  │ │
                    │   └────────────────────────────────────────┘ │
                    └───────┬──────────────────┬───────────────────┘
                            │ SQLAlchemy 2      │ driver Python MongoDB
                    ┌───────▼───────┐  ┌───────▼───────────────────┐
                    │  PostgreSQL   │  │  MongoDB (1 collection)   │
                    │  schéma métier│  │  `analyses` : métadonnées │
                    │  + `jobs`     │  │  OCR/LLM expurgées,       │
                    │  (Alembic)    │  │  index TTL (purge RGPD)   │
                    └───────────────┘  └───────────────────────────┘

   Externes : Google Drive (OAuth) · API LLM configurée (HTTPS)
   Hors périmètre : scripts/agent reste en Node.js.
   Invariant : les fichiers ne quittent JAMAIS le Drive de l'utilisateur.
```

Stack cible : **Next.js 14 côté web · FastAPI/Python côté API et traitement documentaire ·
PostgreSQL (SQLAlchemy 2/Alembic) · MongoDB (accès NoSQL ciblé) · Docker · GitHub Actions**.
Redis, MinIO, broker dédié, sidecar documentaire et saut HTTP interne sont absents.

> **État de migration.** Ce diagramme décrit la cible décidée. Jusqu'à la bascule de
> phase 3, NestJS/Prisma/pg-boss reste la référence exécutable ; il n'est supprimé
> qu'à cette phase, après le portage et les vérifications de parité.

## 1.1. MVP réel local et chemin Google

Le MVP réel relie désormais `/dashboard` à une couche BFF Next.js server-only :
le navigateur appelle uniquement des routes same-origin (`/api/sync`,
`/api/proposals/:id/confirm`) et ne choisit jamais `organizationId`. Les appels
Next → Nest utilisent `x-internal-secret`; les contrôleurs tenant-scoped du flux
MVP (`documents`, `proposals`, `sync`, `dashboard`) sont protégés par
`InternalServiceGuard`.

Google Drive est le premier connecteur de production : le refresh token est
chiffré en AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), l'access token est rafraîchi
côté serveur, l'arborescence est listée en métadonnées seulement, et les octets
du fichier sont consommés en stream par l'OCR puis jetés. La mutation Drive
(`PATCH files`) n'est appelée que depuis `ClassificationService.confirm()`, après
validation explicite. Microsoft reste authentification-only dans ce MVP.

Le mode `KLASR_LOCAL_MVP=true` est un simulateur d'arêtes externes
Google/OCR uniquement : Next.js, NestJS HTTP, PostgreSQL, MongoDB, Prisma,
repositories, services et pg-boss restent réels. Il refuse de démarrer en
production, comme `KLASR_INLINE_WORKER=true`.

Le pipeline OCR/document-understanding garde les octets en mémoire bornée
pendant l'analyse, privilégie la couche texte PDF native, OCR seulement les pages
qui en ont besoin, normalise le texte puis ne transmet qu'un extrait
représentatif au classement. Les sorties vides, corrompues, ambiguës ou faibles
créent une proposition de revue non bulk-applicable avec raisons et confiances
non sensibles ; aucun texte OCR, extrait documentaire ou octet n'est persisté.

## 2. ADR — décisions et justifications (à défendre devant le jury)

### ADR-001 — Un seul langage : TypeScript (suppression de Python/FastAPI)
**Contexte.** La conception initiale prévoyait un microservice Python pour l'OCR/LLM.
**Décision.** Tout le backend est en TypeScript dans NestJS.
**Justification.**
- Le REAC n'exige aucun polyglottisme ; il évalue la profondeur de la conception en
  couches et des composants métier — mieux démontrée dans UN écosystème maîtrisé.
- L'argument « écosystème IA Python » ne tient pas ici : Tesseract a des bindings
  Node (node-tesseract-ocr), et les SDK Anthropic/OpenAI sont natifs en TypeScript.
  Aucun besoin de NumPy/PyTorch — on appelle des API.
- Un langage = un pipeline CI, un jeu d'outils de test, moins de surface à défendre.
  À l'entretien, « pourquoi Python ? » devient un piège ; « TypeScript de bout en
  bout, typé du DTO au repository » est une force.
**Conséquence.** Le pipeline (pré-filtre → OCR → cascade LLM) devient un ensemble de
composants métier NestJS testés en Jest — il compte désormais POUR les compétences
C3/C6 au lieu d'exister à côté.

### ADR-002 — PostgreSQL source de vérité + MongoDB volontairement minimal
**Contexte.** « Pourquoi plusieurs bases ? » — question légitime.
**Décision.** PostgreSQL porte tout le modèle métier (14 modèles, Prisma). MongoDB est
réduit à UNE collection `analyses` (métadonnées d'analyse OCR/LLM redactées, schéma
variable selon le fournisseur, sans texte documentaire) avec index TTL.
**Justification.**
- La compétence 8 du REAC est explicite : *« Développer des composants d'accès aux
  données SQL **et NoSQL** »*. Sans NoSQL, cette compétence n'est pas démontrable.
- Le choix est honnête et assumé comme tel devant le jury : « MongoDB existe dans ce
  projet pour couvrir la compétence NoSQL du référentiel, sur un cas d'usage réel où
  le document store est pertinent : métadonnées d'analyse à schéma variable, purgées
  par TTL, sans contenu documentaire — exigence RGPD et éco-conception ».
- Surface minimale : un repository, une collection, zéro relation.
**Alternative rejetée.** JSONB dans PostgreSQL : techniquement suffisant, mais la
démonstration de la compétence NoSQL devient discutable devant un jury.

### ADR-003 — Suppression de MinIO
**Contexte.** MinIO servait de « transit temporaire » des fichiers.
**Décision.** Supprimé. Les octets sont streamés depuis l'API Drive vers l'étape OCR
(mémoire / répertoire temporaire du worker) puis jetés immédiatement.
**Justification.**
- Le transit objet **contredisait la promesse produit** : « Vos documents ne quittent
  jamais votre Drive ». Sans MinIO, la phrase devient architecturalement vraie.
- Moins de données au repos = dossier RGPD plus simple (pas de chiffrement at-rest à
  justifier pour un stockage intermédiaire).
- Un service de moins à opérer, monitorer, sécuriser.

### ADR-004 — File de jobs : pg-boss sur PostgreSQL (suppression de Redis/BullMQ)
**Contexte.** BullMQ imposait Redis, un troisième datastore.
**Décision.** pg-boss : file de jobs transactionnelle sur PostgreSQL.
**Justification.**
- Le traitement asynchrone (compétence « composants métier », architecture en
  couches) est démontré à l'identique : API publie un job, un processus worker le
  consomme. Le jury évalue le découplage, pas le broker.
- À l'échelle CDA (~100 docs/mois/client), PostgreSQL absorbe la charge sans effort ;
  jobs et données métier partagent les transactions (exactly-once simple).
- Chemin d'évolution documenté : si le volume l'exige un jour, l'interface de queue
  est isolée derrière un port — BullMQ/Redis devient un adaptateur de plus.
**Conséquence.** Le cache Redis disparaît aussi : aucun besoin démontré, et le cache
n'est pas une compétence REAC. YAGNI documenté.

### ADR-005 — Monolithe modulaire NestJS + worker (pas de microservices)
Un seul codebase, deux processus (API HTTP / worker jobs) construits depuis la même
image Docker avec deux entrypoints. Démontre « application organisée en couches »
et le traitement réparti sans le coût opérationnel des microservices — coût
indéfendable pour un développeur seul devant un jury.

### ADR-006 — Déploiement : Docker Compose pour la démo, manifests K8s en bonus
CCP3 exige de préparer, documenter et automatiser le déploiement — pas d'opérer un
cluster. Compose suffit pour la soutenance ; les manifests Kubernetes (force DevOps
de Louis) sont un différenciateur présenté en ouverture, pas une dépendance de démo.
CI GitHub Actions (équivalence GitLab CI documentée dans BRANCHING.md).

### ADR-007 — Backend Python unique et migration sans rupture (2026-09-13)

**Statut.** Acceptée pour la cible ; ADR-001, ADR-004 et ADR-005 sont remplacées à
la bascule de phase 3. Avant cette bascule, elles continuent de décrire le système
exécuté.

**Contexte.** Le backend mélange aujourd'hui la logique métier NestJS et un besoin
de traitement documentaire porté nativement par l'écosystème Python : CrewAI,
Docling et, plus largement, les outils LLM. Maintenir un pont entre les deux coûte
plus qu'il n'apporte : modèles, validation et tests dupliqués, frontière de
sérialisation fragile et deux chaînes de dépendances pour une seule équipe.

**Décision de stack unique.** FastAPI/Python remplace entièrement NestJS. Le pipeline
CrewAI + Docling devient le module `apps/api/src/dsa/` du même backend Python : ni
sidecar ni appel HTTP interne. `apps/web` reste en Next.js, sans changement de stack
ni de design system. `scripts/agent` reste en Node.js et hors périmètre. NestJS ne
sera pas laissé dormant : ses sources seront supprimées à la phase 3.

**File de travaux.** `pg-boss` étant réservé à Node.js, il est remplacé sur
l'instance PostgreSQL existante par une table minimale `jobs`, consommée avec
SQLAlchemy et `SELECT ... FOR UPDATE SKIP LOCKED`. Aucun Redis, broker ou dépendance
de file supplémentaire n'est introduit.

- Planification : une insertion SQL crée le travail `analysis` et sa date
  d'exécution.
- Reprise : `retryLimit = 2` est conservé ; après un échec, le travail redevient
  immédiatement disponible, comme avec les valeurs pg-boss actuelles
  (`retry_delay = 0`, `retry_backoff = false`), puis passe à l'état `failed` après
  deux reprises.
- Déduplication : le pg-boss actuel ne déduplique pas les envois, car
  `singletonKey` est utilisé sans politique singleton. La cible introduit
  délibérément une déduplication limitée aux états `queued`, `ready` et `active`,
  par index unique partiel sur `organisation:document` : elle bloque les doublons
  simultanés, mais libère la clé à la fin du travail afin qu'une synchronisation
  Drive puisse réanalyser un document terminé.
- Bail : la table porte `leased_until`. Lorsqu'un worker réclame un travail, il le
  passe à `active`, fixe ce bail à 15 minutes et le prolonge pendant le traitement.
  Un reaper remet immédiatement à `ready` tout travail dont le bail a expiré, pour
  reproduire la récupération des travaux actifs expirés de pg-boss.
- Observation : les agrégats d'état (`queued`, `ready`, `active`, `failed`),
  `inlineWorker`, `consuming` et le nombre d'analyses échouées par organisation
  conservent la parité fonctionnelle
  avec `queueState()` et `failedAnalysisCount()` de
  `apps/api/src/jobs/jobs.service.ts`.

**ORM et migrations.** SQLAlchemy 2 et Alembic ciblent le **même schéma** et la
même base PostgreSQL. La révision Alembic initiale reproduit exactement le schéma
Prisma courant — ses 14 modèles, ses 8 enums, contraintes, index et
relations. Elle adopte les tables déjà présentes : aucune table métier n'est
supprimée ou recréée et aucune donnée n'est perdue. Au cutover seulement, les tables
`pgboss` sont remplacées par `jobs` ; elles ne sont pas conservées comme seconde
file active.

**Google OAuth et Drive.** Le port utilise les bibliothèques officielles
`google-auth` et `google-api-python-client`. Le stockage chiffré du jeton de
rafraîchissement, son renouvellement serveur, les scopes, la révocation et les
erreurs gardent le même comportement. Les identifiants et jetons restent dans les
modules `auth`/`drive` : aucun credential n'entre dans `dsa/`, qui ne reçoit que le
flux documentaire nécessaire et les paramètres métier non secrets.

**Migration et retour arrière.** Chaque phase produit un commit isolé sur la branche
de migration. Jusqu'à la phase 3, le backend NestJS reste runnable. La bascule de
phase 3 branche le web sur FastAPI puis supprime NestJS ; le retour arrière consiste
à appliquer `git revert` aux commits de phase concernés, dans l'ordre inverse. Il
n'exige ni restauration de tables métier ni perte de données métier. La suppression
de l'historique `pgboss.job`, conservé 14 jours aujourd'hui, remet toutefois à zéro
le compteur `analysisFailures` du dashboard ; cette perte d'observabilité temporaire
est une conséquence acceptée du cutover.

**Impact REAC et continuité des preuves.** Les contrats HTTP, scénarios, migrations,
tests et traces d'exploitation sont portés, pas abandonnés : les preuves présentées
au jury survivent à la migration.

| Compétence | Emplacement NestJS / actuel | Emplacement Python / cible |
|---|---|---|
| C1 — environnement | `apps/api/package.json`, `docker-compose.yml`, `docs/BOOTSTRAP.md` | `apps/api/pyproject.toml`, mêmes Compose et documentation |
| C2 — interfaces | `apps/web` consommant l'API NestJS | `apps/web` inchangé, consommant FastAPI |
| C3 — composants métier | `apps/api/src/classification`, `apps/api/src/analysis` | `apps/api/src/classification`, `apps/api/src/dsa` |
| C4 — gestion de projet | commits, issues et phases de migration | mêmes preuves, commits par phase et handoffs |
| C5 — besoins et maquettage | wireframes, `PROMPT_DESIGN_KLASR.md`, personas | mêmes wireframes, prompt de design et personas |
| C6 — architecture | modules NestJS et Jest | modules FastAPI, ADR et pytest |
| C7 — base relationnelle | `apps/api/prisma/schema.prisma`, migrations Prisma | `apps/api/src/db`, modèles SQLAlchemy 2, révisions Alembic |
| C8 — accès SQL/NoSQL | repositories Prisma, `apps/api/src/analyses` MongoDB | repositories SQLAlchemy, `apps/api/src/analyses` MongoDB TTL |
| C9 — tests | spécifications Jest API, Vitest web | pytest API, Vitest web et tests de parité |
| C10 — déploiement | Dockerfile NestJS, Compose, CI | Dockerfile FastAPI, mêmes Compose et CI adaptés |
| C11 — DevOps | workflows, santé API, états pg-boss | workflows, santé API, états `jobs` et compteurs d'échec |

**Conséquences.** Une seule chaîne backend porte désormais les contrats, la logique
métier et le document-AI. Le coût est un portage contrôlé des routes et tests ; il
est borné par les phases, la coexistence temporaire avant bascule et le retour
arrière par commit.

## 3. Cartographie REAC → artefacts du dépôt

| # | Compétence (REAC CDA) | Preuve dans Klasr |
|---|---|---|
| C1 | Installer et configurer son environnement de travail | `docs/BOOTSTRAP.md`, `docker-compose.yml`, `.env.example`, monorepo outillé |
| C2 | Développer des interfaces utilisateur | `apps/web` : Next.js 14, charte Klasr, flux de validation 1-clic, accessibilité (RGAA : focus visible, navigation clavier) |
| C3 | Développer des composants métier | `apps/api/src/classification` : pipeline pré-filtre → OCR → cascade LLM, port `DriveExecutor`, transaction de confirmation |
| C4 | Contribuer à la gestion d'un projet informatique | Issues GitHub, `docs/STATE.md`, branching GitFlow, PR templates, boucle de triage |
| C5 | Analyser les besoins et maquetter une application | Wireframes Claude Design/Figma, `PROMPT_DESIGN_KLASR.md`, personas, dossier de conception |
| C6 | Définir l'architecture logicielle | Ce document (ADR), couches NestJS strictes, diagrammes |
| C7 | Concevoir et mettre en place une base de données relationnelle | `apps/api/prisma/schema.prisma` (14 modèles), migrations, MCD dans le dossier |
| C8 | Développer des composants d'accès aux données SQL et NoSQL | Repositories Prisma (SQL) + `apps/api/src/analyses` (MongoDB, TTL) |
| C9 | Préparer et exécuter les plans de tests | Jest (unités API), Vitest/Testing Library (web), plan de tests documenté, suites d'isolation multi-tenant |
| C10 | Préparer et documenter le déploiement | Dockerfiles, `docs/BOOTSTRAP.md`, `docs/BRANCHING.md` (releases SemVer), images ghcr |
| C11 | Contribuer à la mise en production dans une démarche DevOps | `.github/workflows/*` (CI lint/test/build, release taguée), gate SonarQube, monitoring en backlog |

Transverses évaluées : **sécurité** (OAuth, JWT, scoping organisationnel structurel,
défense anti-injection de prompt sur le texte OCR), **RGPD** (métadonnées seules en
base, TTL Mongo, pas de contenu dans les logs), **éco-conception** (pré-filtre avant
LLM, cascade du modèle le moins coûteux, compteur `llmCallsUsed`, entité UsageMetric).

## 4. Ce que le jury peut attaquer — réponses préparées

- *« Un monolithe, ce n'est pas une architecture en couches répartie ? »* — Si :
  frontend, API, worker et deux datastores sont des processus distincts communiquant
  par contrats (REST, jobs, repositories). La répartition est fonctionnelle, pas
  organisationnelle.
- *« Pourquoi pas de cache ? »* — Aucune mesure ne le justifie (UF : 1 doc < 10 s,
  100 docs/mois). Ajouter un composant sans besoin mesuré contredit l'éco-conception.
- *« MongoDB pour une collection, c'est artificiel ? »* — C'est un choix de
  certification assumé, posé sur le cas d'usage où un document store est réellement
  le bon outil du projet.
