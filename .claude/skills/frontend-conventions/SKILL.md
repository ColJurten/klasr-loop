---
name: frontend-conventions
description: Next.js 14 conventions and the Klasr design charte (palette, typography, layout rules) for apps/web. Use when writing or reviewing any frontend code.
---
# Frontend Conventions (apps/web)

## Charte Klasr — à respecter strictement (source : PROMPT_DESIGN_KLASR.md)
- "klasr" toujours en minuscules ; logo = K en barres (`components/logo.tsx`).
- Palette monochrome + pastels FONCTIONNELS uniquement (tokens Tailwind) :
  ink `#0A0A0A`, paper `#FAFAF7`, lavender `#AFA9EC`/`#7F77DD` (accent produit),
  sage `#9FE1CB`/`#1D9E75` (validation/succès), peach `#F5C4B3`/`#D85A30`
  (attention/révision/nouveau dossier), line `rgba(0,0,0,0.08)` (bordures).
  Un pastel n'est JAMAIS décoratif : il encode un sens.
- Typo : Inter (UI), JetBrains Mono (noms de fichiers, chemins, chiffres).
  Poids 400 et 500 seulement — jamais 600/700 (pas de `font-semibold`/`font-bold`).
- Sentence case partout. Pas d'emojis dans l'interface.
- Aucune ombre, aucun gradient. Bordures fines (`border-line`). Coins 8–12 px
  (`rounded-lg`/`rounded-xl`). Espaces blancs généreux. Icônes Lucide stroke 1.5.
- Inspirations : Linear, Notion, Stripe Dashboard, Vercel, Mercury.

## Flux de validation (invariant produit)
- Une proposition = nom actuel → nom proposé + chemin destination (mono),
  badge de confiance (sage ≥90, lavande ≥70, pêche en dessous), badge pêche
  « nouveau dossier » quand l'IA suggère un dossier absent de l'arborescence.
- « Valider » (variant `validate`, sauge) exécute en UN clic ; « Tout valider »
  domine l'écran de file ; « Corriger » est le chemin secondaire.
- Bandeau de réassurance RGPD visible près de la file.
- Jamais plus d'un clic pour le happy path ; états error en pêche, jamais
  d'échec silencieux, pas de « Classé » affiché si l'exécution a échoué.

## Technique
- Next.js 14 App Router, TypeScript strict. Server Components par défaut.
- Auth : NextAuth Google/Microsoft ; organizationId depuis la session, jamais
  depuis une saisie client.
- Accessibilité (RGAA, REAC C2) : focus visible, navigation clavier de la file,
  aria-labels sur les actions, aria-current sur la nav.
- Tests : Vitest + Testing Library sur les composants critiques (ProposalCard,
  file de validation) ; Playwright smoke en backlog.
