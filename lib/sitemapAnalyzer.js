/**
 * Sitemap Analyzer — fetches and parses sitemap.xml to assess site depth.
 *
 * Used to evaluate the "3-click rule": can users reach important content
 * within 3 clicks from the landing page? Deep URL paths (depth > 3)
 * are flagged as potential violations.
 *
 * Handles both standard sitemaps and sitemap indexes:
 *   - Standard sitemap: all <loc> URLs are analysed
 *   - Sitemap index: the first child sitemap is fetched and analysed
 *     (full crawl of all child sitemaps is skipped for performance)
 *
 * Results are attached to preAuditData.sitemapAnalysis and passed to
 * Claude as context for the navigation/information architecture checks.
 *
 * Fetch timeout: 10 seconds per request.
 *
 * Exports:
 *   analyzeSitemap(baseUrl) → {
 *     hasSitemap, totalUrls, maxDepth,
 *     depthDistribution, deepPages, sampleUrls, error
 *   }
 */

/**
 * Fetch and analyze sitemap.xml from a given base URL.
 * @param {string} baseUrl - The website URL (e.g. "https://example.com")
 * @returns {object} Sitemap analysis results
 */
async function analyzeSitemap(baseUrl) {
  const result = {
    hasSitemap: false,
    totalUrls: 0,
    maxDepth: 0,
    depthDistribution: {},  // { 0: count, 1: count, 2: count, ... }
    deepPages: [],          // pages deeper than 3 levels
    sampleUrls: {},         // sample URLs per depth level
    error: null,
  };

  try {
    // Normalize base URL
    const url = new URL(baseUrl);
    const sitemapUrl = `${url.origin}/sitemap.xml`;

    // Fetch sitemap with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(sitemapUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TRE-Site-Audit/1.1)',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      result.error = `Sitemap returned ${response.status}`;
      return result;
    }

    const xml = await response.text();

    // Check if it's a sitemap index (references other sitemaps)
    const isSitemapIndex = xml.includes('<sitemapindex');

    let urls = [];

    if (isSitemapIndex) {
      // Extract child sitemap URLs (don't crawl them — just note it)
      const sitemapRefs = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1]);
      result.error = `Sitemap index with ${sitemapRefs.length} child sitemaps (analyzed main index only)`;

      // Try to fetch the first child sitemap for analysis
      if (sitemapRefs.length > 0) {
        try {
          const childController = new AbortController();
          const childTimeout = setTimeout(() => childController.abort(), 10000);
          const childResp = await fetch(sitemapRefs[0], {
            signal: childController.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TRE-Site-Audit/1.1)' },
          });
          clearTimeout(childTimeout);
          if (childResp.ok) {
            const childXml = await childResp.text();
            urls = [...childXml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1]);
          }
        } catch { /* ignore child fetch errors */ }
      }
    } else {
      // Standard sitemap — extract all URLs
      urls = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)].map(m => m[1]);
    }

    if (urls.length === 0) {
      result.error = result.error || 'No URLs found in sitemap';
      return result;
    }

    result.hasSitemap = true;
    result.totalUrls = urls.length;

    // Analyze depth of each URL relative to base
    const basePath = url.pathname.replace(/\/$/, '');

    for (const rawUrl of urls) {
      try {
        const parsed = new URL(rawUrl);
        // Only analyze same-origin URLs
        if (parsed.origin !== url.origin) continue;

        const path = parsed.pathname.replace(/\/$/, '');
        const relativePath = path.startsWith(basePath)
          ? path.substring(basePath.length)
          : path;

        // Count path segments as depth
        const segments = relativePath.split('/').filter(Boolean);
        const depth = segments.length;

        // Track distribution
        result.depthDistribution[depth] = (result.depthDistribution[depth] || 0) + 1;

        if (depth > result.maxDepth) result.maxDepth = depth;

        // Track deep pages (> 3 levels = potentially violates 3-click rule)
        if (depth > 3) {
          result.deepPages.push(parsed.pathname);
        }

        // Store sample URLs per depth (max 3 per level)
        if (!result.sampleUrls[depth]) result.sampleUrls[depth] = [];
        if (result.sampleUrls[depth].length < 3) {
          result.sampleUrls[depth].push(parsed.pathname);
        }
      } catch { /* skip invalid URLs */ }
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      result.error = 'Sitemap fetch timed out (10s)';
    } else {
      result.error = `Sitemap fetch failed: ${err.message}`;
    }
  }

  return result;
}

export { analyzeSitemap };
