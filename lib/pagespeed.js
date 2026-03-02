/**
 * Google PageSpeed Insights API wrapper.
 *
 * Uses the public PSI REST API instead of local Lighthouse, so there's
 * no Chrome dependency — making the app deployable on Vercel / any
 * serverless platform.
 *
 * Requires env var: PAGESPEED_API_KEY
 *
 * Exports:
 *   getPageSpeedData(url) → { desktop, mobile }
 *     Each contains:
 *       scores       — { performance, accessibility, bestPractices, seo } (0–100)
 *       metrics      — { fcp, lcp, tbt, cls, si } with value + displayValue + score
 *       failingAudits — top 25 non-passing audits, sorted by score ascending
 */

const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

async function fetchPSI(url, strategy = 'desktop') {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey) {
    throw new Error('PAGESPEED_API_KEY environment variable is not set');
  }

  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy: strategy.toUpperCase(),
    category: ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'],
  });

  // PSI API accepts multiple category params
  const categoryParams = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO']
    .map(c => `category=${c}`)
    .join('&');

  const apiUrl = `${PSI_API}?url=${encodeURIComponent(url)}&key=${apiKey}&strategy=${strategy.toUpperCase()}&${categoryParams}`;

  console.log(`[PSI] Fetching ${strategy} data for ${url}...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`PSI API ${response.status}: ${errorBody.substring(0, 200)}`);
    }

    const data = await response.json();
    console.log(`[PSI] ${strategy} data received`);
    return data;

  } finally {
    clearTimeout(timeout);
  }
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
  return failing.slice(0, 25);
}

async function getPageSpeedData(url) {
  // Run desktop and mobile in parallel — no Chrome conflicts with API
  const [desktopRaw, mobileRaw] = await Promise.all([
    fetchPSI(url, 'desktop'),
    fetchPSI(url, 'mobile'),
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

export { getPageSpeedData };
