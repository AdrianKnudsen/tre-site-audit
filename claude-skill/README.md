# claude-skill/

This directory serves two purposes:

1. **Active — `pre-audit.py`**: The Python checker that runs automatically as part of every audit. Called by [`lib/preAudit.js`](../lib/preAudit.js) via subprocess.

2. **Reference / legacy — `site-audit.md`, `SKILL.md`**: Documentation and a Claude Code skill definition from an earlier standalone version of the auditor. Kept for reference but not used by the webapp.

---

## Files

### `pre-audit.py` — Automated HTML/CSS/JS Checker (v2.0) *(active)*

The core automated analysis script. Parses the raw HTML, external CSS, and external JS to pre-fill ~55–60 of the 101 audit criteria — without any AI involvement.

**Inputs** (passed by `preAudit.js`):
- `<html-file>` — full page HTML saved to a temp file
- `<url>` — original page URL (used for relative URL resolution)
- `--css <css-file>` — combined external CSS (fetched by `assetFetcher.js`)
- `--js <js-file>` — combined external JS (fetched by `assetFetcher.js`)
- `-o <output.json>` — path for the JSON results file

**Output**: A JSON file with `findings` grouped by audit category, each finding having a `status` of `pass`, `warn`, `fail`, or `NEEDS_AI_REVIEW`. The `NEEDS_AI_REVIEW` items are the visual/subjective checks passed on to Claude.

**Dependencies**: Python stdlib only — no `pip install` required.

---

### `audit-criteria.md` — Complete 101-Point Checklist *(reference)*

The authoritative list of all 101 audit criteria, organised by domain and subcategory:
- UX (30 checks): Navigation, Content, Interaction, Cognitive Load
- UI (27 checks): Hierarchy, Typography, Color, Spacing, Components
- Accessibility / WCAG 2.1 (23 checks): Perceivable, Operable, Understandable, Robust
- Best Practices (21 checks): Performance, Security, SEO, Code Quality

Also includes Lighthouse metric thresholds and a mapping to Nielsen's 10 Usability Heuristics.

---

### `SKILL.md` — Architecture Documentation *(reference)*

Detailed technical documentation of the application architecture, including:
- Backend pipeline (step-by-step)
- What `pre-audit.py` checks vs. what Claude evaluates
- Claude token budget management and CSS/JS compression strategy
- Merge logic for combining pre-audit and Claude results
- Report output structure
- Troubleshooting guide

---

### `site-audit.md` — Legacy Skill Command Definition *(legacy)*

A Claude Code skill file (slash command) from a previous standalone version of the auditor that ran entirely inside Claude Code — without a Node.js server. It invoked PageSpeed Insights via `curl`, ran `pre-audit.py` manually, and used browser tools for visual screenshots.

This approach was replaced by the integrated Node.js/Express webapp (`server.js` + `lib/`) which is faster, fully automated, and supports real-time streaming.

**Not used by the current application.**

---

## Relationship to the main app

```
server.js
  └─ lib/preAudit.js
       └─ spawns: python3 claude-skill/pre-audit.py
```

Everything else in this directory is documentation and reference material.
