# Handoff — normalisation des signals DSA

## Changements

- `apps/api-py/src/dsa/config/tasks.yaml:1-27` — les trois tâches qui produisent un `DecisionResult` exigent explicitement des objets `label`/`value` et donnent un exemple concret.
- `apps/api-py/src/dsa/schemas.py:6-72` — ajout du modèle `Signal`, du vocabulaire déterministe et de la normalisation à la frontière Pydantic.
- `apps/api-py/tests/test_dsa.py:66-78,229-285` — couverture du format canonique, des chaînes non étiquetées, de la détection de labels connus, du rejet des types inconnus et du parsing via un LLM stub CrewAI.

## Règles de normalisation

- Un objet valide `{label, value}` reste inchangé.
- Une chaîne historique `label:value` devient l'objet équivalent sans warning.
- Une chaîne non vide commençant par `date`, `invoice`, `contract`, `reference`, `amount`, `party`, `organization`, `subject`, `identifier` ou `document_type` reçoit ce label.
- Toute autre chaîne non vide reçoit le label fidèle `evidence` et conserve sa valeur brute.
- Toute chaîne initialement non étiquetée ajoute `signal sans label normalisé` aux warnings, ce qui déclenche la revue manuelle existante.
- Les valeurs vides, objets mal formés, champs supplémentaires et types inconnus restent invalides (fail closed).

## Vérification

- `cd apps/api-py && ./.venv/bin/python -m pytest -q` — **90 passed**.
- `cd apps/api-py && ./.venv/bin/black --check src tests alembic` — **pass** (61 fichiers inchangés).
- `cd apps/api-py && ./.venv/bin/flake8 src tests alembic` — **pass**.
- Aucun flux avec credentials lancé; aucune vérification UI nécessaire (changement backend uniquement).

## Conformité

- Mode builder : session Codex interactive (pas de `/goal` persistant).
- Exigence produit / REAC : robustesse de la frontière LLM et validation des données (C2/C4); les sorties dérivées restent typées et traçables.
- Invariant Drive : inchangé; la normalisation opère uniquement sur les métadonnées en mémoire et ne persiste aucun contenu documentaire.
- Design system : non concerné; aucun fichier UI modifié.
- Compromis connu : le vocabulaire est volontairement borné; les nouveaux labels déterministes pourront être ajoutés lorsqu'un cas réel le justifiera.
