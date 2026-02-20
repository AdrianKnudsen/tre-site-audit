/**
 * Claude API integration for AI-powered website evaluation
 * Sends page HTML + audit criteria to Claude and gets structured results
 */

import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import http from 'http';
import crypto from 'crypto';

// In-memory cache: same URL + same HTML content → identical Claude result
const auditCache = new Map();

const AUDIT_CRITERIA = `
## UX (User Experience)

### Navigation & Information Architecture
1. Clear primary navigation with logical grouping
2. Current page/section is visually indicated
3. Breadcrumbs present where appropriate
4. Search functionality is accessible and functional
5. Footer contains expected utility links

### Content & Readability
6. Headlines are descriptive and scannable
7. Body text is appropriately sized (minimum 16px)
8. Line length is comfortable (45-75 characters)
9. Language and terminology match users' real-world vocabulary (no unexplained jargon or internal labels) [Nielsen #2]
10. Content is structured with clear hierarchy (H1 → H2 → H3)

### Interaction Design
11. Primary call-to-action is immediately identifiable
12. Interactive elements look and behave as expected (clear affordances)
13. Visibility of system status: loading indicators, progress, success, and error states are communicated clearly [Nielsen #1]
14. Error messages are specific and guide users toward recovery [Nielsen #9]
15. Error prevention: risky or irreversible actions require confirmation; forms use inline validation to catch mistakes early [Nielsen #5]

### Cognitive Load & User Control
16. Page offers minimal but sufficient choices; no unnecessary complexity or clutter (Hick's Law) [Nielsen #8]
17. UI surfaces available options; users recognize rather than recall information (recognition over recall) [Nielsen #6]
18. Related items are visually grouped; progressive disclosure is used for complex or secondary content
19. Platform conventions are respected and escape routes are available (back, cancel, undo) — no dead ends [Nielsen #3 + #4]
20. Users can accomplish the primary task without confusion or external help

## UI (User Interface)

### Visual Hierarchy
21. Clear distinction between heading levels
22. Primary action stands out from secondary actions
23. Visual weight guides the eye through content
24. Adequate whitespace between sections
25. Reading flow follows natural scan patterns (F-pattern or Z-pattern)

### Typography
26. Consistent font families (max 2-3)
27. Clear type scale with distinct heading sizes
28. Appropriate line height (1.4-1.6 for body text)
29. Font weights used purposefully for emphasis
30. Text alignment is consistent

### Color & Contrast
31. Consistent color palette throughout
32. Color is not the sole means of conveying information
33. Sufficient contrast ratios (4.5:1 for normal text, 3:1 for large text)
34. Brand colors applied consistently
35. Hover/active states have distinct colors

### Spacing & Layout
36. Consistent spacing system (8px grid or similar)
37. Proper alignment across elements
38. Responsive layout adapts to viewport
39. Adequate padding within containers
40. Margins are consistent between similar elements

### Components
41. Buttons have consistent styling across the page
42. Form fields have consistent styling
43. Icons are consistent in style, size, and weight
44. Cards/containers follow a consistent pattern
45. Borders and border-radius are consistent

## Accessibility (WCAG 2.1)

### Perceivable
46. All images have meaningful alt text (or alt="" for decorative)
47. Video/audio has captions or transcripts
48. Color contrast meets WCAG AA (4.5:1 normal, 3:1 large)
49. Text can be resized to 200% without loss of content
50. Content is readable without CSS

### Operable
51. All functionality available via keyboard
52. Visible focus indicator on interactive elements
53. No keyboard traps
54. Skip-to-content link present
55. Touch targets minimum 44x44px on mobile
56. No content flashes more than 3 times per second

### Understandable
57. Page language is declared (lang attribute)
58. Form labels are associated with inputs
59. Error messages identify the field and describe the error
60. Consistent navigation across pages
61. Abbreviations and jargon are explained

### Robust
62. Valid HTML structure
63. Proper heading hierarchy (no skipped levels)
64. ARIA roles used correctly (not overused)
65. Semantic HTML elements used (nav, main, article, etc.)
66. Forms have proper fieldset/legend grouping

## Best Practices

### Performance Indicators
67. Images are optimized (WebP/AVIF, proper sizing, lazy loading)
68. CSS and JS are minified
69. No render-blocking resources in critical path
70. Efficient caching headers
71. Fonts are preloaded or use font-display swap

### Security
72. HTTPS is enforced
73. No mixed content warnings
74. Proper CSP headers
75. External links use rel="noopener noreferrer"
76. No exposed sensitive data in source

### SEO Fundamentals
77. Unique, descriptive <title> tag
78. Meta description present and relevant
79. Proper use of heading hierarchy for content
80. Canonical URL specified
81. Open Graph / social meta tags present
82. Structured data (JSON-LD) where appropriate

### Code Quality
83. No console errors (check for inline error patterns)
84. No broken links or missing resources (404s)
85. Responsive meta viewport tag present
86. Favicon present
87. Print stylesheet considered
`;

const SYSTEM_PROMPT = `You are a senior web auditor for TRE Bergen, a Norwegian digital agency. You evaluate websites against a comprehensive checklist covering UX, UI, Accessibility (WCAG 2.1), and Best Practices.

You will receive the HTML source code of a webpage. Analyze it thoroughly and evaluate against each criterion in the audit checklist.

IMPORTANT: You can only evaluate what is observable from the HTML source code. For visual-only aspects (like actual rendered spacing, color harmony, visual weight), make your best assessment based on CSS classes, inline styles, and structural patterns in the HTML. If something cannot be determined from HTML alone, mark it as "na" with a note explaining why.

Return your evaluation as a JSON object with EXACTLY this structure. Do not include any text outside the JSON.

{
  "ux": {
    "navigation": [
      { "check": "Clear primary navigation with logical grouping", "check_no": "Tydelig primærnavigasjon med logisk gruppering", "status": "pass|warn|fail|na", "note_no": "Brief note in Norwegian", "note_en": "Brief note in English", "details_no": "Detailed explanation in Norwegian", "details_en": "Detailed explanation in English", "recommendation_no": "How to fix in Norwegian (empty string if pass)", "recommendation_en": "How to fix in English (empty string if pass)" }
    ],
    "content": [ ... ],
    "interaction": [ ... ],
    "cognitiveLoad": [ ... ]
  },
  "ui": {
    "hierarchy": [ ... ],
    "typography": [ ... ],
    "color": [ ... ],
    "spacing": [ ... ],
    "components": [ ... ]
  },
  "accessibility": {
    "perceivable": [ ... ],
    "operable": [ ... ],
    "understandable": [ ... ],
    "robust": [ ... ]
  },
  "bestPractices": {
    "performance": [ ... ],
    "security": [ ... ],
    "seo": [ ... ],
    "codeQuality": [ ... ]
  },
  "priorityFixes": [
    { "title_no": "...", "title_en": "...", "description_no": "...", "description_en": "...", "severity": "high|medium|low", "domain": "UX|UI|Accessibility|Best Practices" }
  ],
  "customerSummary": {
    "no": "3-4 avsnitt på norsk for kunden. Skriv som en erfaren rådgiver som forklarer til en ikke-teknisk person. ALDRI bruk: tallscorer, prosenter, fargekoder, hex-verdier, tekniske forkortelser (LCP, CLS, TTFB osv.), eller kodesnutter. Fokuser på hva brukerne faktisk opplever og hva som bør prioriteres — i vanlig, vennlig forretningsspråk. Skill avsnittene med \\n\\n.",
    "en": "3-4 paragraphs in English for the client. Write as an experienced advisor explaining to a non-technical person. NEVER use: numeric scores, percentages, color codes, hex values, technical abbreviations (LCP, CLS, TTFB etc.), or code snippets. Focus on what users actually experience and what should be prioritized — in plain, friendly business language. Separate paragraphs with \\n\\n."
  },
  "executiveSummary": {
    "no": "1-2 setninger på norsk. Overordnet inntrykk av siden — uten tallscorer eller tekniske termer.",
    "en": "1-2 sentences in English. Overall impression of the site — without numeric scores or technical terms."
  }
}

Rules:
- Every check from the criteria list MUST appear in the output
- Use "na" status when something genuinely cannot be determined from HTML source
- Priority fixes should list the 5-10 most impactful issues, sorted by severity
- Customer summary MUST be written in plain language — no scores, no hex codes, no technical jargon
- Write both Norwegian (bokmål) and English for all text fields
- The "check_no" field MUST be the Norwegian translation of the check criterion name
- BE CONCISE: Keep notes under 100 characters, details under 300 characters`;

async function runClaudeAudit(html, url, apiKey, preAuditData = null) {
  // Cache key: URL + hash of the HTML slice Claude will see (deterministic input = deterministic output)
  const htmlSlice = html.substring(0, preAuditData ? 15000 : 20000);
  const cacheKey = url + ':' + crypto.createHash('md5').update(htmlSlice).digest('hex');
  if (auditCache.has(cacheKey)) {
    console.log('[Claude] Cache hit for:', url);
    return auditCache.get(cacheKey);
  }

  console.log('[Claude] Starting audit for:', url);
  console.log('[Claude] Pre-audit data available:', !!preAuditData);

  // Configure HTTP agent with longer socket timeout
  const httpsAgent = new https.Agent({
    keepAlive: true,
    timeout: 300000, // 5 minutes socket timeout
    keepAliveMsecs: 30000,
  });

  const httpAgent = new http.Agent({
    keepAlive: true,
    timeout: 300000,
    keepAliveMsecs: 30000,
  });

  const client = new Anthropic({
    apiKey,
    timeout: 300000, // 5 minutes request timeout (increased for complex audits)
    maxRetries: 1, // Reduced retries to save time
    httpAgent: (url) => url.protocol === 'https:' ? httpsAgent : httpAgent,
  });

  // If we have pre-audit data, build a focused list of checks that need AI review
  let focusedCriteria = AUDIT_CRITERIA;
  let preAuditSummary = '';

  if (preAuditData && preAuditData.findings) {
    // Count automated vs AI-needed checks
    const needsAI = [];
    const automated = [];

    for (const [category, findings] of Object.entries(preAuditData.findings)) {
      for (const finding of findings) {
        if (finding.status === 'NEEDS_AI_REVIEW') {
          needsAI.push(`${category}: ${finding.check_en || finding.check}`);
        } else if (finding.automated) {
          automated.push(`${category}: ${finding.check_en || finding.check} [${finding.status}]`);
        }
      }
    }

    preAuditSummary = `
PRE-AUDIT RESULTS:
- ${automated.length} checks completed automatically
- ${needsAI.length} checks need your visual evaluation

AUTOMATED CHECKS (already done):
${automated.slice(0, 20).join('\n')}

FOCUS YOUR EVALUATION ON THESE ${needsAI.length} CHECKS:
${needsAI.join('\n')}
`;
  }

  // Dramatically simplified prompt when we have pre-audit data
  const userMessage = preAuditData
    ? `URL: ${url}

${preAuditSummary}

HTML (first 15K chars):
\`\`\`html
${html.substring(0, 15000)}
\`\`\`

Evaluate ONLY the checks listed above. Return JSON with the standard audit structure.
IMPORTANT: Be very concise - notes <100 chars, details <300 chars each.`
    : `Evaluate ${url} against all audit criteria.

HTML:
\`\`\`html
${html.substring(0, 20000)}
\`\`\`

${focusedCriteria}

Return JSON with complete audit results.`;

  console.log('[Claude] Sending request to API...');
  console.log('[Claude] Input tokens (estimated):', Math.ceil(userMessage.length / 4));

  let response;
  try {
    const startTime = Date.now();
    response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 32000, // Increased for complete audit JSON
      temperature: 0, // Deterministic output for consistent audit scores
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const elapsed = Date.now() - startTime;

    console.log('[Claude] Response received in', elapsed, 'ms');
    console.log('[Claude] Usage:', response.usage);
  } catch (error) {
    console.error('[Claude] API error:', error.message);
    if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
      throw new Error('Claude API connection timed out. This may be due to:\n' +
        '1. Network connectivity issues\n' +
        '2. Complex page requiring longer processing\n' +
        '3. Claude API temporarily overloaded\n' +
        'Try again with a simpler page or check your internet connection.');
    }
    throw error;
  }

  const text = response.content[0]?.text || '';

  // Extract JSON from response (handle possible markdown fences)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Try to find JSON object boundaries
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }

  try {
    const claudeResult = JSON.parse(jsonStr);

    // If we have pre-audit data, merge it with Claude's results
    const result = preAuditData && preAuditData.findings
      ? mergeAuditResults(preAuditData, claudeResult)
      : claudeResult;

    auditCache.set(cacheKey, result);
    return result;
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${e.message}\nRaw response: ${text.substring(0, 500)}`);
  }
}

// Merge pre-audit automated results with Claude's visual evaluations
function mergeAuditResults(preAuditData, claudeResult) {
  const merged = { ...claudeResult };

  // Map pre-audit categories to Claude's structure
  const categoryMap = {
    'a11y_perceivable': 'accessibility.perceivable',
    'a11y_operable': 'accessibility.operable',
    'a11y_understandable': 'accessibility.understandable',
    'a11y_robust': 'accessibility.robust',
    'bp_performance': 'bestPractices.performance',
    'bp_security': 'bestPractices.security',
    'bp_seo': 'bestPractices.seo',
    'bp_code': 'bestPractices.codeQuality',
    'ux_nav': 'ux.navigation',
    'ux_content': 'ux.content',
    'ux_interaction': 'ux.interaction',
    'ux_cognitive': 'ux.cognitiveLoad',
    'ui_hierarchy': 'ui.hierarchy',
    'ui_typography': 'ui.typography',
    'ui_color': 'ui.color',
    'ui_spacing': 'ui.spacing',
    'ui_components': 'ui.components',
  };

  // For each pre-audit category
  for (const [preCategory, findings] of Object.entries(preAuditData.findings)) {
    const claudePath = categoryMap[preCategory];
    if (!claudePath) continue;

    const [domain, subdomain] = claudePath.split('.');

    // Ensure the structure exists
    if (!merged[domain]) merged[domain] = {};
    if (!merged[domain][subdomain]) merged[domain][subdomain] = [];

    // Merge findings
    for (const preFind of findings) {
      // Skip NEEDS_AI_REVIEW items (Claude should have evaluated these)
      if (preFind.status === 'NEEDS_AI_REVIEW') continue;

      // Convert pre-audit format to Claude format
      const mergedFinding = {
        check: preFind.check,
        check_en: preFind.check_en,
        status: preFind.status.toLowerCase(), // pass/warn/fail/na
        note_no: preFind.note || '',
        note_en: preFind.note_en || '',
        details_no: preFind.detail || '',
        details_en: preFind.detail_en || '',
        recommendation_no: preFind.recommendation || '',
        recommendation_en: preFind.recommendation_en || '',
      };

      // Check if Claude already has this check (by matching check text)
      const existingIdx = merged[domain][subdomain].findIndex(
        f => f.check === preFind.check || f.check_en === preFind.check_en
      );

      if (existingIdx >= 0) {
        // Claude's evaluation takes precedence, but use pre-audit if Claude didn't evaluate
        if (!merged[domain][subdomain][existingIdx].status ||
            merged[domain][subdomain][existingIdx].status === 'na') {
          merged[domain][subdomain][existingIdx] = mergedFinding;
        }
      } else {
        // Add pre-audit finding if Claude didn't evaluate it
        merged[domain][subdomain].push(mergedFinding);
      }
    }
  }

  return merged;
}

export { runClaudeAudit };
