#!/usr/bin/env python3
"""
Test harness for memoir-tcolorbox footnote placement.

Compiles test-fn.tex, then uses pymupdf to verify that every footnote body
appears on the same page as its mark.

Strategy:
  - Footnote marks appear in body text as superscript digits embedded in a line.
  - Footnote bodies appear in the lower portion of the page (y > FOOTER_THRESHOLD)
    as lines starting with a digit followed by the body text.
  - We match mark number -> page and body number -> page and assert they agree.

Exit 0 = all pass, non-zero = failures.
"""

import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import fitz  # pymupdf

HERE = Path(__file__).parent
TEX = HERE / "test-fn.tex"
PDF = HERE / "test-fn.pdf"
LOG = HERE / "test-fn.log"

# Lines below this fraction of page height are considered the footer region.
FOOTER_THRESHOLD = 0.75


def compile_tex():
    result = subprocess.run(
        ["lualatex", "-interaction=nonstopmode", str(TEX)],
        cwd=HERE, capture_output=True, text=True,
    )
    log = LOG.read_text() if LOG.exists() else result.stdout
    fatal = [l for l in log.splitlines() if l.startswith("!")]
    if fatal or "Output written on" not in log:
        print("ERROR: lualatex failed")
        for l in fatal:
            print(" ", l)
        sys.exit(2)
    # Report any unreferenced footnote destinations as early warning
    missing = re.findall(r"unreferenced destination with name 'Hfootnote\.(\d+)'", log)
    return missing


def parse_pdf():
    """Return (marks, bodies) where each is a dict of footnote_num -> page (1-based)."""
    doc = fitz.open(str(PDF))
    marks = {}   # fn_num -> page
    bodies = {}  # fn_num -> page

    for pno in range(len(doc)):
        page = doc[pno]
        page_h = page.rect.height
        footer_y = page_h * FOOTER_THRESHOLD

        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        for block in blocks:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                y = line["bbox"][1]
                # Collect spans, noting which are superscript (small font size)
                spans = line["spans"]
                if not spans:
                    continue

                if y >= footer_y:
                    # Footer region: body lines look like "N[N] text" or just start
                    # with a footnote number. Extract leading digit(s).
                    text = "".join(s["text"] for s in spans)
                    m = re.match(r"^(\d+)", text.strip())
                    if m:
                        bodies[int(m.group(1))] = pno + 1
                else:
                    # Body text: superscript spans carry footnote mark numbers.
                    # A span is superscript when its font size is noticeably smaller
                    # than the dominant size on the line.
                    sizes = [s["size"] for s in spans if s["text"].strip()]
                    if not sizes:
                        continue
                    dominant = max(set(sizes), key=sizes.count)
                    for span in spans:
                        if span["size"] < dominant * 0.8:
                            # Superscript: may contain comma-separated mark numbers
                            for num_str in re.findall(r"\d+", span["text"]):
                                marks[int(num_str)] = pno + 1

    return marks, bodies


def run_tests(marks, bodies, missing_hrefs):
    failures = []

    all_nums = sorted(set(marks) | set(bodies))
    print(f"{'Fn':>4}  {'Mark pg':>8}  {'Body pg':>8}  Result")
    print("-" * 36)
    for n in all_nums:
        mp = marks.get(n, "—")
        bp = bodies.get(n, "—")
        ok = (mp == bp) and mp != "—"
        status = "OK" if ok else "FAIL"
        print(f"{n:>4}  {str(mp):>8}  {str(bp):>8}  {status}")
        if not ok:
            if mp == "—":
                failures.append(f"fn {n}: body on page {bp} but mark not found")
            elif bp == "—":
                failures.append(f"fn {n}: mark on page {mp} but body never placed")
            else:
                failures.append(f"fn {n}: mark on page {mp} but body on page {bp}")

    # Hyperref cross-check: catch any missing bodies not already detected via PDF
    already_failed = {int(re.search(r"\d+", f).group()) for f in failures if re.search(r"\d+", f)}
    for n in missing_hrefs:
        fn = int(n)
        if fn not in already_failed:
            failures.append(f"fn {fn}: hyperref destination unreferenced (body missing)")

    return failures


def main():
    print("Compiling test-fn.tex...")
    missing_hrefs = compile_tex()

    print("Parsing test-fn.pdf...")
    marks, bodies = parse_pdf()

    print()
    failures = run_tests(marks, bodies, missing_hrefs)
    print()

    if failures:
        print(f"FAILED ({len(failures)} failure(s)):")
        for f in failures:
            print(f"  {f}")
        sys.exit(1)
    else:
        print("All footnote placement tests PASSED.")


if __name__ == "__main__":
    main()
