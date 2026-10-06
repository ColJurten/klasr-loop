# Harnais E2E Docker Compose avec compte de service

Ce document décrit l'overlay local utilisé pour valider le parcours Drive réel sans versionner de secret. Le fichier d'environnement local est nommé `.hosttest` ; son contenu reste **confidentiel et expurgé** des preuves.

## Pré-requis

- une clé JSON de compte de service hors dépôt ;
- l'identifiant du dossier Drive partagé avec ce compte (`KLASR_GOOGLE_DRIVE_ROOT_ID`) ;
- les secrets applicatifs locaux habituels dans `.hosttest` ;
- `KLASR_LOCAL_MVP=false`.

## Structure de l'overlay

Créer un fichier local ignoré `docker-compose-test.yaml` avec les surcharges suivantes :

```yaml
services:
  api:
    ports: ["127.0.0.1:3101:3001"]
    environment:
      KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: "true"
      KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: /run/secrets/google-service-account.json
      KLASR_GOOGLE_DRIVE_ROOT_ID: ${KLASR_GOOGLE_DRIVE_ROOT_ID}
    volumes:
      - ${SA_FILE}:/run/secrets/google-service-account.json:ro
  worker:
    environment:
      KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: "true"
      KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: /run/secrets/google-service-account.json
      KLASR_GOOGLE_DRIVE_ROOT_ID: ${KLASR_GOOGLE_DRIVE_ROOT_ID}
    volumes:
      - ${SA_FILE}:/run/secrets/google-service-account.json:ro
  web:
    ports: ["127.0.0.1:3100:3000"]
    environment:
      NODE_ENV: development
      NEXTAUTH_URL: http://localhost:3100
      API_URL: http://api:3001/api/v1
      NEXT_PUBLIC_API_URL: http://localhost:3101/api/v1
      KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: "true"
    build:
      args:
        NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: "true"
  postgres:
    ports: ["127.0.0.1:55432:5432"]
  mongo:
    ports: ["127.0.0.1:27018:27017"]
```

`SA_FILE` désigne uniquement le chemin hôte de la clé. La clé n'est ni copiée dans une image, ni enregistrée dans le dépôt. Le navigateur utilise `http://localhost:3100`, l'API hôte `http://localhost:3101/api/v1`, PostgreSQL `55432` et MongoDB `27018`.

## Exécution et contrat de restauration

Lancer avec les deux fichiers Compose et l'environnement expurgé :

```sh
docker compose --env-file .hosttest -f docker-compose.yml -f docker-compose-test.yaml --profile api up --build
```

Le scénario part du dossier racine désigné par `KLASR_GOOGLE_DRIVE_ROOT_ID`. Il doit relever avant mutation l'identifiant, le nom et les parents du fichier de test. Après validation de la proposition, il restaure exactement ces trois valeurs et supprime toute donnée applicative créée pour le tenant de test.

Le teardown doit ensuite exécuter `docker compose ... down --volumes --remove-orphans`, vérifier qu'aucun conteneur du projet ne subsiste et que les ports `3100`, `3101`, `27018` et `55432` sont libres. Une interruption du scénario n'annule jamais cette obligation de restauration.

## Preuves

Les rapports, captures, résultats JSON, état Compose et extraits de logs expurgés sont déposés sous `.tmp/hermes/ux-clarity/evidence/item-21/compose-e2e/`. `.tmp` et l'overlay restent jetables ; ce document est le contrat reproductible et révisable. Aucun contenu de `.hosttest`, jeton, clé privée ou document client ne doit apparaître dans les preuves.
