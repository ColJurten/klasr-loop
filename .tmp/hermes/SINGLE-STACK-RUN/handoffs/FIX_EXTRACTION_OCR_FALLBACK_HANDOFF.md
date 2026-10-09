# OCR-on-demand extraction handoff

## Pipeline options

- Before: every Docling PDF converter used `PdfPipelineOptions(do_ocr=True)`, so OCR model initialization was a prerequisite even for PDFs with a usable text layer.
- After: `_build_converter(do_ocr=False)` is the default text/layout pass. A second converter with `do_ocr=True` is created only when the first pass is `empty` or `sparse`. The existing timeout, backend-text, OCR-language, and Markdown-default settings are unchanged.

## Two-pass flow

1. Convert with OCR disabled and assess the exported content with `_assess_quality`.
2. Return immediately when quality is `ok`.
3. For `empty` or `sparse` content, rebuild the in-memory stream if needed and convert with OCR enabled.
4. If OCR construction or conversion raises, log a warning and return the first-pass text-layer result. If OCR also produces no content, the existing quality/fail-closed path remains in control.

## Tests

- Text-layer PDF returns `ok` without attempting unavailable OCR.
- Empty first pass attempts the OCR converter and returns its text.
- OCR initialization failure preserves sparse first-pass content and emits a warning.
- PDF options explicitly cover both `do_ocr=False` and `do_ocr=True`.
- Existing scanned-PDF OCR and Markdown-default regressions remain covered.
- In-memory two-pass conversion remains diskless and preserves the source suffix.

## Evidence

Round 17 report: [`.tmp/hermes/ux-clarity/evidence/item-21/compose-e2e/dashboard-fix/report.txt`](.tmp/hermes/ux-clarity/evidence/item-21/compose-e2e/dashboard-fix/report.txt)
