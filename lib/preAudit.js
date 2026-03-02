/**
 * Pre-Audit orchestrator — fetches external assets and runs automated checks.
 *
 * Workflow:
 *   1. assetFetcher.js downloads all external CSS and JS files in parallel
 *   2. runPreAuditChecks() analyzes HTML + CSS + JS in pure JavaScript
 *   3. Raw CSS/JS strings are attached for Claude's visual checks
 *
 * No Python dependency — runs entirely in Node.js for Vercel compatibility.
 *
 * Exports:
 *   runPreAudit(html, url) → preAuditData object
 *     preAuditData.findings — categorised check results
 *     preAuditData._rawCSS  — combined external CSS (for Claude)
 *     preAuditData._rawJS   — combined external JS (for Claude)
 */

import { fetchExternalAssets } from './assetFetcher.js';
import { runPreAuditChecks } from './preAuditChecks.js';

async function runPreAudit(html, url) {
  try {
    // Fetch external CSS and JS in parallel
    const assets = await fetchExternalAssets(html, url);

    // Run all automated checks in pure JavaScript
    const preAuditResults = runPreAuditChecks(
      html,
      url,
      assets.css || '',
      assets.js || ''
    );

    // Attach raw CSS/JS content so Claude can inspect them too
    preAuditResults._rawCSS = assets.css || '';
    preAuditResults._rawJS = assets.js || '';

    return preAuditResults;

  } catch (error) {
    throw new Error(`Pre-audit failed: ${error.message}`);
  }
}

export { runPreAudit };
