/**
 * Pre-Audit wrapper - calls Python script to run automated HTML/CSS/JS checks
 * Fetches external assets (CSS/JS) and passes them alongside HTML for deeper analysis.
 * This saves AI tokens by automatically checking ~50+ of the 101 criteria.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchExternalAssets } from './assetFetcher.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPreAudit(html, url) {
  const ts = Date.now();
  const tmpHtmlPath = `/tmp/audit-${ts}.html`;
  const tmpCssPath = `/tmp/audit-${ts}.css`;
  const tmpJsPath = `/tmp/audit-${ts}.js`;
  const tmpOutputPath = `/tmp/pre-audit-${ts}.json`;

  try {
    // Fetch external CSS and JS in parallel with writing HTML
    const [assets] = await Promise.all([
      fetchExternalAssets(html, url),
      fs.writeFile(tmpHtmlPath, html, 'utf-8'),
    ]);

    // Write CSS and JS to temp files
    await Promise.all([
      fs.writeFile(tmpCssPath, assets.css || '', 'utf-8'),
      fs.writeFile(tmpJsPath, assets.js || '', 'utf-8'),
    ]);

    // Path to Python script
    const pythonScript = path.join(__dirname, '..', 'claude-skill', 'pre-audit.py');

    // Run Python pre-audit script with CSS and JS paths
    const { stdout, stderr } = await execAsync(
      `python3 "${pythonScript}" "${tmpHtmlPath}" "${url}" --css "${tmpCssPath}" --js "${tmpJsPath}" -o "${tmpOutputPath}"`,
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
    );

    if (stderr) {
      console.log('[PreAudit]', stderr.trim());
    }

    // Read the output JSON
    const resultJson = await fs.readFile(tmpOutputPath, 'utf-8');
    const preAuditResults = JSON.parse(resultJson);

    // Attach raw CSS/JS content so Claude can inspect them too
    preAuditResults._rawCSS = assets.css || '';
    preAuditResults._rawJS = assets.js || '';

    // Clean up temp files
    const cleanup = [tmpHtmlPath, tmpCssPath, tmpJsPath, tmpOutputPath];
    await Promise.all(cleanup.map(f => fs.unlink(f).catch(() => {})));

    return preAuditResults;

  } catch (error) {
    // Clean up on error
    const cleanup = [tmpHtmlPath, tmpCssPath, tmpJsPath, tmpOutputPath];
    await Promise.all(cleanup.map(f => fs.unlink(f).catch(() => {})));

    throw new Error(`Pre-audit failed: ${error.message}`);
  }
}

export { runPreAudit };
