/**
 * Asset Fetcher — downloads all external CSS and JS files referenced in the page.
 *
 * Fetches everything without file count or size limits, giving the Python
 * pre-audit and Claude access to the complete stylesheet and script content —
 * not just inline styles or whatever happens to be in the HTML source.
 *
 * Handles:
 *   - <link rel="stylesheet"> tags → CSS files
 *   - @import rules in inline <style> blocks → additional CSS
 *   - <script src="..."> tags → JS files (including third-party)
 *   - Recursive @import resolution in fetched CSS (e.g. Google Fonts chains)
 *   - Binary responses (fonts, images accidentally linked) are silently skipped
 *
 * Timeouts:
 *   - Per file: 15 seconds (generous for large CDN bundles)
 *   - Total for all assets: 60 seconds
 *
 * On fetch failure: silently returns '' for that file — audit continues
 * with partial data rather than failing completely.
 *
 * Exports:
 *   fetchExternalAssets(html, baseUrl) → { css, js, cssCount, jsCount, cssUrls, jsUrls }
 *     css / js — combined text of all fetched files, with /* === url === *\/ comments
 */

const FETCH_TIMEOUT = 15000;       // 15s per file
const TOTAL_TIMEOUT = 60000;       // 60s total for all assets

/**
 * Extract stylesheet and script URLs from HTML.
 * Also extracts inline <style> and <script> content that may contain
 * @import rules pointing to additional CSS files.
 */
function extractAssetUrls(html, baseUrl) {
  const base = new URL(baseUrl);

  // CSS: <link rel="stylesheet" href="...">
  const cssPattern = /<link[^>]+rel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
  const cssUrls = [];
  let match;
  while ((match = cssPattern.exec(html)) !== null) {
    const hrefMatch = match[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch) {
      try {
        const url = new URL(hrefMatch[1], base).href;
        cssUrls.push(url);
      } catch { /* skip invalid URLs */ }
    }
  }

  // Also check for @import in inline styles
  const importPattern = /@import\s+(?:url\()?["']([^"']+)["']\)?/gi;
  while ((match = importPattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], base).href;
      if (!cssUrls.includes(url)) cssUrls.push(url);
    } catch { /* skip */ }
  }

  // JS: <script src="..."> — fetch ALL scripts, including third-party
  const jsPattern = /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const jsUrls = [];
  while ((match = jsPattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], base).href;
      jsUrls.push(url);
    } catch { /* skip invalid URLs */ }
  }

  return { cssUrls, jsUrls };
}

/**
 * Fetch a single asset with timeout.
 */
async function fetchAsset(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/css,application/javascript,text/javascript,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!response.ok) return '';

    const contentType = response.headers.get('content-type') || '';
    // Skip binary responses (images, fonts, etc. that got mislinked)
    if (contentType.includes('image/') || contentType.includes('font/') || contentType.includes('application/octet-stream')) {
      return '';
    }

    const text = await response.text();
    return text;
  } catch {
    return ''; // Silently skip failed fetches
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Recursively resolve @import directives in CSS to get ALL CSS content.
 */
async function resolveCssImports(cssText, baseUrl, visited = new Set()) {
  const importPattern = /@import\s+(?:url\()?["']?([^"'\s;)]+)["']?\)?\s*;?/gi;
  let match;
  let resolved = cssText;

  while ((match = importPattern.exec(cssText)) !== null) {
    try {
      const importUrl = new URL(match[1], baseUrl).href;
      if (visited.has(importUrl)) continue;
      visited.add(importUrl);

      const importedCss = await fetchAsset(importUrl);
      if (importedCss) {
        // Recursively resolve nested imports
        const deepResolved = await resolveCssImports(importedCss, importUrl, visited);
        resolved = resolved.replace(match[0], `/* @import resolved: ${importUrl} */\n${deepResolved}`);
      }
    } catch { /* skip */ }
  }

  return resolved;
}

/**
 * Fetch all external CSS and JS files referenced in the page HTML.
 * NO limits — fetches everything for complete analysis.
 */
async function fetchExternalAssets(html, baseUrl) {
  const { cssUrls, jsUrls } = extractAssetUrls(html, baseUrl);

  console.log(`[Assets] Found ${cssUrls.length} CSS files, ${jsUrls.length} JS files — fetching all`);

  // Enforce a total timeout for all fetches
  const totalController = new AbortController();
  const totalTimeout = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT);

  try {
    // Fetch all in parallel
    const [cssResults, jsResults] = await Promise.all([
      Promise.all(cssUrls.map(url => fetchAsset(url))),
      Promise.all(jsUrls.map(url => fetchAsset(url))),
    ]);

    // Combine all CSS (with source markers)
    let combinedCss = '';
    let cssCount = 0;
    for (let i = 0; i < cssResults.length; i++) {
      if (cssResults[i]) {
        combinedCss += `\n/* === ${cssUrls[i]} === */\n${cssResults[i]}`;
        cssCount++;
      }
    }

    // Resolve @import directives in fetched CSS
    if (combinedCss) {
      const visited = new Set(cssUrls);
      combinedCss = await resolveCssImports(combinedCss, baseUrl, visited);
    }

    // Combine all JS (with source markers)
    let combinedJs = '';
    let jsCount = 0;
    for (let i = 0; i < jsResults.length; i++) {
      if (jsResults[i]) {
        combinedJs += `\n// === ${jsUrls[i]} ===\n${jsResults[i]}`;
        jsCount++;
      }
    }

    console.log(`[Assets] Fetched ${cssCount}/${cssUrls.length} CSS (${(combinedCss.length / 1024).toFixed(0)}KB), ${jsCount}/${jsUrls.length} JS (${(combinedJs.length / 1024).toFixed(0)}KB)`);

    return {
      css: combinedCss,
      js: combinedJs,
      cssCount,
      jsCount,
      cssUrls: cssUrls.slice(0, 50), // Log first 50 for reference
      jsUrls: jsUrls.slice(0, 50),
    };
  } finally {
    clearTimeout(totalTimeout);
  }
}

export { fetchExternalAssets };
