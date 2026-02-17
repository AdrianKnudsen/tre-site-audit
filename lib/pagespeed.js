/**
 * PageSpeed Insights API wrapper
 * Fetches Lighthouse data for both desktop and mobile strategies
 */

const PAGESPEED_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

async function fetchPageSpeed(url, strategy = 'desktop', apiKey) {
  const params = new URLSearchParams({ url, strategy });
  CATEGORIES.forEach(cat => params.append('category', cat));
  if (apiKey) {
    params.append('key', apiKey);
  }

  const response = await fetch(`${PAGESPEED_API}?${params}`);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`PageSpeed API error (${strategy}): ${response.status} ${response.statusText} - ${errorBody}`);
  }
  return response.json();
}

function parseScores(data) {
  const categories = data.lighthouseResult?.categories || {};
  return {
    performance: Math.round((categories.performance?.score || 0) * 100),
    accessibility: Math.round((categories.accessibility?.score || 0) * 100),
    bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
    seo: Math.round((categories.seo?.score || 0) * 100),
  };
}

function parseMetrics(data) {
  const audits = data.lighthouseResult?.audits || {};

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
  const audits = data.lighthouseResult?.audits || {};
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

async function getPageSpeedData(url, apiKey) {
  const [desktopRaw, mobileRaw] = await Promise.all([
    fetchPageSpeed(url, 'desktop', apiKey),
    fetchPageSpeed(url, 'mobile', apiKey),
  ]);

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

module.exports = { getPageSpeedData };
