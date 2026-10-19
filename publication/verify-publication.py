"""Check publication copy, preparation metadata, and rendered report integrity."""
from pathlib import Path
import argparse
import hashlib
import json
import re
from pypdf import PdfReader

BASE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--artifacts-dir", type=Path, help="Compare frozen application and source ZIP bytes against release evidence")
args = parser.parse_args()
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

if args.artifacts_dir:
    for kind in ["runtime", "source"]:
        expected = release["package"][kind]
        artifact = args.artifacts_dir / expected["name"]
        data = artifact.read_bytes()
        if len(data) != expected["bytes"] or hashlib.sha256(data).hexdigest() != expected["sha256"]:
            raise ValueError(f"Frozen {kind} archive differs from verified release")
        checks.append({"file": artifact.name, "frozen_release_hash": "passed", "bytes": len(data)})

links = json.loads((BASE / "publication-links.json").read_text(encoding="utf-8"))
destinations = release["publicationDestinations"]
for source, destination in [("system_labs", "systemLabs"), ("github", "github"), ("zenodo", "zenodo"), ("linkedin", "linkedin")]:
    if links[source] != destinations[destination]:
        raise ValueError("Publication destinations are stale; run sync-links.py")
link_sheet = (BASE / "linkedin-links.txt").read_text(encoding="utf-8")
for value in links["system_labs"].values():
    if isinstance(value, str) and value.startswith("https://") and value not in link_sheet:
        raise ValueError("A verified System Labs URL is missing from the LinkedIn link sheet")
if links["github"]["status"] != "published" and (links["github"]["repository"] or links["github"]["release"]):
    raise ValueError("Unverified GitHub URL inserted")
if links["zenodo"]["status"] != "published" and (links["zenodo"]["record"] or links["zenodo"]["doi"]):
    raise ValueError("Unverified Zenodo identifier inserted")
checks.append({"file": "publication-links.json", "system_labs": "published and browser verified",
               "github": links["github"]["status"], "zenodo": links["zenodo"]["status"],
               "linkedin_link_sheet": "consistent"})

media = json.loads((BASE / "linkedin-media.json").read_text(encoding="utf-8"))
if media["lead"] not in [entry["file"] for entry in media["images"]]:
    raise ValueError("LinkedIn lead image is missing")
for entry in media["images"]:
    media_path = (BASE / entry["file"]).resolve()
    if not media_path.is_relative_to((BASE / "output" / "media").resolve()) or not media_path.is_file():
        raise ValueError("LinkedIn image must be an included publication image")
    alt = entry.get("alt") or (BASE / entry["alt_file"]).read_text(encoding="utf-8")
    if set(alt) & set("-#/–—"):
        raise ValueError("Forbidden narrative punctuation in image alternative text")
checks.append({"file": "linkedin-media.json", "images": len(media["images"]),
               "included_files": "passed", "alternative_text": "passed"})

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
          "remaining_gate": "Zenodo requires direct authenticated account access. LinkedIn Projects is published; media preview generation failed and local uploads require the browser extension file URL permission."}
(BASE / "output" / "publication-verification.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False))
