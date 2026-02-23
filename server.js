/**
 * TRE Bergen Website Audit — Express Server
 *
 * Entry point for the application. Coordinates the full audit pipeline:
 * receives a URL and Claude API key from the user, runs all analysis steps
 * in order, and streams live progress back to the browser via Server-Sent
 * Events (SSE).
 *
 * Audit pipeline (POST /api/audit):
 *   1. In parallel: Lighthouse (desktop + mobile), HTML fetch, sitemap analysis
 *   2. Fetch all external CSS and JS files (preAudit.js → assetFetcher.js)
 *   3. Run Python pre-audit: ~55–60 deterministic checks on HTML + CSS + JS
 *   4. Run Claude audit: AI evaluates the remaining ~40–45 visual/subjective criteria
 *   5. Build HTML report: merge all results and render the final report
 *
 * Endpoints:
 *   GET  /              → Serves the landing page (public/index.html)
 *   POST /api/audit     → SSE stream that runs the full audit pipeline
 *
 * SSE event types sent to the client:
 *   { type: 'progress', step, message_no, message_en }  — progress update
 *   { type: 'complete', report }                        — final HTML report
 *   { type: 'error',   message_no, message_en }         — error message
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPageSpeedData } from './lib/pagespeed.js';
import { fetchPageHtml } from './lib/fetchPage.js';
import { runPreAudit } from './lib/preAudit.js';
import { runClaudeAudit } from './lib/claudeAudit.js';
import { buildReport } from './lib/reportBuilder.js';
import { analyzeSitemap } from './lib/sitemapAnalyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== SSE Audit Endpoint =====
app.post('/api/audit', async (req, res) => {
  const { url, apiKey } = req.body;

  if (!url || !apiKey) {
    return res.status(400).json({ error: 'Both url and apiKey are required' });
  }

  // Validate URL format
  let targetUrl;
  try {
    targetUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    // Step 1: Fetch PageSpeed data + page HTML in parallel
    send('progress', { step: 1, message_no: 'Henter PageSpeed Insights-data (desktop + mobil)...', message_en: 'Fetching PageSpeed Insights data (desktop + mobile)...' });

    const [pageSpeedData, pageHtml, sitemapData] = await Promise.all([
      getPageSpeedData(targetUrl.href),
      fetchPageHtml(targetUrl.href),
      analyzeSitemap(targetUrl.href).catch(err => {
        console.warn('[Sitemap] Analysis failed:', err.message);
        return null;
      }),
    ]);

    if (sitemapData?.hasSitemap) {
      console.log(`[Sitemap] Found ${sitemapData.totalUrls} URLs, max depth: ${sitemapData.maxDepth}`);
    }

    send('progress', { step: 2, message_no: 'Henter CSS/JS-filer og kjører full automatisk analyse...', message_en: 'Fetching CSS/JS files and running full automated analysis...' });

    // Step 2: Run pre-audit (automated checks)
    const preAuditData = await runPreAudit(pageHtml, targetUrl.href);

    // Inject sitemap data into pre-audit results for Claude context
    if (sitemapData && preAuditData) {
      preAuditData.sitemapAnalysis = sitemapData;
    }

    // Step 3: Run Claude audit (only visual/subjective checks)
    send('progress', { step: 3, message_no: 'Claude evaluerer visuelle og subjektive kriterier...', message_en: 'Claude evaluating visual and subjective criteria...' });

    const claudeData = await runClaudeAudit(pageHtml, targetUrl.href, apiKey, preAuditData);

    send('progress', { step: 4, message_no: 'AI-evaluering fullført. Genererer rapport...', message_en: 'AI evaluation complete. Generating report...' });

    // Step 4: Build HTML report
    const reportHtml = buildReport(pageSpeedData, claudeData, targetUrl.href);

    send('complete', { report: reportHtml });

  } catch (error) {
    console.error('Audit error:', error);
    send('error', {
      message_no: `Feil under revisjon: ${error.message}`,
      message_en: `Audit error: ${error.message}`,
    });
  } finally {
    res.end();
  }
});

// ===== Start server =====
app.listen(PORT, () => {
  console.log(`\n  TRE Bergen Site Audit running at http://localhost:${PORT}\n`);
});
