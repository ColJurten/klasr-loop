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
                    │   NestJS — monolithe modulaire en couches    │
                    │   Controller → Service → Repository          │
                    │   ┌────────────────────────────────────────┐ │
                    │   │ Worker (même code, 2e processus)       │ │
                    │   │ file de jobs pg-boss :                 │ │
                    │   │ sync Drive → pré-filtre règles → OCR   │ │
                    │   │ (tesseract) → cascade LLM → proposition│ │
                    │   └────────────────────────────────────────┘ │
                    └───────┬──────────────────┬───────────────────┘
                            │ Prisma           │ driver MongoDB
                    ┌───────▼───────┐  ┌───────▼───────────────────┐
                    │  PostgreSQL   │  │  MongoDB (1 collection)   │
                    │  12 entités   │  │  `analyses` : métadonnées │
                    │  + file jobs  │  │  OCR/LLM redactées,       │
                    │  (pg-boss)    │  │  index TTL (purge RGPD)   │
                    └───────────────┘  └───────────────────────────┘

   Externes : Google Drive / Microsoft Graph API (OAuth) · API Anthropic/OpenAI (HTTPS)
   Invariant : les fichiers ne quittent JAMAIS le Drive de l'utilisateur.
```

Stack final : **TypeScript partout · Next.js 14 · NestJS · PostgreSQL (Prisma) ·
MongoDB (accès NoSQL ciblé) · pg-boss · Docker · GitHub Actions**.
Supprimés par rapport à la conception initiale : **Python/FastAPI, Redis, MinIO**.

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
**Décision.** PostgreSQL porte tout le modèle métier (12 entités, Prisma). MongoDB est
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

## 3. Cartographie REAC → artefacts du dépôt

| # | Compétence (REAC CDA) | Preuve dans Klasr |
|---|---|---|
| C1 | Installer et configurer son environnement de travail | `docs/BOOTSTRAP.md`, `docker-compose.yml`, `.env.example`, monorepo outillé |
| C2 | Développer des interfaces utilisateur | `apps/web` : Next.js 14, charte Klasr, flux de validation 1-clic, accessibilité (RGAA : focus visible, navigation clavier) |
| C3 | Développer des composants métier | `apps/api/src/classification` : pipeline pré-filtre → OCR → cascade LLM, port `DriveExecutor`, transaction de confirmation |
| C4 | Contribuer à la gestion d'un projet informatique | Issues GitHub, `docs/STATE.md`, branching GitFlow, PR templates, boucle de triage |
| C5 | Analyser les besoins et maquetter une application | Wireframes Claude Design/Figma, `PROMPT_DESIGN_KLASR.md`, personas, dossier de conception |
| C6 | Définir l'architecture logicielle | Ce document (ADR), couches NestJS strictes, diagrammes |
| C7 | Concevoir et mettre en place une base de données relationnelle | `apps/api/prisma/schema.prisma` (12 entités), migrations, MCD dans le dossier |
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
