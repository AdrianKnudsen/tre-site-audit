/**
 * Fetches target page HTML for analysis.
 * Returns the COMPLETE HTML — no truncation.
 * Python pre-audit handles the full document; Claude receives a small slice separately.
 */

async function fetchPageHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s for large pages

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en-US;q=0.7,en;q=0.6',
        'Accept-Encoding': 'identity', // No compression — we want full text
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log(`[Fetch] Got ${(html.length / 1024).toFixed(0)}KB HTML from ${url}`);
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

export { fetchPageHtml };
