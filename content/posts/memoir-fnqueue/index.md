+++
title = "Full Control Over Footnote Placement for memoir"
tags = ["LaTeX"]
date = "2026-03-31"
categories = ["tech"]
menu = "main"
+++

This is a follow-up to [LuaLaTeX Footnote Maze](../memoir-tcolorbox), which documented the long road to making memoir paragraph footnotes work inside breakable tcolorbox environments with hyperref. That solved half the problem. This post solves the rest of the problem: deciding exactly where on the page footnotes appear.

**Downloads:** [memoir-fnqueue.sty](memoir-fnqueue.sty) · [memoir-tcolorbox.sty](memoir-tcolorbox.sty) · [test-fn.tex](test-fn.tex) · [test-fn.py](test-fn.py)

## The Remaining Gap

After the earlier work, footnotes escaped their tcolorbox prisons and rendered as proper paragraph footnotes with working hyperref links. But placement was still automatic—footnotes released at the end of a box landed wherever TeX's page builder decided, sometimes colliding with other content when the combined height of sidebar plus footnotes barely exceeded the page.

What I wanted was explicit control: queue footnotes, then flush them at a chosen point in the vertical list. This lets you choose anywhere on the spectrum from footnotes (flush immediately at the bottom of each page) to endnotes (flush once at the end of the document), or any hybrid in between.

## memoir-fnqueue

`memoir-fnqueue.sty` is a small package (Lua + TeX) that manages a queue of pre-formatted footnotes.

```latex
\MFQbegin      % start queuing
\MFQemit{N}    % flush the first N footnotes right now
\MFQflush      % flush everything remaining and deactivate
\MFQcount      % expands to current queue depth
```

Each footnote is formatted as a memoir paragraph footnote immediately when it is encountered—hyperref anchors and all—and stored in a freshly allocated TeX box. The Lua side holds a list of box numbers. `\MFQemit` fires `\insert\footinsv@r{\unvbox<box>}` for each requested item, injecting the pre-formatted content directly into the vertical list at that point.

### Integration with memoir-tcolorbox

`memoir-tcolorbox` now loads `memoir-fnqueue` automatically. A new tcolorbox key, `defer footnote restore`, activates queuing for the duration of the box and leaves the queue live afterward:

```latex
\begin{tcolorbox}[defer footnote restore]
  Content with footnotes.\footnote{Placed wherever you flush below.}
\end{tcolorbox}

\lipsum[1]        % intervening text — footnotes still queued

\MFQflush         % footnotes land here
```

Without the key, existing behaviour is unchanged: footnotes are saved during the box and released immediately after it closes.

### Plain queue (no tcolorbox)

`memoir-fnqueue` also works standalone. This example queues five footnotes, emits two mid-page, then flushes the rest later:

```latex
\MFQbegin
Text.\footnote{Alpha}\footnote{Beta}\footnote{Gamma}\footnote{Delta}\footnote{Epsilon}

\MFQemit{2}   % Alpha and Beta appear here

\lipsum[2]\footnote{Zeta}

\MFQflush     % Gamma, Delta, Epsilon, Zeta appear here
```

## Proving It Works

### test-fn.tex

Three test cases in one document:

1. **Plain queue** — emit 2 of 5 footnotes at one point, flush the remaining 4 (plus one added later) at another.
2. **tcolorbox with `defer footnote restore`** — two footnotes queued inside a breakable box, flushed several paragraphs later.
3. **Emit past end of queue** — `\MFQemit{5}` when only 1 footnote is queued; must not crash.

### test-fn.py

A Python harness that compiles `test-fn.tex` with LuaLaTeX and then uses [PyMuPDF](https://pymupdf.readthedocs.io/) to verify every footnote body appears on the same page as its mark. It also cross-checks hyperref destination anchors from the `.log` to catch broken links.

```bash
python test-fn.py
```

```
Compiling test-fn.tex...
Parsing test-fn.pdf...

  Fn  Mark pg   Body pg  Result
------------------------------------
   1        1         1  OK
   2        1         1  OK
   3        1         1  OK
   4        1         1  OK
   5        1         1  OK
   6        1         1  OK
   7        2         2  OK
   8        2         2  OK
   9        3         3  OK

All footnote placement tests PASSED.
```

The strategy: superscript spans (identified by font size significantly smaller than the dominant size on the line) locate marks; lines in the lower quarter of the page starting with a digit locate bodies. Mark page and body page must match for every footnote number.

## The Architecture in Brief

`memoir-fnqueue` intercepts `\@footnotetext` while queuing is active. The interceptor redefines `\insert` locally so that when memoir's footnote machinery fires `\insert\footinsv@r{...}`, the content is captured into a new box instead. When `memoir-tcolorbox` is loaded, `\MFS@hyper@fntext@impl` checks `\ifMFQ@active` directly and routes to `\MFS@store@footnote@impl`, which allocates a named box, formats the paragraph footnote, and pushes the box number to the Lua queue.

The result: footnote content is formatted exactly once, at encounter time, with correct hyperref anchors. Placement is deferred until `\MFQemit` or `\MFQflush` injects the pre-built boxes into the page at exactly the right moment.
