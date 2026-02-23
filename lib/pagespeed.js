/**
 * Lighthouse wrapper — runs Lighthouse locally for desktop and mobile.
 *
 * Replaces the external PageSpeed Insights API: no API key needed,
 * results are faster, and we get full audit data including Core Web Vitals.
 *
 * Desktop and mobile are run sequentially (not in parallel) to avoid
 * Chrome resource conflicts that cause inconsistent results.
 *
 * Exports:
 *   getPageSpeedData(url) → { desktop, mobile }
 *     Each contains:
 *       scores   — { performance, accessibility, bestPractices, seo } (0–100)
 *       metrics  — { fcp, lcp, tbt, cls, si } with value + displayValue + score
 *       failingAudits — top 25 non-passing audits, sorted by score ascending
 */

import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

async function runLighthouse(url, strategy = 'desktop') {
  let chrome;

  try {
    // Launch Chrome
    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
    });

    // Configure Lighthouse options
    const options = {
      logLevel: 'error',
      output: 'json',
      onlyCategories: CATEGORIES,
      port: chrome.port,
      formFactor: strategy === 'mobile' ? 'mobile' : 'desktop',
      screenEmulation: strategy === 'mobile' ? {
        mobile: true,
        width: 375,
        height: 667,
        deviceScaleFactor: 2,
        disabled: false,
      } : {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
        disabled: false,
      },
      throttling: strategy === 'mobile' ? {
        rttMs: 150,
        throughputKbps: 1638.4,
        cpuSlowdownMultiplier: 4,
      } : {
        rttMs: 40,
        throughputKbps: 10240,
        cpuSlowdownMultiplier: 1,
      },
    };

    // Run Lighthouse
    const runnerResult = await lighthouse(url, options);

    if (!runnerResult || !runnerResult.lhr) {
      throw new Error(`Lighthouse failed for ${strategy}`);
    }

    return runnerResult.lhr;

  } catch (error) {
    throw new Error(`Lighthouse error (${strategy}): ${error.message}`);
  } finally {
    if (chrome) {
      await chrome.kill();
    }
  }
}

function parseScores(data) {
  const categories = data.categories || {};
  return {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    seo: Math.round((categories.seo?.score || 0) * 100),
  };
}

function parseMetrics(data) {
  const audits = data.audits || {};

  const metric = (id) => {
    const audit = audits[id];
    return {
      value: audit?.numericValue || 0,
      displayValue: audit?.displayValue || 'N/A',
      score: audit?.score ?? null,
    };
  };

  return {
    fcp: metric('first-contentful-paint'),
    lcp: metric('largest-contentful-paint'),
    tbt: metric('total-blocking-time'),
    cls: metric('cumulative-layout-shift'),
    si: metric('speed-index'),
  };
}

function parseFailingAudits(data) {
  const audits = data.audits || {};
  const failing = [];

  for (const [id, audit] of Object.entries(audits)) {
    if (audit.score !== null && audit.score < 1 && audit.scoreDisplayMode !== 'informative' && audit.scoreDisplayMode !== 'notApplicable') {
      failing.push({
        id,
        title: audit.title || id,
        description: audit.description || '',
        displayValue: audit.displayValue || '',
        score: audit.score,
        impact: audit.score === 0 ? 'high' : audit.score < 0.5 ? 'medium' : 'low',
      });
    }
  }

  // Sort by score ascending (worst first)
  failing.sort((a, b) => a.score - b.score);
  return failing.slice(0, 25); // Top 25 failing audits
}

async function getPageSpeedData(url) {
  // Run sequentially to avoid Lighthouse conflicts
  const desktopRaw = await runLighthouse(url, 'desktop');
  const mobileRaw = await runLighthouse(url, 'mobile');

  return {
    desktop: {
      scores: parseScores(desktopRaw),
      metrics: parseMetrics(desktopRaw),
      failingAudits: parseFailingAudits(desktopRaw),
    },
    mobile: {
      scores: parseScores(mobileRaw),
      metrics: parseMetrics(mobileRaw),
      failingAudits: parseFailingAudits(mobileRaw),
    },
  };
}

export { getPageSpeedData };
