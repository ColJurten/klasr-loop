import asyncio
import os
import re
import unicodedata
from pathlib import Path

from dsa import suggest_text, _validated_destination
from dsa.schemas import ExtractionResult, DecisionResult, SuggestionResult
from dsa.tools import extract_bytes
from repositories.documents import DocumentsRepository
from repositories.folders import FoldersRepository
from repositories.rules import RulesRepository
from repositories.proposals import ProposalsRepository
from repositories.usage_metrics import UsageMetricsRepository
from services.llm_settings import LlmSettingsService
from services.llm_provider import CallableLLM, environment_config
from services.drive import MAX_BYTES


def extract_memory(content, mime_type, name):
    if len(content) > MAX_BYTES:
        return ExtractionResult(text="", quality="failed")
    if mime_type.startswith("text/") or mime_type == "application/json":
        text = content.decode("utf-8", errors="replace").strip()
        if not text:
            return ExtractionResult(text="", quality="empty", first_pass_quality="empty")
        quality, warnings = _assess_extraction_quality(text)
        return ExtractionResult(
            text=text,
            markdown=text,
            quality=quality,
            warnings=warnings,
            first_pass_quality=quality,
            first_pass_text_chars=len(text),
            first_pass_md_chars=len(text),
        )
    suffix = {
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/tiff": ".tiff",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    }.get(mime_type)
    if not suffix:
        return ExtractionResult(text="", quality="failed")
    return extract_bytes(content, suffix)


def _assess_extraction_quality(content: str) -> tuple[str, list[str]]:
    """Assess extraction quality using the same signal-aware logic as dsa.tools."""
    if not content:
        return "empty", []
    warnings: list[str] = []
    has_date = bool(
        re.search(r"\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b", content)
    )
    has_identifier = bool(
        re.search(
            r"(?:facture|invoice|contrat|contract|r[ée]f(?:érence)?|n[°o]|SIRET|SIREN)"
            r"[ \t:#n°-]*([A-Z0-9][A-Z0-9-]{2,})",
            content,
            re.I,
        )
    )
    has_party = bool(
        re.search(
            r"(?:de|from|[ée]metteur|issuer|fournisseur|supplier)"
            r"\s*[:-]?\s*([A-ZÀ-Ÿ][\w &.'-]{2,40})",
            content,
            re.I,
        )
    )
    has_amount = bool(
        re.search(r"\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})\s*(?:€|EUR|euro)", content, re.I)
    )
    has_siret = bool(re.search(r"\b\d{3}\s?\d{3}\s?\d{3}\s?\d{5}\b", content))
    has_siren = bool(re.search(r"\b\d{3}\s?\d{3}\s?\d{3}\b", content))
    has_signals = has_date or has_identifier or has_party or has_amount or has_siret or has_siren
    if len(content) < 10:
        return "sparse", ["very_short_content"]
    if len(content) < 40:
        return "sparse", ["short_content"]
    if not has_signals:
        return "sparse", ["no_recognizable_signals"]
    if not has_date:
        warnings.append("no_dates_found")
    if not (has_identifier or has_siret or has_siren):
        warnings.append("no_identifiers_found")
    return "ok", warnings


def _bounded_rationale(text):
    sentences = re.split(r"(?<=[.!?])\s+", " ".join(text.split()))
    unique = list(dict.fromkeys(sentence for sentence in sentences if sentence))
    return " ".join(unique[:2])[:300].strip() or None


def apply_rules(document, text, paths, rules):
    haystacks = dict(
        CONTENT=text.lower(), FILENAME=document.name.lower(), MIME_TYPE=document.mime_type.lower()
    )
    for rule in sorted(rules, key=lambda row: row["priority"]):
        if not rule["conditions"] or rule["destinationPath"] not in paths:
            continue
        if not all(
            (
                condition["value"].lower() in haystacks[condition["field"]]
                if condition["operator"] == "CONTAINS"
                else condition["value"].lower() == haystacks[condition["field"]]
            )
            for condition in rule["conditions"]
        ):
            continue
        strong = any(c["field"] == "CONTENT" for c in rule["conditions"])
        return dict(
            proposed_name=(
                rule["suggestedNameTemplate"]
                if rule["suggestedNameTemplate"] is not None
                else document.name
            ),
            destination_path=rule["destinationPath"],
            confidence=0.95 if strong else 0.6,
            filename_confidence=0.9 if rule["suggestedNameTemplate"] else 0.35,
            destination_confidence=0.95 if strong else 0.6,
            review_required=not strong or not rule["suggestedNameTemplate"],
            rationale=_bounded_rationale(
                f"Classé par règle (priorité {rule['priority']}) "
                f"vers {rule['destinationPath']}."
            ),
            source="RULE",
            llm_calls_used=0,
        )
    return None


def local_suggestion(extraction, directories):
    """Explicit deterministic provider with content-grounded filename and nested-tree reasoning."""
    text = extraction.text
    kind = next(
        (
            label
            for pattern, label in [
                (r"\b(facture|invoice)\b", "facture"),
                (r"\b(contrat|contract)\b", "contrat"),
                (r"\b(reçu|receipt|ticket)\b", "reçu"),
                (r"\b(letter|lettre|courrier)\b", "courrier"),
            ]
            if re.search(pattern, text, re.I)
        ),
        "",
    )
    date = re.search(r"\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b", text)
    identifier = re.search(
        r"(?:facture|invoice|contrat|contract|r[ée]f(?:érence)?|n[°o])"
        r"[ \t:#n°-]*([A-Z0-9][A-Z0-9-]{2,})",
        text,
        re.I,
    )
    party = re.search(
        r"(?:de|from|émetteur|issuer|fournisseur|supplier)\s*[:-]?\s*([A-ZÀ-Ÿ][\w &.'-]{2,40})",
        text,
        re.I,
    )
    siret = re.search(r"\b(\d{3}\s?\d{3}\s?\d{3}\s?\d{5})\b", text)
    amount_match = re.search(
        r"\b(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2}))\s*(?:€|EUR|euro)", text, re.I
    )

    # Build filename from content signals only, never from the original filename.
    siret_str = siret[1].replace(" ", "") if siret else ""
    amount_str = amount_match[1].replace(" ", "_").replace(",", "_") if amount_match else ""
    pieces = [
        f"{date[1]}-{int(date[2]):02d}-{int(date[3]):02d}" if date else "",
        kind,
        party[1].strip() if party else "",
        identifier[1] if identifier else "",
        siret_str or "",
        amount_str or "",
    ]
    pieces = [piece for piece in pieces if piece]
    filename_value = "_".join(pieces) or None
    filename_warnings = ["insufficient_evidence"] if len(pieces) < 2 else []
    filename_confidence = min(0.95, 0.35 + len(pieces) * 0.15)

    # Nested-tree destination reasoning: score leaf and parent tokens separately.
    content_tokens = [
        token
        for value in [kind, party[1] if party else "", kind]
        for token in re.split(r"\W+", value.lower(), flags=re.ASCII)
        if len(token) > 2
    ]
    # Score each directory path using hierarchy: leaf match is stronger than parent match.
    scored = []
    for path in directories:
        parts = [p for p in path.lower().split("/") if p]
        leaf_tokens = set(re.split(r"\W+", parts[-1], flags=re.ASCII)) if parts else set()
        parent_tokens = set(
            tok for p in parts[:-1] for tok in re.split(r"\W+", p, flags=re.ASCII) if len(tok) > 2
        )
        leaf_score = sum(token in leaf_tokens for token in content_tokens)
        parent_score = sum(token in parent_tokens for token in content_tokens)
        # Leaf matches weight 2, parent matches weight 1.
        total = leaf_score * 2 + parent_score
        scored.append((total, leaf_score, path))

    scored.sort(key=lambda pair: -pair[0])

    # No zero-evidence fallback: if all scores are zero, return None.
    if not scored or scored[0][0] == 0:
        dest_value = None
        dest_confidence = 0
        dest_warnings = ["no_destination_match"]
    elif len(scored) > 1 and scored[0][0] == scored[1][0]:
        # Sibling ambiguity: same top score on multiple paths.
        # Check if they share the same parent (true sibling ambiguity).
        top_score = scored[0][0]
        tied = [s for s in scored if s[0] == top_score]
        if len(tied) > 1:
            parents = set()
            for _, _, p in tied:
                parts = [pp for pp in p.split("/") if pp]
                parents.add("/".join(parts[:-1]) if len(parts) > 1 else "")
            if len(parents) == 1:
                dest_value = None
                dest_confidence = 0
                dest_warnings = ["ambiguous_destination"]
            else:
                dest_value = scored[0][2]
                dest_confidence = min(0.9, 0.45 + scored[0][0] * 0.1)
                dest_warnings = []
        else:
            dest_value = scored[0][2]
            dest_confidence = min(0.9, 0.45 + scored[0][0] * 0.1)
            dest_warnings = []
    else:
        dest_value = scored[0][2]
        dest_confidence = min(0.9, 0.45 + scored[0][0] * 0.1)
        dest_warnings = []

    return SuggestionResult(
        filename=DecisionResult(
            value=filename_value,
            confidence=filename_confidence,
            rationale=(
                "Signal de classement insuffisant pour proposer un nom fiable."
                if filename_warnings
                else f"Nom proposé depuis le contexte de classement : {', '.join(pieces)}."
            ),
        ),
        destination=DecisionResult(
            value=dest_value,
            confidence=dest_confidence,
            rationale=(
                "Plusieurs destinations de l'arborescence correspondent; choix manuel requis."
                if "ambiguous_destination" in dest_warnings
                else (
                    "Aucune destination de l'arborescence ne correspond au type de document."
                    if not dest_value
                    else (
                        f"Contexte de classement {kind or 'document'} "
                        f"associé au dossier {dest_value}."
                    )
                )
            ),
        ),
        extraction_quality=extraction.quality,
    )


class AnalysisService:
    def __init__(self, session, settings, drive, providers, analyses):
        self.session, self.settings, self.drive = session, settings, drive
        self.providers, self.analyses = providers, analyses
        self.documents = DocumentsRepository(session)
        self.folders = FoldersRepository(session)
        self.rules = RulesRepository(session)
        self.proposals = ProposalsRepository(session)
        self.metrics = UsageMetricsRepository(session)

    async def analyze(self, job):
        org, doc_id = job["organizationId"], job["documentId"]
        document = self.documents.find(org, doc_id, pending=True)
        if not document:
            return
        try:
            content = await self.drive.download(org, job.get("userId", ""), document.external_id)
        except Exception:
            extraction = ExtractionResult(text="", quality="failed")
        else:
            extraction = await asyncio.to_thread(
                extract_memory, content, document.mime_type, document.name
            )
            del content
        first_pass = (
            extraction.first_pass_quality,
            extraction.first_pass_text_chars,
            extraction.first_pass_md_chars,
            extraction.ocr_pass,
        )
        folders = self.folders.inherited(org)
        paths = [folder["path"] for folder in folders]
        proposal = (
            apply_rules(document, extraction.text, paths, self.rules.list(org))
            if extraction.quality not in {"empty", "failed"}
            else None
        )
        if not proposal:
            proposal = await self.suggest(org, document, extraction, paths)
        proposal["destination_folder_external_id"] = next(
            (
                folder["externalId"]
                for folder in folders
                if folder["path"] == proposal["destination_path"]
            ),
            None,
        )
        await self.analyses.record(
            organization_id=org,
            document_id=doc_id,
            status="completed",
            payload={
                "proposed_name": proposal["proposed_name"],
                "destination": proposal["destination_path"],
                "confidence": proposal["confidence"],
                "rationale": proposal.get("rationale"),
                "model_info": {
                    "model_used": proposal.get("model_used") or "rule",
                    "quality": extraction.quality,
                    "source": proposal["source"],
                    "llm_calls_used": proposal["llm_calls_used"],
                },
            },
        )
        del extraction
        with self.session.begin_nested():
            if self.documents.mark_proposed(org, doc_id) != 1:
                return
            self.proposals.create(org, doc_id, **proposal)
            self.metrics.increment(
                org,
                ocrRuns=1,
                ruleMatches=int(proposal["source"] == "RULE"),
                llmCalls=proposal["llm_calls_used"],
            )
        return first_pass

    async def suggest(self, org, document, extraction, paths):
        extension = Path(document.name).suffix.lower()
        model_used, calls = "none/", 0
        if extraction.quality in ("empty", "failed"):
            filename = DecisionResult(
                value=None,
                confidence=0,
                rationale="Aucun contenu lisible détecté dans le document",
            )
            destination = filename
        else:
            config = LlmSettingsService(self.session, self.settings, self.providers).resolve(org)
            if config is None and (os.getenv("KLASR_LLM_PROVIDER") or "local") in (
                "local",
                "fake",
            ):
                result = local_suggestion(extraction, paths)
                model_used = "local/deterministic"
            else:
                config = config or environment_config()
                loop = asyncio.get_running_loop()
                calls = 0

                def complete(messages):
                    nonlocal calls
                    calls += 1
                    return asyncio.run_coroutine_threadsafe(
                        self.providers.completion(config, messages), loop
                    ).result()

                result = await asyncio.to_thread(
                    suggest_text, extraction, paths, lambda _: CallableLLM(complete)
                )
                model_used = config["provider"] + "/" + config["model"]
            filename = result.filename
            destination = _validated_destination(result.destination, paths)
        name = filename.value or document.name
        if name:
            stem = str(Path(name).with_suffix("")) if Path(name).suffix else name
            name = (
                re.sub(
                    r"_+",
                    "_",
                    re.sub(
                        r"\s+",
                        "_",
                        "".join(
                            "_" if c in '<>:"/\\|?*' or ord(c) < 32 or ord(c) == 127 else c
                            for c in unicodedata.normalize("NFKC", stem)
                        ),
                    ),
                ).strip(".")[:180]
                or "document"
            )
        name += extension
        cap = 0.55 if extraction.quality == "sparse" else 1
        filename_confidence = min(filename.confidence, cap)
        destination_confidence = min(destination.confidence, cap)
        return dict(
            proposed_name=name,
            destination_path=destination.value or "",
            confidence=min(filename_confidence, destination_confidence),
            filename_confidence=filename_confidence,
            destination_confidence=destination_confidence,
            review_required=not destination.value
            or filename_confidence < 0.7
            or destination_confidence < 0.7,
            rationale=_bounded_rationale(
                " ".join(dict.fromkeys(p for p in [filename.rationale, destination.rationale] if p))
            ),
            source="LLM",
            model_used=model_used,
            llm_calls_used=calls,
        )
