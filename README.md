# TRE Site Audit

A full-stack web application for performing comprehensive website audits — combining automated technical analysis with AI-powered visual and UX evaluation to deliver professional, actionable reports.

---

## Overview

TRE Site Audit evaluates websites across **101 criteria** spanning four domains:

- **UX** — Navigation, information architecture, calls-to-action, user flow, cognitive load
- **UI** — Visual hierarchy, typography, spacing, consistency, responsive design
- **Accessibility** — WCAG 2.1 compliance, semantic HTML, ARIA, keyboard navigation
- **Best Practices** — SEO, security headers, meta tags, performance hygiene

The tool uses a hybrid approach: deterministic automated checks for objective criteria (~55–60 checks handled by Python), and Claude (Anthropic's AI) for subjective visual and experiential evaluation (~40–45 checks). Results are combined into a bilingual (Norwegian/English) HTML report, complete with Lighthouse performance metrics and a prioritised list of recommended fixes.

---

## How It Works

```
User submits URL + Anthropic API key
          │
          ▼
┌─────────────────────────────┐
│  Parallel data collection   │
│  ├─ Lighthouse (desktop +   │
│  │   mobile) via headless   │
│  │   Chrome                 │
│  ├─ Raw HTML fetch          │
│  └─ Sitemap analysis        │
└─────────────┬───────────────┘
              │
              ▼
   Fetch external CSS + JS assets
   (all stylesheets + scripts,
    with @import resolution)
              │
              ▼
   Automated pre-audit (Python)
   ~55–60 deterministic checks
   (alt text, heading hierarchy,
    ARIA, meta tags, HTTPS,
    CSS breakpoints, JS patterns, etc.)
              │
              ▼
   Claude AI audit
   Evaluates remaining ~40–45 criteria
   against full 101-point checklist
   (visual design, UX patterns,
    subjective accessibility)
              │
              ▼
   Merge results → Build report
   (scores, findings, priority fixes,
    Lighthouse metrics, bilingual notes)
              │
              ▼
   HTML report delivered to browser
   (printable + downloadable)
```

Progress is streamed to the client in real time via **Server-Sent Events (SSE)**, providing live step indicators throughout the audit.

---

## Tech Stack

**Backend**

- Node.js (ES modules) + Express.js
- Google Lighthouse + `chrome-launcher` — headless performance auditing
- Anthropic Claude API (`@anthropic-ai/sdk`) — AI-powered evaluation
- Python 3 — automated HTML/CSS/JS parsing via subprocess

**Frontend**

- Vanilla HTML5 / CSS3 / JavaScript
- Server-Sent Events for real-time progress streaming
- Custom responsive UI with TRE Bergen brand identity

**Key Libraries**

| Package             | Purpose                               |
| ------------------- | ------------------------------------- |
| `express`           | HTTP server and API routing           |
| `lighthouse`        | Core Web Vitals + performance metrics |
| `chrome-launcher`   | Headless Chrome control               |
| `@anthropic-ai/sdk` | Claude API client                     |

---

## Features

- **101-point evaluation** across UX, UI, Accessibility, and Best Practices
- **Lighthouse integration** — performance, SEO, and accessibility scores for desktop and mobile, including Core Web Vitals (FCP, LCP, CLS, TBT)
- **Full asset analysis** — fetches all external CSS and JS files for deeper automated inspection
- **Sitemap analysis** — parses sitemap.xml to assess URL depth and 3-click rule compliance
- **AI visual audit** — Claude assesses design quality, layout, and experiential factors that automated tools cannot
- **Token-efficient prompting** — pre-audit results are passed to Claude so it only evaluates the remaining ~40–45 visual/subjective checks
- **In-memory caching** — identical audits (same URL + HTML) skip redundant API calls
- **Priority recommendations** — top 5–10 findings ranked by severity and impact
- **Bilingual output** — reports in Norwegian (bokmål) and English
- **Real-time streaming** — step-by-step progress via SSE
- **Portable reports** — self-contained HTML, printable and downloadable

---

## Project Structure

```
tre-site-audit/
├── server.js                  # Express server, SSE endpoint, audit pipeline
├── lib/
│   ├── pagespeed.js           # Lighthouse runner (desktop + mobile)
│   ├── fetchPage.js           # Target page HTML fetcher
│   ├── assetFetcher.js        # External CSS/JS fetcher with @import resolution
│   ├── sitemapAnalyzer.js     # Sitemap parser for 3-click rule assessment
│   ├── preAudit.js            # Python subprocess orchestration
│   ├── claudeAudit.js         # Claude API client, token budgeting, result merger
│   └── reportBuilder.js       # HTML report renderer
├── claude-skill/
│   ├── pre-audit.py           # Deterministic HTML/CSS/JS checker (~55–60 automated checks)
│   ├── audit-criteria.md      # Full 101-point checklist with Nielsen references
│   ├── site-audit.md          # Legacy Claude Code skill command definition
│   ├── SKILL.md               # Architecture and integration documentation
│   └── README.md              # Overview of the claude-skill directory
├── public/
│   ├── index.html             # Application UI
│   ├── js/main.js             # Frontend state + SSE handling
│   └── css/
│       ├── styles.css         # Application styles
│       └── report.css         # Report template styles
└── templates/
    └── report-template.html   # Report HTML structure
```

---

## Proprietary Software — Restricted Use

This software is the exclusive intellectual property of **TRE Bergen**. All source code, design, logic, and associated assets are proprietary.

This tool is developed solely for internal use by TRE Bergen and is not licensed, distributed, or made available for use by any third party. Unauthorised use, reproduction, modification, or distribution of any part of this codebase is strictly prohibited.

© TRE Bergen AS. All rights reserved.
