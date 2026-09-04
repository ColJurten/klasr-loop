# Klasr

## Analyse documentaire DSA

Le pipeline API sépare extraction, analyse structurée, décision de nom et décision de destination. Il fonctionne hors ligne avec `KLASR_LLM_PROVIDER=local`. Pour un endpoint compatible OpenAI, renseigner `KLASR_LLM_PROVIDER`, `KLASR_LLM_MODEL`, `KLASR_LLM_BASE_URL` et `KLASR_LLM_API_KEY`; les modèles par agent peuvent être surchargés par les variables `KLASR_AGENT_*_MODEL`. `ANTHROPIC_API_KEY` reste un repli de compatibilité temporaire, pas le contrat du pipeline.

```bash
pnpm install
pnpm dsa:filename --file apps/api/test/fixtures/synthetic-invoice.txt
pnpm dsa:destination --file apps/api/test/fixtures/synthetic-invoice.txt --dir /Comptabilite/Factures --dir /Juridique/Contrats
```

La CLI n'affiche ni texte extrait ni clé. PDF, PNG, JPEG, TIFF et texte sont pris en charge. Les formats Office entrent dans le flux mais demandent une revue manuelle; leur extraction nécessitera une dépendance TypeScript approuvée et, si le périmètre l'exige, un ADR.

L’écran de réglages charge ses listes de modèles depuis `KLASR_ANTHROPIC_MODELS`, `KLASR_OPENAI_MODELS`, `KLASR_MISTRAL_MODELS` et `KLASR_COMPATIBLE_MODELS` (valeurs séparées par des virgules). Il valide le format d’une clé puis l’oublie immédiatement; les traitements utilisent exclusivement les variables d’environnement de l’API.

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

`/demo` est une maquette fictive. Elle ne prouve ni Google Drive ni le flux de
production. Les tests unitaires prouvent les contrats isolés ; l'adaptateur
local prouve une régression intégrée sans fournisseur ; seule une vérification
humaine authentifiée prouve le chemin Google réel.

## Prerequis

- Node.js compatible avec les versions pinnees du monorepo.
- `pnpm@10.15.1` exactement, comme declare dans `package.json`.
- Docker avec Compose v2.
- Chromium installe par Playwright si `pnpm test:e2e` le demande.

Toutes les commandes suivantes partent de la racine du depot :

```bash
cd /root/projects/klasr-oneshot/klasr-loop
pnpm install --frozen-lockfile
```

## Environnements locaux

Copier les exemples, puis remplacer uniquement les placeholders locaux. Ne
mettre aucun secret reel dans Git.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Valeurs a remplacer pour un developpement local complet :

- `INTERNAL_API_SECRET` : meme valeur jetable dans API et web.
- `TOKEN_ENCRYPTION_KEY` : 32 octets aleatoires encodes base64 ou 64 caracteres hex.
- `NEXTAUTH_SECRET` : valeur locale jetable.
- `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` : seulement pour tester OAuth Google reel.

Pour le mode local sans identifiants externes, activer :

```dotenv
KLASR_LOCAL_MVP=true
KLASR_INLINE_WORKER=true
NEXT_PUBLIC_KLASR_LOCAL_MVP=true
```

## Services locaux

PostgreSQL porte les donnees metier et pg-boss. MongoDB contient uniquement la
collection TTL `analyses`.

```bash
docker compose up -d --force-recreate --wait
docker compose ps
```

Deployer Prisma non-interactivement :

```bash
pnpm --filter @klasr/api prisma:generate
pnpm --filter @klasr/api prisma:deploy
```

Developpement applicatif :

```bash
pnpm --filter @klasr/api start:dev
pnpm --filter @klasr/api worker:dev
pnpm --filter @klasr/web dev
```

En mode local avec `KLASR_INLINE_WORKER=true`, le worker se lance dans l'API et
`worker:dev` n'est pas necessaire.

## Validation locale sans credentials (preuve de régression locale)

Chemin le plus simple :

```bash
docker compose up -d --force-recreate --wait
pnpm --filter @klasr/api prisma:generate
pnpm --filter @klasr/api prisma:deploy
pnpm test:integration
pnpm test:e2e
```

`pnpm test:integration` lance NestJS sur loopback avec un Drive local
deterministe : `Cabinet de demonstration` comme racine, une arborescence
destination, un dossier separe `A classer`, des fichiers supportes et un fichier
non supporte. Aucun token OAuth reel ni document reel n'est utilise.

## OCR et qualite des suggestions

L'OCR accepte PDF, PNG, JPEG et TIFF. Les PDF natifs utilisent d'abord la couche
texte `pdfjs-dist`; seules les pages sans texte utile sont rasterisees puis lues
par Tesseract (`fra+eng`). L'adaptateur borne l'entree a 20 MiB, analyse au plus
20 pages par PDF et transmet au classement un contenu normalise et representatif
(debut/milieu/fin), jamais un simple debut de document.

Une extraction vide, trop courte, corrompue ou non supportee cree une proposition
visible "a verifier" sans destination executable. Les propositions faibles ou
ambigues sont exclues de `Tout valider` jusqu'a correction explicite du nom et
du dossier. Les fournisseurs LLM doivent rendre un JSON borne : nom sur avec
extension preservee, destination existante, confiances entre 0 et 1. Toute sortie
inventee ou dangereuse est rejetee et retombe vers la revue manuelle.

## Configuration Google OAuth / Drive

Pour tester Google Drive reel :

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

Frontiere connue : sans credentials Google fournis par l'evaluateur, le depot ne
peut pas executer une operation sur un Drive de production. Le mode local couvre
le meme contrat applicatif sans OAuth externe.

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
XLSX, job pg-boss, statut OCR/proposition, validation inchangée, correction de
nom, correction de destination et action Ignorer. Il vérifie uniquement les métadonnées
sûres (identifiants, noms finaux, parents, statuts), le non-réenfilage et le rendu
bureau puis 390×844. Avant cette étape, l'état est `NEEDS HUMAN`, jamais `PASS`.

Créer uniquement un dossier temporaire et des PDF/images synthétiques sans
donnée personnelle. Après la preuve, supprimer ces fixtures dans Drive et purger
leurs métadonnées de staging selon la procédure d'exploitation. Aucun compte,
cookie, jeton, texte OCR ou contenu ne doit figurer dans une capture, un log ou
un rapport.

## Script manuel de validation locale (ne prouve pas Google)

1. Demarrer PostgreSQL et MongoDB :
   `docker compose up -d --force-recreate --wait`.
2. Deployer les migrations :
   `pnpm --filter @klasr/api prisma:deploy`.
3. Demarrer API et web en mode local.
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
docker compose up -d --force-recreate --wait
pnpm --filter @klasr/api prisma:generate
pnpm --filter @klasr/api prisma:deploy
pnpm test:integration
pnpm test:e2e
```

Si un workflow GitHub est modifie, executer aussi `actionlint`.

## Vie privee et persistance

- Les fichiers restent dans le Drive connecte.
- Les octets sont telecharges en streaming vers l'OCR, puis jetes.
- Le contenu documentaire et le texte OCR ne sont pas stockes dans PostgreSQL,
  MongoDB, les logs, les fixtures ou les preuves.
- PostgreSQL conserve les metadonnees : organisation, racine de reference,
  dossiers herites, documents, propositions, decisions, historique, confiances
  et raisons non sensibles de revue.
- MongoDB conserve uniquement la collection TTL `analyses`, avec metadonnees
  d'analyse redactees.
- Aucun renommage ou deplacement n'est execute sans decision explicite.
- `Ignorer` écarte terminalement la proposition sans appel au fournisseur ni
  modification du fichier original.

## Arret et nettoyage

Arreter les services :

```bash
docker compose down
```

Supprimer les volumes locaux detruit toutes les donnees PostgreSQL et MongoDB :

```bash
docker compose down -v
```

## Documentation

- Architecture et ADR REAC : `docs/ARCHITECTURE.md`
- Workflow agentique : `docs/AGENT_LOOP_SPEC.md`
- Etat de boucle : `docs/STATE.md`
