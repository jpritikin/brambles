+++
title = "LuaLaTeX Footnote Maze"
tags = ["LaTeX"]
date = "2025-09-01"
categories = ["tech"]
menu = "main"
+++

# LuaLaTeX Footnote Maze

## UPDATE 2025-12-04: Sidebar Footnote Collision Problem

Testing revealed a critical issue: when a sidebar with footnotes barely fits on a page, the footnotes can collide with the sidebar content. The sidebar itself fits, but the combination of sidebar plus footnotes exceeds available space, causing collisions with page content and page numbers.

The problem occurs regardless of sidebar length. Tests with varying sidebar sizes—from compact to extended—all demonstrated collisions when the total height (sidebar + footnotes) was just over the page limit.

The root cause: tcolorbox's page break calculation doesn't properly account for footnote space when deciding whether to break the sidebar across pages. A sidebar that should break to accommodate its footnotes instead remains on a single page, causing overflow.

**Test cases**: See [test-sidebar-footnotes.tex](test-sidebar-footnotes.tex) which systematically tests sidebars of varying lengths, all with approximately 1/3 page of footnotes. Tests 3, 7, and 8 demonstrated clear collisions, confirming the problem occurs across different sidebar lengths when the combined height barely exceeds the page.

**Current mitigation**: The package now defaults to `reserve footnote space=false`. Single-page sidebars that would overflow with their footnotes must be manually marked with `reserve footnote space=true`. This forces proper space reservation but requires manual identification of problematic sidebars.

**Limitations**: Requires manual intervention to identify and mark sidebars that need footnote space reservation. Automatic detection would be preferable but is not currently implemented.

## UPDATE 2025-09-01: Footnote-Aware Page Breaking

After initial publication, I discovered that breakable tcolorbox environments weren't accounting for accumulated footnote height when calculating page breaks. This caused boxes to overflow pages when footnotes were present.

The solution patches tcolorbox's internal page height calculation (`tcb@comp@h@page`) to subtract accumulated footnote height:

- Added `\MFS@notes@height` dimension to track total footnote height
- Updated after each footnote save to reflect current accumulated height
- Patched `tcb@comp@h@page` to reduce available page height by footnote height plus skip
- Reset height tracking when footnotes are output

This initial solution worked for the first page but not for all edge cases (see 2025-12-04 update).

## Introduction

The prospect of typesetting my book in LaTeX filled me with dread. Sure, I could have used Microsoft Word or hired a professional. But I wanted exacting typography control that only do-it-yourself LaTeX offers. The problem? Despite decades of programming in C++ and Perl, LaTeX has always been my nemesis.

Unlike normal programming languages, LaTeX feels undebuggable. Graduate school had taught me to fear its cryptic error messages and painfully slow feedback loops. I never grasped its architecture—a strange blend of markup and macro expansion that operates by its own esoteric rules. Even as an experienced programmer, LaTeX remained an intimidating black box.

After a year of working with Claude, I decided to try Claude Code for my LaTeX challenge. The results were remarkable. Instead of the usual cycle of frustration and error-hunting, Claude was the dutiful junior programmer. I only had to monitor its progress and nudge it occasionally. Use etoolbox. Here's the source code for memoir, tcolorbox, hyperref, and footnotehyper; feel free to consult it. Claude Code created the tailored solution I needed.

AI coding assistants demolish traditional barriers to programming. You no longer need to be an expert to achieve expert-level results. It is called vibe coding? Neat.

## The Problem That Shouldn't Exist (But Does)

If you've ever tried to use [memoir](https://ctan.org/pkg/memoir)'s `\paragraphfootnotes` with breakable [tcolorbox](https://ctan.org/pkg/tcolorbox) environments and [hyperref](https://ctan.org/pkg/hyperref) links, you've probably discovered what I call the "LaTeX footnote triangle of doom." Each package works beautifully on its own, but combine them and suddenly your footnotes are either:

1. Trapped inside tcolorbox environments (appearing as minipage footnotes)
2. Losing their paragraph formatting (appearing as one footnote per line when they should be condensed into a paragraph)
3. Breaking hyperref links (annoying and looks unprofessional)

[The only solution I could find](https://tex.stackexchange.com/questions/558709/tcolorbox-footnotes-at-end-of-each-page)—using the [footnotehyper](https://ctan.org/pkg/footnotehyper?lang=en) package—solves problems 1 and 3 but ignores memoir's paragraph footnote formatting. Another possible solution footmisc, I dismissed earlier. I can't remember the details of why it didn't work.

## Why This Is So Hard

To understand the challenge, you need to know how each component works:

### memoir's Paragraph Footnotes

The memoir class offers `\paragraphfootnotes` which reformats footnotes into a single paragraph at the bottom of the page, saving space. It does this by:
- Using a special insert register `\footinsv@r` instead of the standard `\footins`
- Processing footnotes through `\@parafootnotetext` which uses `\@parafootfmt` for formatting
- Converting vertical boxes to horizontal boxes with `\m@mungebox` (memoir's special unboxing macro)

### tcolorbox's Minipage Context

tcolorbox (w/ breakable) creates its content inside a minipage-like environment. This means:
- Footnotes inside get the minipage treatment (lettered, local to the box)
- The footnote counter switches from `footnote` to `mpfootnote`
- Footnotes are inserted into a local insert register, not the main page's

### hyperref's Link Management

hyperref needs to:
- Create unique anchors for each footnote using `\Hy@footnote@currentHref`
- Place these anchors in both the footnote mark and the footnote text
- Track the connection between marks and texts across the document

### The Incompatibility

The core issue is architectural: 
- footnotehyper intercepts footnotes at the `\@footnotetext` level to save them for later
- It uses the standard `\@makefntext` for formatting
- memoir's paragraph footnotes bypass `\@makefntext` entirely, using `\@parafootfmt` instead
- hyperref patches the standard footnote path, but memoir's paragraph path remains unpatched

## The Solution Architecture

After studying footnotehyper's code and memoir's implementation, I realized we needed a three-pronged approach:

### 1. Global Footnote Processing

Instead of only intercepting footnotes in specific environments, we process ALL footnotes through a unified system. This ensures consistent handling and maintains hyperref links throughout:

```latex
\def\MFS@begin@global@mode{%
    % Replace the main footnote commands
    \let\footnote\MFS@footnote
    \let\footnotetext\MFS@footnotetext
    % Replace low-level commands
    \let\@footnotetext\MFS@hyper@fntext
    \let\@mpfootnotetext\MFS@hyper@fntext
}
```

### 2. Direct Paragraph Formatting

Rather than storing and restoring footnotes generically, we format them as paragraph footnotes immediately:

```latex
\long\def\MFS@hyper@fntext@impl#1{%
    \insert\footinsv@r{%
        \def\baselinestretch{\m@m@footnote@spacing}%
        \reset@font\foottextfont
        \@preamfntext
        \setbox0=\vbox{\hsize=\maxdimen
            \color@begingroup
            \noindent\@parafootfmt{%
                % Hyperref anchor code here
                \expandafter\hyper@@anchor\expandafter{\Hy@footnote@currentHref}{#1}%
            }%
            \color@endgroup
        }%
        \m@mungebox  % Critical: memoir's special unboxing
    }%
    \m@mmf@prepare
}
```

### 3. Save/Restore for tcolorbox

For tcolorbox environments, we still need the save/restore mechanism, but we store the footnotes already formatted as paragraph footnotes:

```latex
\def\MFS@savenotes{%
    \global\MFS@savingnotestrue
    % Force main footnote counter
    \def\@mpfn{footnote}%
    \let\thempfn\thefootnote
    % Initialize storage box
    \global\setbox\MFS@notes\box\voidb@x
}

\def\MFS@restorenotes{%
    \global\MFS@savingnotesfalse
    % Output saved notes to memoir's paragraph insert
    \insert\footinsv@r{\unvbox\MFS@notes}%
}
```

## Key Technical Insights

### 1. The Double Processing Trap

My first attempts failed because I was trying to process footnotes twice—once during saving and once during restoration. This led to doubled footnote marks. The solution was to format them completely during the save phase and simply output the pre-formatted box during restore.

### 2. The `\m@munvxh` Mystery

One cryptic error was "Incompatible list can't be unboxed" when using `\unhbox` on a vbox. The solution was using memoir's `\m@munvxh` macro (defined as `\unvbox\voidb@x\unvbox`) which safely converts vertical material to horizontal.

### 3. Hyperref Timing

Creating hyperref anchors at the right time is crucial. If `\Hy@footnote@currentHref` is empty when processing a footnote, the link breaks. The solution was ensuring this href exists before processing any footnote text.

### 4. Counter Synchronization

Maintaining correct footnote numbering required careful management of both `footnote` and `mpfootnote` counters, saving and restoring them at the right moments.

## The Complete Package

The final [memoir-tcolorbox.sty](memoir-tcolorbox.sty) package:
- Processes all footnotes through a unified system for consistent hyperref support
- Formats all footnotes using memoir's paragraph style
- Saves and restores footnotes from tcolorbox environments correctly
- Maintains proper numbering throughout
- Works with LuaLaTeX (and potentially XeLaTeX?)

## Lessons Learned

1. **LaTeX's Hook System is Fragile**: Small changes in processing order can break everything. Understanding the exact sequence of macro expansions is crucial.

2. **Box Manipulation is Tricky**: Converting between vertical and horizontal boxes requires deep understanding of TeX's box model. Using the wrong unboxing command leads to cryptic errors.

3. **Package Interactions are Complex**: Each package makes assumptions about how footnotes work. When those assumptions conflict, you need to understand all the internals to build a bridge.

4. **Debug Output is Essential**: Liberal use of `\typeout` for debugging saved hours of guesswork. Seeing exactly when and how each footnote was processed revealed the subtle timing issues.

5. **Reading Source Code Beats Documentation**: While documentation tells you what a package does, reading the actual `.sty` or `.dtx` files shows you HOW it does it.

## Usage

For anyone facing the same issue, here's how to use the solution:

```latex
\documentclass[12pt]{memoir}
\usepackage{hyperref}
\usepackage{memoir-tcolorbox}  % Our custom package
\usepackage{tcolorbox}
\paragraphfootnotes

\begin{document}
Normal footnote\footnote{This appears as a paragraph footnote with working hyperref link.}

\begin{tcolorbox}
Boxed footnote\footnote{This also appears as a paragraph footnote on the main page!}
\end{tcolorbox}
\end{document}
```
