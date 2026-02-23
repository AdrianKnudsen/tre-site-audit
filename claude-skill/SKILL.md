---
name: claude-skill
description: Automated website audit tool covering UX, UI, accessibility (WCAG 2.1), best practices, and performance. Runs locally via Node.js/Express with integrated Lighthouse, full CSS/JS asset analysis, and Claude AI for visual evaluation.
---

# TRE Bergen Website Audit

Comprehensive website auditor with token-optimized architecture. Covers 101 criteria across UX, UI, accessibility, and best practices. Delivers branded HTML reports in Norwegian and English.

## ARCHITECTURE (v2.0)

This application is a **fully integrated Node.js/Express webapp** that automates the entire audit process:

### Technology Stack

- **Lighthouse** — Local performance/accessibility analysis via headless Chrome (no API key needed)
- **assetFetcher.js** — Fetches all external CSS and JS files referenced in the page, including `@import` resolution
- **pre-audit.py (v2.0)** — Automated HTML + CSS + JS analysis (~55–60 of 101 criteria)
- **sitemapAnalyzer.js** — Parses sitemap.xml to assess URL depth for 3-click rule evaluation
- **Claude API** — Visual/subjective evaluation of remaining ~40–45 checks
- **Express/SSE** — Real-time progress streaming to the browser
- **reportBuilder.js** — HTML report generation with embedded fonts and brand identity

### Token Optimization

By running deterministic checks first in Python, Claude only needs to evaluate the subjective/visual criteria that require AI judgment:

| Step                             | Checks           | Tokens (approx.)    |
| -------------------------------- | ---------------- | ------------------- |
| Pre-audit v1.0 (HTML only)       | ~30 automated    | ~15,000 total       |
| Pre-audit v2.0 (HTML + CSS + JS) | ~55–60 automated | ~8,000–10,000 total |
| Claude evaluates                 | ~40–45 remaining | —                   |

**v2.0 saves ~40–47% in Claude API costs** compared to asking Claude to evaluate all 101 criteria.

---

## HOW IT WORKS LOCAL

### User Flow

1. User visits `http://localhost:3000`
2. Enters website URL + Claude API key
3. Clicks "Start revisjon"
4. Watches real-time progress (SSE stream)
5. Downloads/prints branded HTML report

### Backend Pipeline

```
1. Parallel data collection
   ├─ Lighthouse (desktop + mobile) → performance/accessibility scores
   ├─ fetchPage.js → full HTML source
   └─ sitemapAnalyzer.js → URL depth distribution

2. Fetch external assets
   └─ assetFetcher.js → downloads all CSS/JS files
      ├─ Resolves @import chains recursively
      ├─ Combines all CSS into one blob
      └─ Combines all JS into one blob

3. Pre-Audit (Python v2.0)
   ├─ HTML analysis: alt text, meta tags, headings, ARIA, forms, etc.
   ├─ CSS analysis: breakpoints, font-families, colors, focus styles,
   │               hover states, flexbox/grid, transitions
   ├─ JS analysis: keyboard listeners, touch events, form validation,
   │               error handling, focus management, ARIA manipulation
   └─ Outputs findings.json with pass/warn/fail/NEEDS_AI_REVIEW per check

4. Claude Audit (API)
   ├─ Receives HTML + compressed CSS + compressed JS
   ├─ Receives pre-audit summary (automated results + hints)
   ├─ Evaluates only NEEDS_AI_REVIEW checks (~40–45):
   │  ├─ Visual hierarchy and reading flow
   │  ├─ Color contrast (perceived)
   │  ├─ Typography consistency
   │  ├─ Navigation usability
   │  ├─ CTA clarity
   │  ├─ Mobile interaction design
   │  └─ Subjective UX/UI/accessibility criteria
   └─ Returns structured JSON (pass/warn/fail + notes + recommendations)

5. Merge Results
   └─ claudeAudit.js merges pre-audit + Claude findings into one structure

6. Report Builder
   ├─ Combines Lighthouse + merged audit data
   ├─ Embeds brand fonts as base64 data URIs (portable report)
   ├─ Generates bilingual HTML (Norwegian + English toggle)
   └─ Streams final HTML to browser
```

---

## FILE STRUCTURE

```
tre-site-audit/
├── server.js                    # Express server + SSE endpoint + audit pipeline
├── lib/
│   ├── pagespeed.js            # Lighthouse wrapper (desktop + mobile, sequential)
│   ├── fetchPage.js            # HTML fetcher (full content, no truncation)
│   ├── assetFetcher.js         # External CSS/JS downloader with @import resolution
│   ├── sitemapAnalyzer.js      # sitemap.xml parser + URL depth analysis
│   ├── preAudit.js             # Orchestrates Python pre-audit + asset injection
│   ├── claudeAudit.js          # Claude API client, token budgeting, result merger
│   └── reportBuilder.js        # HTML report renderer with Lighthouse translations
├── claude-skill/
│   ├── pre-audit.py            # Automated 101-criteria HTML/CSS/JS checker (v2.0)
│   ├── audit-criteria.md       # Full 101-point checklist with Nielsen references
│   ├── site-audit.md           # Legacy Claude Code skill command definition
│   ├── SKILL.md                # This file — architecture documentation
│   └── README.md               # Overview of the claude-skill directory
└── public/
    ├── index.html              # Application UI (form + SSE progress display)
    └── js/main.js              # Frontend: SSE handling + report injection
```

---

## PRE-AUDIT.PY INTEGRATION (v2.0)

The Python script runs automatically via Node.js (`preAudit.js`) and receives three input files:

- HTML source (full, no truncation)
- Combined external CSS (fetched by `assetFetcher.js`)
- Combined external JS (fetched by `assetFetcher.js`)

### What Python checks automatically (~55–60 checks)

**Accessibility — Perceivable & Operable**

- ✅ All images have meaningful alt text (or decorative alt="")
- ✅ Page language declared (html lang attribute)
- ✅ Form labels associated with inputs (for/id or wrapping label)
- ✅ Skip-to-content link present
- ✅ Heading hierarchy correct (no skipped levels)
- ✅ ARIA roles present and not overused
- ✅ Semantic HTML elements (nav, main, article, header, footer)
- ✅ Fieldset/legend grouping for form groups
- ✅ Viewport meta tag present (no user-scalable=no)
- ✅ Reduced motion support (`prefers-reduced-motion` in CSS)
- ✅ Focus styles present in CSS (`:focus`, `:focus-visible`)
- ✅ Keyboard event listeners in JS

**Best Practices — Security & SEO**

- ✅ HTTPS enforced
- ✅ No mixed content warnings
- ✅ External links have `rel="noopener noreferrer"`
- ✅ Descriptive `<title>` tag
- ✅ Meta description present
- ✅ Canonical URL specified
- ✅ Open Graph tags present
- ✅ Structured data (JSON-LD)
- ✅ Favicon present

**Performance Hygiene**

- ✅ Images optimized (WebP/AVIF formats, lazy loading)
- ✅ No render-blocking synchronous scripts in `<head>`
- ✅ CSS/JS minified (heuristic)
- ✅ `font-display: swap` in CSS

**UX / Content**

- ✅ Navigation grouping (nav depth, multi-level menus)
- ✅ Breadcrumb present
- ✅ Search functionality
- ✅ Footer utility links
- ✅ Heading descriptiveness (length, keyword check)
- ✅ Body font size (CSS px value)
- ✅ Line height (CSS value)
- ✅ Language/jargon assessment (reading level indicators)
- ✅ Keyboard shortcuts / accelerators (accesskeys, JS keyboard listeners)
- ✅ Autocomplete on form inputs
- ✅ Form validation (inline JS validation patterns)
- ✅ Error handling patterns in JS
- ✅ Loading state indicators in JS
- ✅ Trust signals (testimonials, badges, certifications)

**UI**

- ✅ Number of font families in CSS
- ✅ Type scale (CSS heading sizes)
- ✅ Spacing system (CSS custom properties / 8px grid)
- ✅ Responsive breakpoints in CSS
- ✅ Flexbox / CSS Grid usage
- ✅ Hover and active states in CSS
- ✅ Color palette size and consistency
- ✅ Button/form field consistency (CSS selector patterns)

### What Claude evaluates (~40–45 checks)

All checks marked `NEEDS_AI_REVIEW` require visual judgment:

- 🤖 Visual hierarchy and reading flow (F/Z-pattern)
- 🤖 Perceived color contrast and harmony
- 🤖 Typography feel and consistency
- 🤖 CTA immediately identifiable
- 🤖 Interactive affordances (do elements look clickable?)
- 🤖 Content quality and value proposition clarity
- 🤖 Mobile UX (thumb zone, swipe, no hover-only interactions)
- 🤖 Cognitive load and clutter
- 🤖 Recognition over recall (UI surfaces options)
- 🤖 404/error page design
- 🤖 ...and ~30 more subjective criteria

---

## CLAUDE API INTEGRATION

### Input to Claude (per audit)

```
URL: https://example.com

PRE-AUDIT RESULTS (v2.0 — HTML + CSS + JS analyzed):
- 57 checks completed automatically
- 44 checks need your visual evaluation

DETECTED FRAMEWORKS: Bootstrap 5
ANALYSIS SCOPE: 320KB total (HTML: 45KB, CSS: 180KB, JS: 95KB)
CSS ANALYSIS (from 42 colors, 3 fonts):
- Breakpoints: 576px, 768px, 992px, 1200px
- Layout: flexbox grid
- States: hover focus

AUTOMATED (done — do NOT re-evaluate):
a11y_perceivable: All images have meaningful alt text [pass]
bp_security: HTTPS enforced [pass]
...

FOCUS ON THESE 44 CHECKS ONLY:
ux_hierarchy: Visual weight guides the eye through content
ui_color: Sufficient contrast ratios (4.5:1 for normal text)
...

FULL HTML (45KB): [complete source]
CSS (compressed, 120KB): [all stylesheets]
JAVASCRIPT (compressed, 60KB): [all scripts]
```

### Token budget management (claudeAudit.js)

Claude's 200K context window is allocated as follows:

1. System prompt + criteria list (~3,000 tokens reserved)
2. Full HTML (variable — sent without truncation)
3. CSS after compression (proportional share of remaining budget)
4. JS after compression (proportional share of remaining budget)
5. Output reserve: 32,000 tokens for the full 101-check JSON

CSS and JS are compressed before sending:

- Block comments removed
- Vendor-prefixed duplicates removed
- `@keyframes` bodies collapsed (only name kept)
- Long property values truncated at 120 chars
- Minified lines > 500 chars in JS replaced with a placeholder
- If still over budget: proportional truncation with a notice

### Merge Logic (`mergeAuditResults()`)

After Claude returns results:

1. Pre-audit findings (pass/warn/fail) overwrite `NEEDS_AI_REVIEW` placeholders
2. Claude's evaluations fill in the visual/subjective checks
3. If Claude already evaluated a pre-audited check, Claude's assessment takes precedence (unless it's `na`)
4. Result is a unified 101-check JSON matching the report template structure

---

## REPORT OUTPUT

The final self-contained HTML report includes:

**Executive Summary** (Norwegian + English)

- 2–3 sentence overview from "we" perspective (TRE Bergen → client)
- Highlights the most important positive and the biggest opportunity

**Domain Score Cards** (with ring progress indicators)

- UX, UI, Accessibility, Best Practices — each scored pass/warn/fail count

**Stacked Bar Chart** — visual breakdown across all four domains

**Lighthouse Gauges** (desktop + mobile)

- Performance, Accessibility, Best Practices, SEO
- Core Web Vitals: FCP, LCP, TBT, CLS, SI with color-coded bars
- Top failing Lighthouse audits translated to Norwegian

**Detailed Findings** — 101 individual checks, expandable rows with:

- pass / warn / fail / n/a status
- Short note + full details + recommendation (Norwegian + English)

**Priority Fixes** — top 5–10 issues ranked by severity + business impact

**Customer Summary** — 4–5 paragraphs in plain language, no technical jargon, suitable for non-technical clients

---

## RUNNING THE APPLICATION

### Installation

```bash
npm install
```

### Start Server

```bash
npm start
# or with auto-reload:
npm run dev
```

### Access

Open `http://localhost:3000` in your browser.

### Requirements

- Node.js 18+
- Python 3.8+ (stdlib only — no pip installs required)
- Chrome/Chromium (for Lighthouse)
- Claude API key (entered by user in the UI — never stored server-side)

---

## TROUBLESHOOTING

### Lighthouse Errors

- **Chrome launch fails** → Ensure Chrome/Chromium is installed and accessible
- **Slow results** → Lighthouse runs desktop and mobile sequentially to avoid conflicts

### Pre-Audit Errors

- **Python not found** → Ensure `python3` is in PATH
- **Module errors** → `pre-audit.py` uses only Python stdlib (no pip install needed)

### Asset Fetcher

- **CSS/JS not fetched** → Site may block automated requests; pre-audit falls back to HTML-only analysis
- **Large bundles** → Asset fetcher has a 60s total timeout and compresses before sending to Claude

### Claude API Errors

- **Connection timeout** → Default timeout is 5 minutes; complex pages with large HTML may be slow
- **Token limit exceeded** → CSS/JS are compressed and truncated proportionally to fit the 200K context
- **Invalid JSON response** → Claude occasionally wraps JSON in markdown fences; the parser handles this automatically

---

## PERFORMANCE

**Typical audit duration**:

- Lighthouse (desktop + mobile, sequential): ~40–60s
- Asset fetching (CSS + JS): ~5–15s
- Pre-audit (Python, HTML + CSS + JS): ~2–5s
- Claude evaluation: ~15–40s
- Report generation: ~1s
- **Total: ~60–120 seconds** (varies by site size and Claude response time)

**Token usage (with pre-audit v2.0)**:

- HTML only sites: ~5,000–8,000 input tokens for Claude
- Sites with large CSS/JS: ~15,000–40,000 tokens (compressed assets included)
- Output (full 101-check JSON): ~8,000–12,000 tokens

---

**Version**: 2.0.0
**Last Updated**: 2026-02-23
**Architecture**: Node.js/Express + Lighthouse + Python + Claude API
