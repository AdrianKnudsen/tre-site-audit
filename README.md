# TRE Site Audit

A full-stack web application for performing comprehensive website audits — combining automated technical analysis with AI-powered visual and UX evaluation to deliver professional, actionable reports.

---

## Overview

TRE Site Audit evaluates websites across **87 criteria** spanning four domains:

- **UX** — Navigation, information architecture, calls-to-action, user flow
- **UI** — Visual hierarchy, typography, spacing, consistency, responsive design
- **Accessibility** — WCAG 2.1 compliance, semantic HTML, ARIA, keyboard navigation
- **Best Practices** — SEO, security headers, meta tags, performance hygiene

The tool uses a hybrid approach: deterministic automated checks for objective criteria, and Claude (Anthropic's AI) for subjective visual and experiential evaluation. Results are combined into a bilingual (Norwegian/English) HTML report, complete with Lighthouse performance metrics and a prioritised list of recommended fixes.

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
│  └─ Raw HTML fetch          │
└─────────────┬───────────────┘
              │
              ▼
   Automated pre-audit (Python)
   ~25–30 deterministic checks
   (alt text, heading hierarchy,
    ARIA, meta tags, HTTPS, etc.)
              │
              ▼
   Claude AI audit
   Evaluates remaining criteria
   against full 87-point checklist
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

Progress is streamed to the client in real time via **Server-Sent Events (SSE)**, providing live step indicators and an estimated time remaining throughout the audit.

---

## Tech Stack

**Backend**
- Node.js (ES modules) + Express.js
- Google Lighthouse + `chrome-launcher` — headless performance auditing
- Anthropic Claude API (`@anthropic-ai/sdk`) — AI-powered evaluation
- Python 3 — automated HTML parsing via subprocess

**Frontend**
- Vanilla HTML5 / CSS3 / JavaScript
- Server-Sent Events for real-time progress streaming
- Custom responsive UI with TRE Bergen brand identity

**Key Libraries**

| Package | Purpose |
|---|---|
| `express` | HTTP server and API routing |
| `lighthouse` | Core Web Vitals + performance metrics |
| `chrome-launcher` | Headless Chrome control |
| `@anthropic-ai/sdk` | Claude API client |

---

## Features

- **87-point evaluation** across UX, UI, Accessibility, and Best Practices
- **Lighthouse integration** — performance, SEO, and accessibility scores for desktop and mobile, including Core Web Vitals (FCP, LCP, CLS, TBT)
- **AI visual audit** — Claude assesses design quality, layout, and experiential factors that automated tools cannot
- **In-memory caching** — identical audits (same URL + HTML) skip redundant API calls
- **Priority recommendations** — top 5–10 findings ranked by severity and impact
- **Bilingual output** — reports in Norwegian (bokmål) and English
- **Real-time streaming** — step-by-step progress with ETA countdown
- **Portable reports** — self-contained HTML, printable and downloadable

---

## Project Structure

```
tre-site-audit/
├── server.js                  # Express server, SSE endpoint, audit pipeline
├── lib/
│   ├── pagespeed.js           # Lighthouse runner (desktop + mobile)
│   ├── fetchPage.js           # Target page HTML fetcher
│   ├── preAudit.js            # Python subprocess orchestration
│   ├── claudeAudit.js         # Claude API client + result merger
│   └── reportBuilder.js       # HTML report renderer
├── claude-skill/
│   └── pre-audit.py           # Automated 87-criteria HTML parser
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

## Requirements

- Node.js 18+
- Python 3.8+
- Chrome or Chromium installed locally (required by Lighthouse)
- An [Anthropic API key](https://console.anthropic.com/) (provided by the user at runtime — not stored server-side)

---

## Proprietary Software — Restricted Use

This software is the exclusive intellectual property of **TRE Bergen AS**. All source code, design, logic, and associated assets are proprietary and confidential.

This tool is developed solely for internal use by TRE Bergen and is not licensed, distributed, or made available for use by any third party. Unauthorised use, reproduction, modification, or distribution of any part of this codebase is strictly prohibited.

© TRE Bergen AS. All rights reserved.
