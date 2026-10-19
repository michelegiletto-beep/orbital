"""Render verified destinations for publication without inventing missing records.

Edit publication-links.json only after opening and checking the destination.
This script does not authenticate, publish, reserve a DOI, or verify a remote page.
"""
from pathlib import Path
from urllib.parse import urlsplit
import json
import re

BASE = Path(__file__).resolve().parent
record = json.loads((BASE / "publication-links.json").read_text(encoding="utf-8"))
if record.get("schema") != "orbital.publication-links.v1":
    raise ValueError("Unexpected publication link schema")


def url(value, host):
    if not isinstance(value, str):
        raise ValueError("A verified destination must be a URL")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != host or parsed.username or parsed.password:
        raise ValueError("Unexpected publication destination")
    if parsed.port or parsed.query or parsed.fragment or not parsed.path.startswith("/"):
        raise ValueError("Publication URLs must be direct public destinations")
    return value


site = record["system_labs"]
for key in ["project", "application", "technical_report", "runtime", "source"]:
    url(site[key], "giletto-systems-lab.michele-giletto.chatgpt.site")

github = record["github"]
zenodo = record["zenodo"]
if github["status"] == "published":
    repository = url(github["repository"], "github.com")
    release = url(github["release"], "github.com")
    if len(urlsplit(repository).path.strip("/").split("/")) != 2 or not release.startswith(repository + "/releases/tag/"):
        raise ValueError("GitHub release must belong to the verified repository")
elif github["repository"] is not None or github["release"] is not None:
    raise ValueError("Unpublished GitHub destinations must remain absent")

if zenodo["status"] == "published":
    url(zenodo["record"], "zenodo.org")
    if not re.fullmatch(r"10\.5281/zenodo\.[0-9]+", zenodo["doi"] or ""):
        raise ValueError("Zenodo DOI must be the verified published identifier")
    if not urlsplit(zenodo["record"]).path.rstrip("/").endswith(zenodo["doi"].rsplit(".", 1)[1]):
        raise ValueError("Zenodo record and DOI disagree")
elif zenodo["record"] is not None or zenodo["doi"] is not None:
    raise ValueError("Unpublished Zenodo destinations must remain absent")

lines = [
    "Progetto LinkedIn", site["project"], "", "Applicazione", site["application"], "",
    "Rapporto tecnico", site["technical_report"], "", "Pacchetto di valutazione", site["runtime"], "",
    "Codice sorgente", site["source"], "",
]
if github["status"] == "published":
    lines.extend(["GitHub", github["repository"], "", "Versione GitHub", github["release"], ""])
else:
    lines.extend(["GitHub non pubblicato. Non aggiungere un collegamento finché la destinazione non è verificata.", ""])
if zenodo["status"] == "published":
    lines.extend(["Zenodo", zenodo["record"], "", "DOI", "https://doi.org/" + zenodo["doi"], ""])
else:
    lines.extend(["Zenodo non pubblicato. Nessun DOI è stato assegnato.", ""])
lines.append("I collegamenti sono separati dal testo narrativo per conservarne la forma richiesta.")
(BASE / "linkedin-links.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

evidence_path = BASE / "output" / "release-evidence.json"
evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
evidence["publicationDestinations"] = {
    "systemLabs": site,
    "github": github,
    "zenodo": zenodo,
    "linkedin": record["linkedin"],
}
evidence["publicationLinksVerification"] = {
    "checkedAt": record["checked_at"],
    "record": record["verification_record"],
    "scope": "Recorded browser evidence; this renderer does not perform remote verification",
}
evidence_path.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps({"status": "verified destinations rendered", "github": github["status"], "zenodo": zenodo["status"]}))
