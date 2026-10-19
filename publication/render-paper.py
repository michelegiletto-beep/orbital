"""Render the publication report and inspectable page images from its source."""
from pathlib import Path
from html import escape
import json
import re
import shutil
import subprocess
import sys

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, KeepTogether,
    Flowable, Table, TableStyle, PageBreak,
)
from pypdf import PdfReader

BASE = Path(__file__).resolve().parent
OUT = BASE / "output" / "pdf"
TMP = BASE / "tmp" / "pdfs"
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)

fonts = Path("C:/Windows/Fonts")
if (fonts / "arial.ttf").exists():
    regular, bold = fonts / "arial.ttf", fonts / "arialbd.ttf"
else:
    fonts = Path(reportlab.__file__).resolve().parent / "fonts"
    regular, bold = fonts / "Vera.ttf", fonts / "VeraBd.ttf"
pdfmetrics.registerFont(TTFont("OrbitalText", str(regular)))
pdfmetrics.registerFont(TTFont("OrbitalBold", str(bold)))
pdfmetrics.registerFontFamily("OrbitalText", normal="OrbitalText", bold="OrbitalBold")

INK = colors.HexColor("#18212b")
MUTED = colors.HexColor("#596676")
LINE = colors.HexColor("#d8dfe7")
ACCENT = colors.HexColor("#4e4a81")
W, H = A4
LEFT = 54
WIDTH = W - 2 * LEFT

styles = {
    "title": ParagraphStyle("title", fontName="OrbitalBold", fontSize=23, leading=27,
                            textColor=INK, spaceAfter=8),
    "subtitle": ParagraphStyle("subtitle", fontName="OrbitalText", fontSize=12.2,
                               leading=17, textColor=MUTED, spaceAfter=14),
    "meta": ParagraphStyle("meta", fontName="OrbitalText", fontSize=9, leading=13,
                           textColor=MUTED, spaceAfter=3),
    "heading": ParagraphStyle("heading", fontName="OrbitalBold", fontSize=11.2,
                              leading=15, textColor=INK, spaceBefore=15,
                              spaceAfter=6, keepWithNext=True),
    "body": ParagraphStyle("body", fontName="OrbitalText", fontSize=10.0, leading=14.5,
                           alignment=TA_LEFT, textColor=INK, spaceAfter=7,
                           allowWidows=0, allowOrphans=0),
    "ref": ParagraphStyle("ref", fontName="OrbitalText", fontSize=8.4, leading=12,
                          textColor=MUTED, spaceAfter=8, splitLongWords=True),
    "caption": ParagraphStyle("caption", fontName="OrbitalText", fontSize=8.4,
                              leading=12, textColor=MUTED, spaceAfter=9),
}

HEADINGS = {
    "Abstract", "Purpose and context", "Software architecture",
    "Numerical state and force model", "Relative state and proximity exercises",
    "Deorbit exercise boundary", "Scenario identity and instructional evidence",
    "Verification and reproducibility", "Delivery and security boundaries",
    "Commercial evaluation", "Availability and status", "References",
}


class Pipeline(Flowable):
    """An explanatory architecture diagram, not a simulated result."""

    def __init__(self):
        super().__init__()
        self.width = WIDTH
        self.height = 74

    def draw(self):
        c = self.canv
        gap = 12
        boxw = (WIDTH - gap * 3) / 4
        items = [("Scenario", "Revision and limits"), ("Execution", "State and commands"),
                 ("Replay", "Reconstruction"), ("Assessment", "Evidence and checks")]
        for i, (title, detail) in enumerate(items):
            x = i * (boxw + gap)
            c.setStrokeColor(LINE)
            c.setFillColor(colors.HexColor("#f6f7fa"))
            c.roundRect(x, 16, boxw, 48, 5, stroke=1, fill=1)
            c.setFont("OrbitalBold", 9)
            c.setFillColor(INK)
            c.drawCentredString(x + boxw / 2, 45, title)
            c.setFont("OrbitalText", 7.2)
            c.setFillColor(MUTED)
            c.drawCentredString(x + boxw / 2, 30, detail)
            if i < 3:
                c.setStrokeColor(ACCENT)
                c.line(x + boxw + 2, 40, x + boxw + gap - 2, 40)
                c.line(x + boxw + gap - 5, 43, x + boxw + gap - 2, 40)
                c.line(x + boxw + gap - 5, 37, x + boxw + gap - 2, 40)


def page(c, doc):
    c.saveState()
    c.setStrokeColor(LINE)
    c.line(LEFT, H - 37, W - LEFT, H - 37)
    c.setFont("OrbitalText", 8)
    c.setFillColor(MUTED)
    c.drawString(LEFT, H - 29, "ORBITAL  ·  TECHNICAL REPORT")
    c.drawRightString(W - LEFT, H - 29, "17 October 2026")
    c.line(LEFT, 39, W - LEFT, 39)
    c.drawString(LEFT, 25, "© 2026 Michele Giletto")
    c.drawRightString(W - LEFT, 25, str(doc.page))
    c.restoreState()


def inline(text):
    safe = escape(text)
    return re.sub(r"https?://[^\s<]+", lambda m: '<link href="' + m.group(0) +
                  '" color="#4e4a81">' + m.group(0) + '</link>', safe)


def measured_tables():
    evidence = json.loads((BASE / "output" / "model-evidence.json").read_text(encoding="utf-8"))
    result = []
    cell = ParagraphStyle("table", parent=styles["ref"], fontSize=8.2, leading=11,
                          textColor=INK, spaceAfter=0)
    header = ParagraphStyle("tablehead", parent=cell, fontName="OrbitalBold")
    proximity = [["Scenario", "Range m", "Speed m per s", "Delta V m per s", "Time s"]]
    disposal = [["Scenario", "Burn", "Interface s", "Radial m per s", "Delta V m per s"]]
    for case in evidence["cases"]:
        report = case["report"]
        m = report["metrics"]
        title = case["scenario"]["title"]
        if case["family"] == "deorbit":
            disposal.append([title, case["caseId"].split(":")[-1],
                             f'{report["entry"]["time"]:.3f}',
                             f'{report["entry"]["radialVelocity"]:.3f}', f'{m["deltaV"]:.3f}'])
        else:
            proximity.append([title, f'{m["distance"]:.6f}', f'{m["speed"]:.6f}',
                              f'{m["deltaV"]:.6f}', f'{m["time"]:.1f}'])
    for rows, widths, caption in [
        (proximity, [166, 70, 82, 92, WIDTH - 410],
         "Table 1. Synthetic capture outcomes. Speed is relative to the rotating target frame. All five cases meet their configured capture limits and reproduce exactly through replay."),
        (disposal, [151, 57, 88, 94, WIDTH - 390],
         "Table 2. Synthetic disposal outcomes. All events occur at 120 km altitude. Negative radial speed denotes descent. The finite burn uses 800 N. All four cases reproduce exactly through replay."),
    ]:
        cells = [[Paragraph(escape(value), header if i == 0 else cell)
                  for value in row] for i, row in enumerate(rows)]
        table = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#edf0f5")),
            ("LINEBELOW", (0, 0), (-1, 0), 0.7, LINE),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        result.append(KeepTogether([Spacer(1, 5), table, Spacer(1, 6),
                                    Paragraph(caption, styles["caption"])]))
    return result


source = (BASE / "technical-paper.md").read_text(encoding="utf-8")
lines = source.splitlines()
story = [Paragraph(escape(lines[0]), styles["title"]),
         Paragraph(escape(lines[1]), styles["subtitle"]),
         Paragraph(escape(lines[2]), styles["meta"]),
         Paragraph(escape(lines[3]), styles["meta"]), Spacer(1, 12)]
paragraphs = "\n".join(lines[4:]).strip().split("\n\n")
references = False
for paragraph in paragraphs:
    text = " ".join(paragraph.split())
    if text in HEADINGS:
        if text == "References":
            story.append(PageBreak())
        references = text == "References" or references
        story.append(Paragraph(escape(text), styles["heading"]))
    else:
        story.append(Paragraph(inline(text), styles["ref" if references else "body"]))
    if text.startswith("The application includes mission control"):
        story.append(KeepTogether([Pipeline(), Paragraph(
            "Figure 1. Scenario identity remains attached to execution, replay and assessment.",
            styles["caption"])]))
    if text.startswith("The measured synthetic cases"):
        story.extend(measured_tables())

target = OUT / "Orbital-technical-report.pdf"
doc = BaseDocTemplate(str(target), pagesize=A4, leftMargin=LEFT, rightMargin=LEFT,
                      topMargin=53, bottomMargin=54, title=lines[0],
                      author="Michele Giletto", subject=lines[1])
frame = Frame(LEFT, 54, WIDTH, H - 107, leftPadding=0, rightPadding=0,
              topPadding=0, bottomPadding=0)
doc.addPageTemplates(PageTemplate(id="report", frames=frame, onPage=page))
doc.build(story)

reader = PdfReader(str(target))
content = "\n".join(p.extract_text() for p in reader.pages)
if "Orbital Mission Simulation Hub" not in content or "References" not in content:
    raise RuntimeError("Expected report content is missing")
if "\ufffd" in content or "\u25a0" in content:
    raise RuntimeError("Unexpected replacement glyph in report")
check = {"pages": len(reader.pages), "characters": len(content),
         "output": str(target), "rendered": False}
poppler = Path(shutil.which("pdftoppm") or Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe")
if poppler.exists():
    subprocess.run([str(poppler), "-r", "110", "-png", str(target),
                    str(TMP / "page")], check=True, capture_output=True)
    check["rendered"] = True
(TMP / "inspection.json").write_text(json.dumps(check, indent=2), encoding="utf-8")
print(json.dumps(check))
