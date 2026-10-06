# Docling Markdown-first handoff

## Résultat

L'extraction Docling produit désormais du Markdown par défaut avant le passage au fournisseur LLM. `extract_document` et `extract_bytes` ont `markdown=True` par défaut; `DoclingTextTool` conserve explicitement `markdown=False` comme repli texte brut. Les formats Office pris en charge par Docling (`.docx`, `.pptx`, `.xlsx`) sont aussi acceptés par le flux mémoire, ce qui permet l'ingestion réelle du classeur de staging.

Le Markdown constitué uniquement de commentaires d'images Docling est normalisé en contenu vide. Le calendrier vectoriel reste donc `empty`, sans faux contenu `<!-- image -->`.

## Audit des appelants

| Appelant | Mode après changement | Justification |
| --- | --- | --- |
| `dsa._extract` (chemin, bytes, flux; utilisé par les CLI et `suggest*`) | Markdown par défaut | Le contexte transmis à CrewAI doit être Markdown. |
| `services.analysis.extract_memory` (PDF, image, DOCX, PPTX, XLSX) | Markdown par défaut | Flux Drive → Docling → contexte LLM. |
| `DoclingMarkdownTool._run` | `markdown=True` explicite | Contrat de l'outil Markdown inchangé. |
| `DoclingTextTool._run` | `markdown=False` explicite | Seul repli texte brut intentionnel. |
| `extract_bytes` → `extract_document` | Propage le booléen reçu | Le défaut Markdown et le repli explicite sont conservés. |
| Tests/CLI | Défaut Markdown | Les doubles Docling et assertions ont été alignés sur le contrat. |

La recherche globale `rg` n'a trouvé aucun autre appelant de `extract_document` ou `extract_bytes` hors de ces chemins et des tests.

## Probes réels hors ligne

Environnement: `apps/api-py/.venv313`, paramètres chargés depuis `/root/.config/klasr/klasr-live.env`. Aucun secret ni identifiant de fichier fournisseur n'est reproduit ici.

- `doc3.pdf`: `quality=ok`, avertissement `no_dates_found`, 2 904 caractères. Aperçu borné: `<!-- image -->\n\n## Quotation\n\n## Quote Information\n\n<!-- image -->\n\n787 Brunswick, Los Angeles, CA 50028 support@acme.com / 4444 555 555 ...`. Les titres `##` confirment le Markdown. Réévaluation par `_assess_extraction_quality`: `ok`.
- `CDA_Oct25_18mois_Calendrier.pdf`: `quality=empty`, 0 caractère. Résultat attendu: le PDF est de l'art vectoriel sans texte exploitable; ce n'est pas une régression.
- `doc1.xlsx`: téléchargé en lecture seule depuis la racine de staging via le compte de service, puis fourni en mémoire à `extract_memory`. `quality=ok`, avertissement `no_identifiers_found`, 323 caractères. Aperçu borné: `| Basic fee for painting    |\n|---------------------------|\n| 20 m2 plastering          |\n| 20 m2 painting            |\n| Total P HT 700$           | ...`. Les séparateurs `|---|` confirment une table Markdown. Réévaluation par `_assess_extraction_quality`: `ok`.

Le téléchargement temporaire du probe XLSX a été supprimé après vérification. Le chemin de production reste strictement en mémoire (`download` → bytes → `io.BytesIO` → Docling), sans persistance de contenu documentaire.

## Vérifications

- `pytest -q`: **100 passed, 1 skipped**.
- `black --check src tests`: **57 files unchanged**.
- `flake8 src tests`: **succès, aucune sortie**.
- Test de régression ajouté: `extract_bytes` retourne le Markdown par défaut et le texte brut lorsque `markdown=False`.
- Vérification visuelle: non applicable (aucune modification UI).

## Traçabilité

- Mode builder: session Codex interactive (pas de wrapper `/goal` ou `codex exec`).
- Exigence produit: Google Drive → extraction/OCR Docling → contexte Markdown → fournisseur LLM → classification.
- REAC: C5 (composants métier), C7 (tests), C8 (intégration de service externe).
- Design system: non applicable.
- Compromis connu: le calendrier vectoriel demeure vide comme attendu; aucun contournement OCR artificiel n'a été ajouté.
