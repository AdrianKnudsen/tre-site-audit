/**
 * Pre-Audit wrapper - calls Python script to run automated HTML checks
 * This saves AI tokens by automatically checking ~25-30 of the 64 criteria
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPreAudit(html, url) {
  // Write HTML to temporary file
  const tmpHtmlPath = `/tmp/audit-${Date.now()}.html`;
  const tmpOutputPath = `/tmp/pre-audit-${Date.now()}.json`;

  try {
    await fs.writeFile(tmpHtmlPath, html, 'utf-8');

    // Path to Python script
    const pythonScript = path.join(__dirname, '..', 'site-auditor-upgrade', 'pre-audit.py');

    // Run Python pre-audit script
    const { stdout, stderr } = await execAsync(
      `python3 "${pythonScript}" "${tmpHtmlPath}" "${url}" -o "${tmpOutputPath}"`,
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
    );

    // Read the output JSON
    const resultJson = await fs.readFile(tmpOutputPath, 'utf-8');
    const preAuditResults = JSON.parse(resultJson);

    // Clean up temp files
    await fs.unlink(tmpHtmlPath).catch(() => {});
    await fs.unlink(tmpOutputPath).catch(() => {});

    return preAuditResults;

  } catch (error) {
    // Clean up on error
    await fs.unlink(tmpHtmlPath).catch(() => {});
    await fs.unlink(tmpOutputPath).catch(() => {});

    throw new Error(`Pre-audit failed: ${error.message}`);
  }
}

export { runPreAudit };
