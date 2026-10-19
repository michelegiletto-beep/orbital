"""Build a deliberate publication package without working data or credentials."""
from pathlib import Path
import hashlib
import json
import zipfile

BASE = Path(__file__).resolve().parent
OUT = BASE / "output"
FILES = [
    "README.md", "github-readme.md", "github-release.md", "linkedin-project.txt",
    "linkedin-article.txt", "linkedin-post.txt", "linkedin-image-alt.txt", "technical-paper.md",
    "market-readiness.md", "evaluation-protocol.md", "publication-checklist.md",
    "zenodo-record.json", "CITATION.cff", "render-paper.py", "verify-publication.py",
    "build-package.py", "measure-release.ts", "requirements.txt", "output/model-evidence.json",
    "output/release-evidence.json",
    "output/media/Orbital-mission-hub.jpg",
    "output/pdf/Orbital-technical-report.pdf",
    "output/publication-verification.json",
]
manifest = {"status": "publication package prepared; GitHub and Zenodo publication not recorded",
            "creator": "Michele Giletto", "files": []}
target = OUT / "Orbital-publication.zip"
OUT.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in FILES:
        path = BASE / name
        data = path.read_bytes()
        manifest["files"].append({"path": name, "bytes": len(data),
                                  "sha256": hashlib.sha256(data).hexdigest()})
        archive.writestr(name, data)
    for source, name in [("LICENSE", "LICENSE"), ("EVALUATION.md", "EVALUATION.md"),
                         ("CHANGELOG.md", "CHANGELOG.md"), ("SECURITY.md", "SECURITY.md"),
                         ("docs/verification.md", "verification.md")]:
        data = (BASE.parent / source).read_bytes()
        manifest["files"].append({"path": name, "bytes": len(data),
                                  "sha256": hashlib.sha256(data).hexdigest()})
        archive.writestr(name, data)
    archive.writestr("publication-manifest.json", json.dumps(manifest, indent=2))
with zipfile.ZipFile(target) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("Archive CRC inspection failed")
    if len(archive.namelist()) != len(FILES) + 6:
        raise RuntimeError("Unexpected package content")
summary = {"file": str(target), "bytes": target.stat().st_size,
           "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
           "files": len(FILES) + 6, "status": manifest["status"]}
(OUT / "package.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps(summary))
