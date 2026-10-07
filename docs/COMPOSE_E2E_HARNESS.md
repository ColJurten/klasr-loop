# Contrat unique du harnais E2E Docker Compose

Ce document est prescriptif. Les seuls points d'entrée sont
`apps/e2e/scripts/e2e-up.sh` et `apps/e2e/scripts/e2e-down.sh`. Ne pas appeler
Compose directement et ne pas utiliser `scripts/live-google-service-account.mjs`.

## Fichier local `.hosttest`

Créer `.hosttest` à la racine. `.gitignore` exclut `.hosttest*` et
`.hosttest/`; ce fichier ne doit jamais être copié dans une preuve ou commité.
Il contient uniquement des affectations shell `NOM=valeur` (guillemets requis
si une valeur contient des caractères interprétés par Bash) :

```sh
INTERNAL_API_SECRET='...'
TOKEN_ENCRYPTION_KEY='...'
NEXTAUTH_SECRET='...'
KLASR_GOOGLE_DRIVE_ROOT_ID='...'
KLASR_SA_FILE_OVERRIDE='/chemin/absolu/hors-depot/service-account.json'
KLASR_GOOGLE_SERVICE_ACCOUNT_FILE='/chemin/absolu/hors-depot/service-account.json'
KLASR_LLM_API_KEY='...'
KLASR_LLM_MODEL='claude-haiku-4-5-20251001'
KLASR_E2E_PROBE='apps/e2e/scripts/probe.mjs'
KLASR_LOCAL_MVP=false
```

`KLASR_SA_FILE_OVERRIDE` est le chemin hôte monté en lecture seule dans les
conteneurs. `KLASR_GOOGLE_SERVICE_ACCOUNT_FILE` est le même chemin hôte lu par
le probe. `KLASR_LLM_MODEL` contient le nom nu du modèle (par exemple
`claude-haiku-4-5-20251001`) ; le fournisseur est sélectionné séparément dans
l'interface. Aucun secret n'est écrit dans le template ou dans l'override rendu.
Le launcher refuse de démarrer si un secret requis ou le chemin du compte de
service est vide, et force le mode `0600` sur le fichier d'environnement.

## Démarrage et probe

Le template versionné `docs/e2e/docker-compose.e2e.yml` est l'unique overlay.
Le launcher charge `.hosttest`, force les deux flags d'acceptation à `true`,
rend l'overlay sous `.tmp/hermes/compose-e2e/`, construit et démarre le projet
`klasr-e2e`, puis attend `http://127.0.0.1:3101/api/v1/health`. Les ports sont
fixés à web `3100`, API `3101`, MongoDB `27018` et PostgreSQL `55432`.

```sh
apps/e2e/scripts/e2e-up.sh
```

Exécuter ensuite exactement la ligne imprimée par le launcher :

```sh
set -a; source .hosttest; set +a; node "$KLASR_E2E_PROBE"
```

`KLASR_E2E_PROBE` désigne par défaut le probe versionné
`apps/e2e/scripts/probe.mjs`. Ce fichier reste la source unique du parcours
navigateur : ne pas recopier son flux dans un launcher. Pour inspecter
l'overlay sans Docker :

```sh
apps/e2e/scripts/e2e-up.sh --dry-run
```

La gate de sanity des launchers (substitution fermée et ports isolés) fait
partie de `pnpm test` et peut aussi être lancée seule :

```sh
apps/e2e/scripts/e2e-launchers.test.sh
```

## Vérification du log de qualité du premier passage

Après avoir placé un PDF de test dans `.tmp/hermes/SINGLE-STACK-RUN/doc3.pdf`,
vérifier dans l'image du worker que l'extraction DSA produit bien le log INFO :

```sh
docker compose --profile api build api
docker compose --profile api run --rm --no-deps -v "$PWD/.tmp/hermes/SINGLE-STACK-RUN/doc3.pdf:/tmp/doc3.pdf:ro" worker python -c 'from services.analysis import extract_memory; from worker import configure_logging, log_first_pass; configure_logging(); result = extract_memory(open("/tmp/doc3.pdf", "rb").read(), "application/pdf", "doc3.pdf"); log_first_pass("container-check", (result.first_pass_quality, result.first_pass_text_chars, result.first_pass_md_chars, result.ocr_pass))'
```

La sortie doit contenir `analysis[container-check] first_pass quality=`.

## Restauration et teardown obligatoires

Avant toute mutation, `probe.mjs` doit relever l'identifiant, le nom et les
parents du fichier Drive. Son bloc de finalisation doit restaurer exactement
ces valeurs et supprimer les données applicatives du tenant de test. Une
interruption ou un échec n'annule jamais cette obligation : terminer ou
reprendre la restauration avant le teardown.

Après vérification de la restauration, exécuter :

```sh
apps/e2e/scripts/e2e-down.sh
```

Ce script lance `down --volumes --remove-orphans`, refuse de réussir si un
conteneur du projet subsiste, puis vérifie que les quatre ports décalés sont
libres. Les preuves expurgées vont sous `.tmp/hermes/`; elles ne doivent
contenir ni `.hosttest`, ni jeton, ni clé privée, ni document client.
