/**
 * Fetches target page HTML for AI evaluation
 */

const MAX_HTML_LENGTH = 50000; // Keep under Claude context limits

async function fetchPageHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TRE-Site-Audit/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Truncate if needed to keep Claude prompt manageable
    if (html.length > MAX_HTML_LENGTH) {
      return html.substring(0, MAX_HTML_LENGTH) + '\n<!-- [truncated at 50k characters] -->';
    }

    return html;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchPageHtml };
