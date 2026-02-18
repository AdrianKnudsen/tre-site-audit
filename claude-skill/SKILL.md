---
name: website-audit
description: Automated website audit tool covering UX, UI, accessibility (WCAG), best practices, and performance. Runs locally via Node.js/Express with integrated Lighthouse and pre-audit automation.
version: 1.0.0
---

# TRE Bergen Website Audit

Comprehensive website auditor with token-optimized architecture. Delivers branded HTML reports in Norwegian and English.

## ARCHITECTURE (v1.0)

This application is a **fully integrated Node.js/Express webapp** that automates the entire audit process:

### Technology Stack
- **Lighthouse** - Local performance/accessibility analysis (no API key needed)
- **pre-audit.py** - Automated HTML checks (~30 of 64 criteria)
- **Claude API** - Visual/subjective evaluation (~35 checks)
- **Express/SSE** - Real-time progress streaming
- **reportBuilder.js** - HTML report generation

### Token Optimization
- **Before**: Claude evaluates all 87 criteria (~15,000 tokens)
- **After**: Claude evaluates only 35 visual/subjective checks (~8,000 tokens)
- **Savings**: ~47% reduction in Claude API costs

## HOW IT WORKS

### User Flow
1. User visits `http://localhost:3000`
2. Enters website URL + Claude API key
3. Clicks "Start revisjon"
4. Watches real-time progress
5. Downloads/prints branded HTML report

### Backend Pipeline

```
1. Lighthouse (desktop + mobile)
   ├─ Performance metrics
   ├─ Accessibility scores
   ├─ Best practices
   └─ SEO scores

2. Fetch HTML source
   └─ Save for analysis

3. Pre-Audit (Python)
   ├─ Alt text validation
   ├─ Meta tags check
   ├─ Heading hierarchy
   ├─ Form labels
   ├─ HTTPS enforcement
   ├─ External link security
   └─ ~25 more checks
   → Produces pre-audit-results.json

4. Claude Audit (API)
   ├─ Receives pre-audit results
   ├─ Identifies NEEDS_AI_REVIEW items
   ├─ Evaluates only visual/subjective checks:
   │  ├─ Visual hierarchy
   │  ├─ Color contrast (visual)
   │  ├─ Typography consistency
   │  ├─ Navigation usability
   │  ├─ CTA visibility
   │  └─ ~30 more subjective checks
   └─ Merges with automated results

5. Report Builder
   ├─ Combines Lighthouse + pre-audit + Claude data
   ├─ Applies TRE Bergen branding
   ├─ Generates bilingual HTML (NO/EN)
   └─ Returns to user
```

## FILE STRUCTURE

```
tre-site-audit/
├── server.js                    # Express server + SSE endpoint
├── lib/
│   ├── pagespeed.js            # Lighthouse wrapper
│   ├── fetchPage.js            # HTML fetcher
│   ├── preAudit.js             # Python pre-audit.py wrapper
│   ├── claudeAudit.js          # Claude API + merge logic
│   └── reportBuilder.js        # HTML report generator
├── site-auditor-upgrade/
│   └── pre-audit.py            # Automated HTML checker
└── public/
    ├── index.html              # Landing page
    └── js/main.js              # Frontend logic
```

## PRE-AUDIT.PY INTEGRATION

The Python script runs automatically via Node.js wrapper:

**Automated Checks (30 total)**:
- ✅ All images have alt text
- ✅ Page language declared (lang attribute)
- ✅ Form labels associated with inputs
- ✅ Skip-to-content link present
- ✅ Heading hierarchy correct
- ✅ ARIA roles used appropriately
- ✅ Semantic HTML elements
- ✅ HTTPS enforced
- ✅ No mixed content warnings
- ✅ External links have rel="noopener noreferrer"
- ✅ Descriptive <title> tag
- ✅ Meta description present
- ✅ Canonical URL specified
- ✅ Open Graph tags present
- ✅ Structured data (JSON-LD)
- ✅ Viewport meta tag
- ✅ Favicon present
- ✅ Images optimized (WebP/AVIF, lazy loading)
- ✅ No render-blocking scripts
- ...and 11 more

**AI Review Required (35 total)**:
- 🤖 Visual hierarchy clear
- 🤖 Color contrast meets WCAG AA
- 🤖 Typography consistency
- 🤖 Navigation grouping logical
- 🤖 CTA immediately identifiable
- 🤖 Interactive elements look clickable
- 🤖 Feedback on user actions
- 🤖 Whitespace adequate
- 🤖 Responsive layout adapts
- 🤖 Keyboard accessibility
- 🤖 Focus indicators visible
- ...and 24 more

## CLAUDE API INTEGRATION

### Prompt Optimization
When pre-audit results are available, Claude receives:
```
PRE-AUDIT RESULTS:
- 30 checks completed automatically
- 35 checks need your visual evaluation

AUTOMATED CHECKS (already done):
a11y_perceivable: All images have meaningful alt text [pass]
a11y_understandable: Page language declared [pass]
bp_security: HTTPS enforced [pass]
...

FOCUS YOUR EVALUATION ON THESE 35 CHECKS:
ux_hierarchy: Visual weight guides the eye through content
ui_color: Sufficient contrast ratios (4.5:1 for normal text)
a11y_operable: Visible focus indicator on interactive elements
...

HTML SOURCE CODE:
[truncated to 30,000 chars]

IMPORTANT: Focus only on the visual/subjective checks listed above.
```

### Merge Logic
`mergeAuditResults()` in [claudeAudit.js](../lib/claudeAudit.js) combines:
1. Automated findings from pre-audit.py (status: pass/warn/fail)
2. Claude's visual evaluations (NEEDS_AI_REVIEW → pass/warn/fail)
3. Maps pre-audit categories to Claude's JSON structure

## REPORT OUTPUT

The final HTML report includes:

**Executive Summary** (Norwegian + English)
- Overall score and rating
- Critical issues highlighted
- Top 5-10 priority fixes

**Domain Scores**
- UX: Navigation, Content, Interaction, Cognitive Load
- UI: Hierarchy, Typography, Color, Spacing, Components
- Accessibility: Perceivable, Operable, Understandable, Robust
- Best Practices: Performance, Security, SEO, Code Quality

**Lighthouse Metrics**
- Performance, Accessibility, Best Practices, SEO scores
- Core Web Vitals (FCP, LCP, TBT, CLS, SI)
- Desktop + Mobile comparison

**Detailed Findings**
- 64 individual checks with pass/warn/fail/n/a status
- Norwegian + English descriptions
- Recommendations for failed checks

**Customer Summary**
- 3-5 paragraphs in plain language
- Non-technical audience friendly

## RUNNING THE APPLICATION

### Installation
```bash
npm install
```

### Start Server
```bash
npm start
# or
node server.js
```

### Access
Open `http://localhost:3000` in browser

### Requirements
- Node.js v22+
- Python 3.x (for pre-audit.py)
- Chrome/Chromium (for Lighthouse)
- Claude API key

## TROUBLESHOOTING

### Lighthouse Errors
- **"performance mark has not been set"** → Fixed by running desktop/mobile sequentially
- **Chrome launch fails** → Check Chrome is installed, try `chrome-launcher` flags

### Pre-Audit Errors
- **Python not found** → Ensure `python3` is in PATH
- **Module errors** → Pre-audit.py uses only stdlib (no dependencies)

### Claude API Errors
- **Connection timeout** → Check API key, network, timeout set to 120s
- **Invalid model** → Using `claude-sonnet-4-5-20250929`
- **Token limit** → HTML truncated to 30,000 chars

## PERFORMANCE

**Typical audit duration**:
- Lighthouse (desktop): ~20-30s
- Lighthouse (mobile): ~20-30s
- Pre-audit: ~1-2s
- Claude evaluation: ~10-20s
- Report generation: ~1s
- **Total: 50-80 seconds**

**Token usage**:
- Without pre-audit: ~15,000 input tokens
- With pre-audit: ~8,000 input tokens
- **Savings: ~47%**

## FUTURE ENHANCEMENTS

- [ ] Screenshot-based visual evaluation
- [ ] Accessibility tree analysis
- [ ] Console error detection
- [ ] Network waterfall analysis
- [ ] Historical comparison tracking
- [ ] Multi-page audit support
- [ ] CI/CD integration
- [ ] Docker containerization

---

**Version**: 1.0.0
**Last Updated**: 2026-02-17
**Architecture**: Node.js/Express + Lighthouse + Python + Claude API
