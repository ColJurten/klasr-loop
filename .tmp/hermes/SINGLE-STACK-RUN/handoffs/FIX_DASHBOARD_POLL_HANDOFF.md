# Handoff — attente de l'analyse Drive

## Correctif

- Avant : un lancement restauré ou actif passait systématiquement à `error` 30 secondes après `startedAt`, même si le worker traitait encore le document.
- Après : `running`/`done` continue à rafraîchir le dashboard tant que le serveur n'annonce pas un état terminal. `done` revient à `idle` lorsque `metrics.outcomes` atteint la cible ; seul un incrément de `analysisFailures` par rapport au lancement produit `error`.
- Signaux serveur utilisés : `metrics.outcomes` pour la réussite et `analysisFailures` pour l'échec. `metrics.analyzing` reste visible dans la donnée pollée et le test de non-régression couvre explicitement un job encore en analyse après 30 secondes.
- `startedAt` reste sauvegardé dans `klasr-drive-launch` pour conserver le contexte du lancement, sans servir de preuve d'échec.

## Preuves

- Reproduction compose : `.tmp/hermes/ux-clarity/evidence/item-21/compose-e2e/flow-result.json`
- Confirmation après rechargement : `.tmp/hermes/ux-clarity/evidence/item-21/compose-e2e/confirm-result.json`
- Worker et persistance (`completed`, `retry_count=0`, proposition créée) : `.tmp/hermes/ux-clarity/evidence/item-21/compose-e2e/worker-excerpt.log`
- Tests web : 129/129, dont réussite dans la fenêtre, attente au-delà de 30 secondes et incrément d'échec réel.
- Vérifications : `pnpm --filter @klasr/web test`, `lint`, `typecheck` et `build` réussis. Le premier `typecheck`, lancé en parallèle du build, a rencontré des types `.next` transitoirement absents ; il réussit après génération du build.
- Vérification visuelle : capture compose `04-analysis-launched.png` inspectée ; l'état « Analyse en cours » conserve la mise en page et aucun nouveau rendu n'est introduit. Pas d'URL locale utilisée.

## Périmètre et conformité

- Fichiers modifiés : `apps/web/app/dashboard/drive-workflow.tsx`, `apps/web/tests/drive-workflow.test.tsx`.
- Mode Codex : session builder interactive (pas de `/goal` persistant).
- Invariant Drive : inchangé ; ce correctif ne touche ni téléchargement, ni OCR, ni stockage documentaire.
- Design system : aucun changement visuel ; la bannière pêche existante est seulement réservée aux échecs réels.
- REAC : C5 (développer des composants d'accès aux données) et C7 (tester les composants applicatifs).
- Compromis connu : sans identifiant de job dans le payload dashboard, l'échec est corrélé par l'augmentation du compteur tenant existant, comme avant.
