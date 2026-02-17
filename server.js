/**
 * TRE Bergen Website Audit — Express Server
 *
 * Endpoints:
 *   GET  /              → Landing page
 *   POST /api/audit     → SSE stream that runs the full audit
 */

const express = require('express');
const path = require('path');
const { getPageSpeedData } = require('./lib/pagespeed');
const { fetchPageHtml } = require('./lib/fetchPage');
const { runClaudeAudit } = require('./lib/claudeAudit');
const { buildReport } = require('./lib/reportBuilder');

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

    const [pageSpeedData, pageHtml] = await Promise.all([
      getPageSpeedData(targetUrl.href, apiKey),
      fetchPageHtml(targetUrl.href),
    ]);

    send('progress', { step: 2, message_no: 'PageSpeed-data hentet. Starter AI-evaluering...', message_en: 'PageSpeed data fetched. Starting AI evaluation...' });

    // Step 2: Run Claude audit
    send('progress', { step: 3, message_no: 'Claude analyserer sidens HTML mot 87 kriterier...', message_en: 'Claude is analyzing the page HTML against 87 criteria...' });

    const claudeData = await runClaudeAudit(pageHtml, targetUrl.href, apiKey);

    send('progress', { step: 4, message_no: 'AI-evaluering fullført. Genererer rapport...', message_en: 'AI evaluation complete. Generating report...' });

    // Step 3: Build HTML report
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
