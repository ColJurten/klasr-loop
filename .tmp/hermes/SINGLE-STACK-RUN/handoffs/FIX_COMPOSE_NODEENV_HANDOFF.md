# Compose web NODE_ENV handoff

- Added `NODE_ENV: development` to the `web` service environment only, with the requested explanation of why the dev Compose stack overrides the Dockerfile value.
- Left Dockerfiles and runtime guards unchanged.
- Did not run any builds.

## Sanity checks

`docker compose --env-file /dev/null config --quiet` passed.

The requested command completed successfully:

```text
$ docker compose --env-file /dev/null config | grep -A2 NODE_ENV
  NODE_ENV: development
  TOKEN_ENCRYPTION_KEY: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
x-api-image:
```

Because `web` is behind the `api` profile, resolving that profile shows the web-specific value:

```text
$ docker compose --env-file /dev/null --profile api config | sed -n '/^  web:/,/^  [a-z]/p' | grep -A2 NODE_ENV
      NODE_ENV: development
    networks:
      default: null
```
