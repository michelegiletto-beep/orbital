"""Check publication copy, preparation metadata, and rendered report integrity."""
from pathlib import Path
import hashlib
import json
import re
from pypdf import PdfReader

BASE = Path(__file__).resolve().parent
checks = []
for name in ["linkedin-project.txt", "linkedin-article.txt", "linkedin-post.txt", "linkedin-image-alt.txt"]:
    content = (BASE / name).read_text(encoding="utf-8")
    forbidden = sorted(set(content) & set("-#/–—"))
    if forbidden:
        raise ValueError(f"Forbidden narrative punctuation in {name}: {forbidden}")
    if re.search(r"(?i)\b(game changer|revolutionary|unlock|leverage|seamless|cutting.edge|rivoluzionario|senza precedenti)\b", content):
        raise ValueError(f"Stock promotional language in {name}")
    checks.append({"file": name, "characters": len(content), "narrative_check": "passed"})

metadata = json.loads((BASE / "zenodo-record.json").read_text(encoding="utf-8"))
if metadata.get("doi") or metadata.get("affiliations"):
    raise ValueError("Unverified identifiers must not be inserted into preparation metadata")
if metadata["creators"] != [{"given_name": "Michele", "family_name": "Giletto"}]:
    raise ValueError("Unexpected creator metadata")
if metadata["rights"]["title"] != "All rights reserved":
    raise ValueError("Proprietary rights changed")
checks.append({"file": "zenodo-record.json", "metadata_check": "passed", "deposit_created": False})

evidence = json.loads((BASE / "output" / "model-evidence.json").read_text(encoding="utf-8"))
if evidence["softwareVersion"] != "0.3.0" or len(evidence["cases"]) != 9:
    raise ValueError("Unexpected measured case evidence")
if not all(case["exactReplay"] and case["report"]["complete"] for case in evidence["cases"]):
    raise ValueError("Measured case or replay failed")
if "EVALUATION.md" not in (BASE.parent / "LICENSE").read_text(encoding="utf-8"):
    raise ValueError("Evaluation permission is not bound to the authoritative license")
checks.append({"file": "model-evidence.json", "cases": len(evidence["cases"]),
               "exact_replay": "passed", "evaluation_permission": "bound to LICENSE"})

release = json.loads((BASE / "output" / "release-evidence.json").read_text(encoding="utf-8"))
if release.get("schema") != "orbital.release-verification.v1" or release.get("version") != "0.3.0":
    raise ValueError("Unexpected software release evidence")
test = release["test"]
if (test["tests"] != test["pass"] or test["pass"] != 68 or
        any(test[key] != 0 for key in ["fail", "cancelled", "skipped", "todo", "exitCode"])):
    raise ValueError("Final software suite did not pass completely")
if release["build"]["exitCode"] != 0 or release["dependencyAudit"]["vulnerabilities"]["total"] != 0:
    raise ValueError("Build or dependency gate failed")
if release["sbom"]["components"] != 160 or release["sbom"]["exitCode"] != 0:
    raise ValueError("Software inventory gate failed")
if not release.get("package") or release["package"].get("verified") is not True:
    raise ValueError("Extracted release package has not passed inspection")
if not release.get("sourceProvenance", {}).get("files"):
    raise ValueError("Source file provenance is absent")
checks.append({"file": "release-evidence.json", "software_tests": test["pass"],
               "build": "passed", "audit_vulnerabilities": 0, "sbom_components": 160,
               "package_inspection": "passed"})

pdf = BASE / "output" / "pdf" / "Orbital-technical-report.pdf"
reader = PdfReader(pdf)
text = "\n".join(page.extract_text() for page in reader.pages)
for expected in ["Michele Giletto", "References", "120 km", "scalar", "independent", "68 automatic tests"]:
    if expected not in text:
        raise ValueError(f"Expected report scope missing: {expected}")
if "\ufffd" in text or "\u25a0" in text:
    raise ValueError("Replacement glyph detected")
checks.append({"file": pdf.name, "pages": len(reader.pages),
               "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "text_check": "passed"})

report = {"status": "publication package verified against measured software evidence",
          "external_destinations": release.get("publicationDestinations", {}),
          "checks": checks,
          "remaining_gate": "GitHub and Zenodo publication require authenticated publishing access and destination verification. LinkedIn copy is prepared for the owner."}
(BASE / "output" / "publication-verification.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False))
