# Klasr

## Analyse documentaire DSA

Le pipeline API Python (FastAPI + CrewAI + Docling) sépare extraction, analyse
structurée, décision de nom et décision de destination. Il fonctionne hors ligne
avec `KLASR_LLM_PROVIDER=local`. Pour un endpoint compatible OpenAI, renseigner
`KLASR_LLM_PROVIDER`, `KLASR_LLM_MODEL`, `KLASR_LLM_BASE_URL` et
`KLASR_LLM_API_KEY`; les modèles par agent peuvent être surchargés par les
variables `KLASR_AGENT_*_MODEL`. `ANTHROPIC_API_KEY` reste un repli de
compatibilité temporaire, pas le contrat du pipeline.

```bash
pnpm api:install
pnpm api:start
suggest_filename --file <chemin-fichier>
suggest_directory -f <chemin> -d '["/Comptabilite/Factures","/Juridique/Contrats"]'
```

La CLI n'affiche ni texte extrait ni clé. PDF, PNG, JPEG, TIFF et texte sont
pris en charge. Les formats Office entrent dans le flux mais demandent une
revue manuelle; leur extraction nécessitera une dépendance Python approuvée
et, si le périmètre l'exige, un ADR.

L'écran de réglages charge ses listes de modèles depuis
`KLASR_ANTHROPIC_MODELS`, `KLASR_OPENAI_MODELS`, `KLASR_MISTRAL_MODELS` et
`KLASR_COMPATIBLE_MODELS` (valeurs séparées par des virgules). Il valide le
format d'une clé puis l'oublie immédiatement; les traitements utilisent
exclusivement les variables d'environnement de l'API.

Klasr est un micro-SaaS de classement documentaire pour cabinets et professions
reglementees. Le flux reel est volontairement explicite :

1. connecter Google Drive ;
2. choisir un dossier Drive de reference ;
3. heriter de ses sous-dossiers comme destinations possibles ;
4. choisir un fichier Drive ou un dossier Drive existant a organiser ;
5. streamer les octets Drive vers l'OCR, produire une proposition de nom et de
   destination a partir d'un extrait representatif normalise, puis jeter les
   octets et le texte OCR ;
6. executer le renommage/deplacement uniquement apres `Valider`, `Corriger` ou
   `Retirer`.

## Prerequis

- Node.js 20 (compatible avec les versions pinnees du monorepo).
- `pnpm@10.15.1` exactement, comme declare dans `package.json`.
- Python 3.13+ pour le backend FastAPI (`apps/api-py`).
- Docker avec Compose v2.
- Chromium installe par Playwright si `pnpm test:e2e` le demande.

Toutes les commandes suivantes partent de la racine du depot :

```bash
cd /root/projects/klasr-oneshot/klasr-loop
pnpm install --frozen-lockfile
pnpm api:install
```

## Environnements locaux

Copier les exemples, puis remplacer uniquement les placeholders locaux. Ne
mettre aucun secret reel dans Git.

```bash
cp apps/api-py/.env.example apps/api-py/.env
cp apps/web/.env.example apps/web/.env.local
```

Valeurs a remplacer pour un developpement local complet :

- `INTERNAL_API_SECRET` : meme valeur jetable dans API et web.
- `TOKEN_ENCRYPTION_KEY` : 32 octets aleatoires encodes base64 ou 64 caracteres hex.
- `NEXTAUTH_SECRET` : valeur locale jetable.
- `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` : client OAuth Google Cloud requis.
- `DATABASE_URL` : PostgreSQL local.
- Variables LLM : choisir le fournisseur, le modèle et la clé dans les réglages,
  ou définir les variables `KLASR_LLM_*` décrites dans `.env.example`.

## Services locaux

PostgreSQL porte les donnees metier et la file de jobs (SKIP LOCKED, ADR-007).
La table PostgreSQL `analyses` contient les résultats dans un payload JSONB,
purgés à expiration par le worker. Le backend FastAPI
est `apps/api-py` (port 3001).

```bash
docker compose up -d --force-recreate --wait
docker compose ps
```

Cette commande démarre seulement PostgreSQL. Pour démarrer aussi l'API
(migrations Alembic et worker inline inclus), utiliser :

```bash
docker compose --profile api up -d --force-recreate --wait
```

Deployer les migrations Alembic :

```bash
pnpm api:migrate
```

Developpement applicatif :

```bash
pnpm api:start        # FastAPI (uvicorn, port 3001)
pnpm api:worker       # Worker Python (KLASR_WORKER=true)
pnpm --filter @klasr/web dev   # Next.js (port 3000)
```

L'application exige une connexion OAuth Google autorisée. Le worker doit être
lancé séparément avec `pnpm api:worker` en développement.

### Validation Google Drive réelle

Le runner d'acceptation démarre FastAPI, le worker Python et le web, puis suit
le parcours UI complet sur le fixture Drive partagé. Il refuse tout venv autre
que Python 3.13+ et ne doit être lancé que par un reviewer disposant des secrets :

```bash
KLASR_GOOGLE_SERVICE_ACCOUNT_FILE=/chemin/absolu/service-account.json \
KLASR_GOOGLE_DRIVE_ROOT_ID=... \
KLASR_LLM_PROVIDER=anthropic \
KLASR_LLM_MODEL=claude-haiku-4-5-20251001 \
KLASR_LLM_API_KEY=... \
KLASR_LLM_BASE_URL=... \
KLASR_EVIDENCE_SHA="$(git rev-parse HEAD)" \
KLASR_EVIDENCE_ISSUE=5 \
KLASR_EVIDENCE_ATTEMPT=... \
KLASR_EVIDENCE_TASK=t_... \
KLASR_LIVE_FIXTURE_MODE=borrowed-carrier \
pnpm test:live-google-sa
```

La base URL LLM est facultative pour les fournisseurs natifs. Le runner ne
crée aucun fichier ou dossier Drive : il emprunte les deux PDF staging existants,
épingle leurs révisions, utilise uniquement l'arborescence `stg_tree`, puis
restaure exactement octets, métadonnées et parents. Il ne journalise ni secrets,
ni contenu, ni identifiants Drive ; son manifeste assaini est écrit sous le
dossier de run `.tmp/hermes/ux-clarity/evidence/item-5/`. Le run réel n'est
pas exécuté par les checks locaux. `pnpm` doit être disponible pour lancer la
commande, mais le runner résout directement le binaire Next.js au démarrage.
Les captures plein écran peuvent contenir les noms des fixtures Drive : utiliser
uniquement des noms synthétiques non sensibles.

## OCR et qualite des suggestions

L'OCR (Docling) accepte PDF, PNG, JPEG et TIFF. Le contenu normalise est
transmis au pipeline CrewAI sans stockage intermediaire. Une extraction vide,
trop courte, corrompue ou non supportee cree une proposition visible « a
verifier » sans destination executable. Les propositions faibles ou ambigues
sont exclues de `Tout valider` jusqu'a correction explicite du nom et du
dossier. Les fournisseurs LLM doivent rendre un JSON borne : nom sur avec
extension preservee, destination existante, confiances entre 0 et 1. Toute
sortie inventee ou dangereuse est rejetee et retombe vers la revue manuelle.

## Configuration Google OAuth / Drive

Pour utiliser Klasr localement avec Google Drive réel :

1. Creer un projet Google Cloud.
2. Activer Google Drive API.
3. Configurer l'ecran de consentement OAuth.
4. Creer un client OAuth Web.
5. Ajouter l'URL de redirection NextAuth :
   `http://localhost:3000/api/auth/callback/google`.
6. Renseigner, avec des placeholders propres à l'environnement et jamais dans
   Git : `GOOGLE_CLIENT_ID=<identifiant-placeholder>`,
   `GOOGLE_CLIENT_SECRET=<secret-placeholder>`,
   `NEXTAUTH_URL=http://localhost:3000`,
   `NEXTAUTH_SECRET=<secret-placeholder>`,
   `API_URL=http://localhost:3001/api/v1`,
   `INTERNAL_API_SECRET=<secret-local-identique>` et
   `TOKEN_ENCRYPTION_KEY=<cle-placeholder>`.
7. Verifier que le scope Drive est autorise :
   `https://www.googleapis.com/auth/drive`.

Sans client OAuth Google et consentement utilisateur, aucun parcours Drive n'est
disponible. Aucun secret réel ne doit être ajouté au dépôt.

### Éligibilité et vérification Google réelle

Un PDF, PNG, JPEG ou TIFF peut être choisi partout, y compris sous la racine de
référence. Un dossier peut être choisi partout et ses descendants supportés sont
parcourus récursivement. La racine de référence elle-même est exclue. Les documents déjà
`PROPOSED`, `CLASSIFIED`, `MANUAL` ou `IGNORED` ne sont pas ré-enfilés. Les formats non
supportés, notamment XLSX, restent visibles et révisables avec « Non supporté » :
ils ne sont ni masqués ni envoyés à l'OCR, et aboutissent à une revue manuelle.

La preuve Google exige qu'un humain ouvre `/login` et réalise lui-même le
consentement. Il contrôle ensuite, sans copier de jeton ni de contenu : navigation
parent/pagination, racine et descendants, PDF synthétiques à la racine, libellé
XLSX, job PostgreSQL (SKIP LOCKED), statut OCR/proposition, validation inchangée,
correction de nom, correction de destination et action Ignorer. Il vérifie
uniquement les métadonnées sûres (identifiants, noms finaux, parents, statuts),
le non-réenfilage et le rendu bureau puis 390×844. Avant cette étape, l'état est
`NEEDS HUMAN`, jamais `PASS`.

Créer uniquement un dossier temporaire et des PDF/images synthétiques sans
donnée personnelle. Après la preuve, supprimer ces fixtures dans Drive et purger
leurs métadonnées de staging selon la procédure d'exploitation. Aucun compte,
cookie, jeton, texte OCR ou contenu ne doit figurer dans une capture, un log ou
un rapport.

## Script manuel de validation locale (ne prouve pas Google)

1. Demarrer PostgreSQL :
   `docker compose up -d --force-recreate --wait`.
2. Installer et migrer :
   `pnpm api:install && pnpm api:migrate`.
3. Demarrer API et web : `pnpm api:start` et `pnpm --filter @klasr/web dev`.
4. Ouvrir `http://localhost:3000/login`.
5. Cliquer `Mode local`.
6. Sur le dashboard, choisir `Cabinet de demonstration`.
7. Verifier l'affichage de branches imbriquees :
   `/Comptabilite/Banque`, `/Comptabilite/Electricite`, `/Social/Paie`.
8. Dans `Fichiers a organiser`, choisir `Dossier - A classer`.
9. Cliquer `Lancer l'organisation`.
10. Verifier plusieurs propositions, les badges de confiance, les cartes "a
    verifier" et `Tout valider` qui ignore ces cartes faibles.
11. Valider une proposition telle quelle.
12. Corriger un nom de fichier.
13. Corriger une destination avec le select de dossiers herites.
14. Ignorer une proposition.
15. Recharger : l'historique doit conserver les decisions ; les fichiers
    ignores restent à leur place et ne sont pas reenfiles.

## Checks automatises

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm api:install
pnpm api:migrate
pnpm api:test
pnpm api:lint
pnpm test:e2e
```

Si un workflow GitHub est modifie, executer aussi `actionlint`.

## Vie privee et persistance

- Les fichiers restent dans le Drive connecte.
- Les octets sont telecharges en streaming vers l'OCR, puis jetes.
- Le contenu documentaire et le texte OCR ne sont pas stockes dans PostgreSQL,
  les logs, les fixtures ou les preuves.
- PostgreSQL conserve les metadonnees : organisation, racine de reference,
  dossiers herites, documents, propositions, decisions, historique, confiances
  et raisons non sensibles de revue.
- La table PostgreSQL `analyses` conserve les résultats sans contenu documentaire ;
  le worker supprime les lignes dont `expires_at` est dépassé (30 jours par défaut).
- Aucun renommage ou deplacement n'est execute sans decision explicite.
- `Ignorer` écarte terminalement la proposition sans appel au fournisseur ni
  modification du fichier original.

## Arret et nettoyage

Arreter les services :

```bash
docker compose down
```

Supprimer les volumes locaux detruit toutes les donnees PostgreSQL :

```bash
docker compose down -v
```

## Documentation

- Architecture et ADR REAC : `docs/ARCHITECTURE.md`
- Workflow agentique : `docs/AGENT_LOOP_SPEC.md`
- Etat de boucle : `docs/STATE.md`
