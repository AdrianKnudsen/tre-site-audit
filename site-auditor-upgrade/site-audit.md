---
description: Run a full website audit (UX, UI, accessibility, performance)
argument-hint: <url>
allowed-tools: Read, Write, Bash, Grep, Glob, WebFetch, Task
---

Run a comprehensive website audit on the URL: $ARGUMENTS

Follow these steps precisely:

## 1. Prepare

Read the website-audit skill at `${CLAUDE_PLUGIN_ROOT}/skills/website-audit/SKILL.md` and the criteria at `${CLAUDE_PLUGIN_ROOT}/skills/website-audit/references/audit-criteria.md`.

**CRITICAL**: Do NOT read `report-template.html` — the Python script handles template rendering automatically. Do NOT read raw PageSpeed JSON files — the bash script extracts only the compact data you need.

## 2. Run PageSpeed Insights + Automated Pre-Audit

Run these commands in bash. Do NOT read the raw JSON output files.

```bash
# PageSpeed API (desktop + mobile)
curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=$ARGUMENTS&category=performance&category=accessibility&category=best-practices&category=seo&strategy=desktop" -o /tmp/pagespeed-report.json
curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=$ARGUMENTS&category=performance&category=accessibility&category=best-practices&category=seo&strategy=mobile" -o /tmp/pagespeed-report-mobile.json
bash ${CLAUDE_PLUGIN_ROOT}/skills/website-audit/references/extract-pagespeed.sh /tmp/pagespeed-report.json /tmp/pagespeed-report-mobile.json > /tmp/pagespeed-extracted.json

# Automated HTML analysis (~25-30 checks done by Python, not AI)
curl -sL "$ARGUMENTS" -o /tmp/page-source.html
python3 ${CLAUDE_PLUGIN_ROOT}/skills/website-audit/references/pre-audit.py /tmp/page-source.html "$ARGUMENTS" -o /tmp/pre-audit-results.json
```

Read `/tmp/pagespeed-extracted.json` AND `/tmp/pre-audit-results.json`.

## 3. Browser Evaluation (only visual checks)

Use Claude in Chrome browser tools to:
1. Navigate to the URL
2. Take ONE screenshot
3. Use `read_page` for the accessibility tree
4. Check console errors

**IMPORTANT**: Only evaluate checks marked `NEEDS_AI_REVIEW` in the pre-audit results. Automated checks are pre-filled — just use them as-is (override only if your visual assessment clearly contradicts).

## 4. Evaluate NEEDS_AI_REVIEW Items Only

Work through only the checks that have `status: "NEEDS_AI_REVIEW"` in the pre-audit results. These are the visual/subjective checks that require your screenshot and accessibility tree analysis. For each, assign: pass, warn, fail, or n/a.

## 5. Generate Report

Merge findings: take the pre-audit automated findings + your AI evaluations + PageSpeed data. Remove the `automated` field from all findings. Write everything into `/tmp/audit-data.json` following the schema in SKILL.md. Then run:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/website-audit/references/generate-report.py /tmp/audit-data.json /path/to/output/audit-domain-com.html
```

The report includes: executive summary with score cards and charts, Lighthouse gauges (desktop + mobile), expandable finding rows per domain, priority fixes, and a customer-friendly summary. All in Norwegian with English toggle. Styled with Tre Bergen brand identity.

Save the HTML report with a filename based on the domain name, e.g. `audit-example-com.html`.
