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
KLASR_LLM_MODEL='...'
KLASR_E2E_PROBE='.tmp/hermes/ux-clarity/evidence/item-21/compose-e2e/head-e2e/probe.mjs'
KLASR_LOCAL_MVP=false
```

`KLASR_SA_FILE_OVERRIDE` est le chemin hôte monté en lecture seule dans les
conteneurs. `KLASR_GOOGLE_SERVICE_ACCOUNT_FILE` est le même chemin hôte lu par
le probe. Aucun secret n'est écrit dans le template ou dans l'override rendu.

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

`KLASR_E2E_PROBE` doit désigner le `probe.mjs` sauvegardé pour l'attempt. Ce
fichier reste la source unique du parcours navigateur : ne pas recopier son
flux dans un launcher. Pour inspecter l'overlay sans Docker :

```sh
apps/e2e/scripts/e2e-up.sh --dry-run
```

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
