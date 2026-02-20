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
2. Current page/section is visually indicated [Nielsen #1]
3. Breadcrumbs present where appropriate
4. Search functionality is accessible and functional
5. Footer contains expected utility links
6. Important content reachable within 3 clicks from landing page (3-click rule)
7. Information architecture follows users' mental model — labels and grouping match user expectations [Nielsen #2]

### Content & Readability
8. Headlines are descriptive and scannable
9. Body text is appropriately sized (minimum 16px)
10. Line length is comfortable (45-75 characters)
11. Language and terminology match users' real-world vocabulary (no unexplained jargon or internal labels) [Nielsen #2]
12. Content is structured with clear hierarchy (H1 → H2 → H3)
13. Images and media are relevant, high-quality, and support the content
14. Content aligns with user goals and business objectives — clear value proposition

### Interaction Design
15. Primary call-to-action is immediately identifiable
16. Interactive elements look and behave as expected (clear affordances)
17. Visibility of system status: loading indicators, progress, success, and error states are communicated clearly [Nielsen #1]
18. Error messages are specific and guide users toward recovery [Nielsen #9]
19. Error prevention: risky or irreversible actions require confirmation; forms use inline validation to catch mistakes early [Nielsen #5]
20. Shortcuts and accelerators available for experienced users (keyboard shortcuts, quick actions, auto-complete) [Nielsen #7]
21. Form design: inline validation, clearly marked required fields, appropriate input types, and helpful placeholder text
22. Mobile interaction design: touch targets in thumb zone, swipe-friendly, no hover-dependent functionality

### Cognitive Load & User Control
23. Page offers minimal but sufficient choices; no unnecessary complexity or clutter (Hick's Law) [Nielsen #8]
24. UI surfaces available options; users recognize rather than recall information (recognition over recall) [Nielsen #6]
25. Related items are visually grouped; progressive disclosure is used for complex or secondary content
26. Platform conventions are respected and escape routes are available (back, cancel, undo) — no dead ends [Nielsen #3 + #4]
27. Users can accomplish the primary task without confusion or external help
28. Help and documentation is accessible when needed — FAQ, tooltips, contextual help [Nielsen #10]
29. Trust signals present: security badges, certifications, testimonials, social proof where appropriate
30. Onboarding or first-time user guidance for complex features or flows

## UI (User Interface)

### Visual Hierarchy
31. Clear distinction between heading levels
32. Primary action stands out from secondary actions
33. Visual weight guides the eye through content
34. Adequate whitespace between sections
35. Reading flow follows natural scan patterns (F-pattern or Z-pattern)
36. Content density is balanced — sufficient breathing room without excessive empty space

### Typography
37. Consistent font families (max 2-3)
38. Clear type scale with distinct heading sizes
39. Appropriate line height (1.4-1.6 for body text)
40. Font weights used purposefully for emphasis
41. Text alignment is consistent

### Color & Contrast
42. Consistent color palette throughout
43. Color is not the sole means of conveying information
44. Sufficient contrast ratios (4.5:1 for normal text, 3:1 for large text)
45. Brand colors applied consistently
46. Hover/active states have distinct colors

### Spacing & Layout
47. Consistent spacing system (8px grid or similar)
48. Proper alignment across elements
49. Responsive layout adapts to viewport
50. Adequate padding within containers
51. Margins are consistent between similar elements

### Components
52. Buttons have consistent styling across the page
53. Form fields have consistent styling
54. Icons are consistent in style, size, and weight
55. Cards/containers follow a consistent pattern
56. Borders and border-radius are consistent
57. 404 and error pages are designed, branded, and guide users back to valid content

## Accessibility (WCAG 2.1)

### Perceivable
58. All images have meaningful alt text (or alt="" for decorative)
59. Video/audio has captions or transcripts
60. Color contrast meets WCAG AA (4.5:1 normal, 3:1 large)
61. Text can be resized to 200% without loss of content
62. Content is readable without CSS

### Operable
63. All functionality available via keyboard
64. Visible focus indicator on interactive elements
65. No keyboard traps
66. Skip-to-content link present
67. Touch targets minimum 44x44px on mobile
68. No content flashes more than 3 times per second
69. Reduced motion support: respects prefers-reduced-motion for animations and transitions

### Understandable
70. Page language is declared (lang attribute)
71. Form labels are associated with inputs
72. Error messages identify the field and describe the error
73. Consistent navigation across pages
74. Abbreviations and jargon are explained

### Robust
75. Valid HTML structure
76. Proper heading hierarchy (no skipped levels)
77. ARIA roles used correctly (not overused)
78. Semantic HTML elements used (nav, main, article, etc.)
79. Forms have proper fieldset/legend grouping
80. Cross-browser and cross-device compatibility — no major rendering differences

## Best Practices

### Performance Indicators
81. Images are optimized (WebP/AVIF, proper sizing, lazy loading)
82. CSS and JS are minified
83. No render-blocking resources in critical path
84. Efficient caching headers
85. Fonts are preloaded or use font-display swap

### Security
86. HTTPS is enforced
87. No mixed content warnings
88. Proper CSP headers
89. External links use rel="noopener noreferrer"
90. No exposed sensitive data in source

### SEO Fundamentals
91. Unique, descriptive <title> tag
92. Meta description present and relevant
93. Proper use of heading hierarchy for content
94. Canonical URL specified
95. Open Graph / social meta tags present
96. Structured data (JSON-LD) where appropriate

### Code Quality
97. No console errors (check for inline error patterns)
98. No broken links or missing resources (404s)
99. Responsive meta viewport tag present
100. Favicon present
101. Print stylesheet considered
`;

const SYSTEM_PROMPT = `You are a senior web auditor for TRE Bergen, a Norwegian digital agency. You evaluate websites against a comprehensive checklist covering UX, UI, Accessibility (WCAG 2.1), and Best Practices.

You will receive the HTML source code of a webpage. Analyze it thoroughly and evaluate against each criterion in the 101-point audit checklist. The checklist references Nielsen's 10 Usability Heuristics where applicable.

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
  const cacheKey = url + ':' + crypto.createHash('md5').update(html).digest('hex');
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
          // Include any pre-gathered data as context for AI
          const hint = (finding.note_en || finding.note) ? ` (hint: ${finding.note_en || finding.note})` : '';
          needsAI.push(`${category}: ${finding.check_en || finding.check}${hint}`);
        } else if (finding.automated) {
          automated.push(`${category}: ${finding.check_en || finding.check} [${finding.status}]`);
        }
      }
    }

    // Include sitemap analysis if available
    let sitemapInfo = '';
    if (preAuditData.sitemapAnalysis?.hasSitemap) {
      const sm = preAuditData.sitemapAnalysis;
      sitemapInfo = `
SITEMAP ANALYSIS:
- Total URLs: ${sm.totalUrls}, Max depth: ${sm.maxDepth}
- Depth distribution: ${Object.entries(sm.depthDistribution).map(([d, c]) => `depth ${d}: ${c}`).join(', ')}
- Pages deeper than 3 levels: ${sm.deepPages.length}${sm.deepPages.length > 0 ? ' (potential 3-click rule violations)' : ''}
`;
    }

    // Include framework + CSS/JS stats as context for visual checks
    let assetContext = '';
    if (preAuditData.detected_frameworks?.length) {
      assetContext += `\nDETECTED FRAMEWORKS: ${preAuditData.detected_frameworks.join(', ')}`;
    }
    if (preAuditData.analysis_scope) {
      const s = preAuditData.analysis_scope;
      assetContext += `\nANALYSIS SCOPE: ${s.total_analyzed_kb}KB total (HTML: ${s.html_size_kb}KB, CSS: ${s.inline_css_size_kb + s.external_css_size_kb}KB, JS: ${s.inline_js_size_kb + s.external_js_size_kb}KB)`;
    }
    if (preAuditData.css_stats?.external_files_analyzed) {
      const cs = preAuditData.css_stats;
      assetContext += `\nCSS ANALYSIS (from ${cs.total_colors} colors, ${cs.font_families?.length || 0} fonts):`;
      assetContext += `\n- Breakpoints: ${cs.breakpoints?.join(', ') || 'none'}`;
      assetContext += `\n- Layout: ${cs.has_flexbox ? 'flexbox' : ''}${cs.has_grid ? ' grid' : ''}`;
      assetContext += `\n- States: ${cs.has_hover_states ? 'hover' : ''} ${cs.has_focus_styles ? 'focus' : ''}`;
    }
    if (preAuditData.js_stats?.external_files_analyzed) {
      const js = preAuditData.js_stats;
      const features = [];
      if (js.has_keyboard_listeners) features.push('keyboard');
      if (js.has_touch_listeners) features.push('touch');
      if (js.has_loading_states) features.push('loading-states');
      if (js.has_form_validation) features.push('validation');
      if (js.has_error_handling) features.push('error-handling');
      if (js.has_focus_management) features.push('focus-mgmt');
      if (js.has_aria_manipulation) features.push('ARIA-JS');
      if (features.length) assetContext += `\nJS PATTERNS: ${features.join(', ')}`;
    }

    preAuditSummary = `
PRE-AUDIT RESULTS (v2.0 — HTML + CSS + JS analyzed):
- ${automated.length} checks completed automatically
- ${needsAI.length} checks need your visual evaluation
${sitemapInfo}${assetContext}

AUTOMATED (done — do NOT re-evaluate):
${automated.slice(0, 25).join('\n')}
${automated.length > 25 ? `... and ${automated.length - 25} more automated checks` : ''}

FOCUS ON THESE ${needsAI.length} CHECKS ONLY:
${needsAI.join('\n')}
`;
  }

  // Send full HTML + intelligently compressed CSS/JS to Claude
  const htmlSizeKB = Math.round(html.length / 1024);
  const rawCSS = preAuditData?._rawCSS || '';
  const rawJS = preAuditData?._rawJS || '';

  // Token budget: minified code tokenizes at ~2.5 chars/token (not 4)
  // Claude max = 200K tokens. Reserve: system prompt + output (32K) + safety margin (5K)
  const systemTokensEst = Math.ceil((SYSTEM_PROMPT.length + AUDIT_CRITERIA.length) / 3);
  const outputReserve = 32000;
  const safetyMargin = 5000;
  const maxInputTokens = 200000 - outputReserve - safetyMargin;
  // HTML tokens: minified HTML ≈ 2.5 chars/token
  const htmlTokensEst = Math.ceil(html.length / 2.5);
  const promptOverheadTokens = 2000;
  const availableTokensForAssets = maxInputTokens - systemTokensEst - htmlTokensEst - promptOverheadTokens;
  // Convert back to chars (minified code ≈ 2.5 chars/token)
  const availableForAssets = Math.max(0, availableTokensForAssets * 2.5);

  console.log(`[Claude] Token budget — max input: ${maxInputTokens}, system: ~${systemTokensEst}, HTML: ~${htmlTokensEst}, available for CSS+JS: ~${availableTokensForAssets} tokens (~${Math.round(availableForAssets/1024)}KB)`);
  console.log(`[Claude] Raw sizes — HTML: ${htmlSizeKB}KB, CSS: ${Math.round(rawCSS.length/1024)}KB, JS: ${Math.round(rawJS.length/1024)}KB`);

  /**
   * Aggressive compression for production sites:
   * 1. Strip comments, data URIs, source maps
   * 2. Extract only audit-relevant CSS (selectors with states, media queries, font/color declarations)
   * 3. Remove vendor prefixed duplicates, keyframe internals, long value lists
   * 4. For JS: remove long minified lines, keep only structural/audit-relevant patterns
   */
  function compressCSS(css) {
    if (!css) return '';
    let out = css;
    // Remove block comments
    out = out.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove data URIs
    out = out.replace(/url\(["']?data:[^)]{50,}["']?\)/g, 'url(data:...)');
    // Remove vendor-prefixed duplicates (keep unprefixed version)
    out = out.replace(/\s*-(?:webkit|moz|ms|o)-[^;:]+:[^;]+;/g, '');
    // Collapse @keyframes bodies to just the name (internals not audit-relevant)
    out = out.replace(/@keyframes\s+([\w-]+)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '@keyframes $1 { /* ... */ }');
    // Truncate long property values (gradients, shadows with many stops, transforms)
    out = out.replace(/:\s*([^;]{300,});/g, (m, val) => ': ' + val.substring(0, 120) + '...;');
    // Collapse whitespace
    out = out.replace(/[ \t]+/g, ' ');
    out = out.replace(/\n{2,}/g, '\n');
    out = out.replace(/^\s*$/gm, '');
    return out.trim();
  }

  function compressJS(js) {
    if (!js) return '';
    let out = js;
    // Remove block comments
    out = out.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove single-line comments
    out = out.replace(/^\s*\/\/.*$/gm, '');
    // Remove source map references
    out = out.replace(/\/\/#\s*sourceMappingURL=.*/g, '');
    // Remove lines longer than 500 chars (minified bundles) — these are unreadable anyway
    out = out.replace(/^.{500,}$/gm, '// [minified line removed]');
    // Deduplicate consecutive "[minified line removed]" markers
    out = out.replace(/(\/\/ \[minified line removed\]\n?){2,}/g, '// [minified bundle code removed]\n');
    // Truncate long string literals
    out = out.replace(/(["'`])([^"'`\n]{150,})\1/g, (m, q, c) => `${q}${c.substring(0, 60)}...${q}`);
    // Collapse whitespace
    out = out.replace(/[ \t]+/g, ' ');
    out = out.replace(/\n{2,}/g, '\n');
    out = out.replace(/^\s*$/gm, '');
    return out.trim();
  }

  let processedCSS = compressCSS(rawCSS);
  let processedJS = compressJS(rawJS);

  const cssBefore = rawCSS.length;
  const jsBefore = rawJS.length;
  console.log(`[Claude] After compression — CSS: ${Math.round(processedCSS.length/1024)}KB (was ${Math.round(cssBefore/1024)}KB), JS: ${Math.round(processedJS.length/1024)}KB (was ${Math.round(jsBefore/1024)}KB)`);

  // If still over budget, allocate proportionally to CSS and JS, then truncate with notice
  const totalAssetChars = processedCSS.length + processedJS.length;
  if (totalAssetChars > availableForAssets && availableForAssets > 0) {
    const cssRatio = processedCSS.length / totalAssetChars;
    const cssAlloc = Math.floor(availableForAssets * cssRatio);
    const jsAlloc = availableForAssets - cssAlloc;

    if (processedCSS.length > cssAlloc) {
      processedCSS = processedCSS.substring(0, cssAlloc) + '\n\n/* ... CSS truncated to fit token limit — Python pre-audit analyzed the full CSS above */';
      console.log(`[Claude] CSS truncated to ${Math.round(cssAlloc/1024)}KB`);
    }
    if (processedJS.length > jsAlloc) {
      processedJS = processedJS.substring(0, jsAlloc) + '\n\n// ... JS truncated to fit token limit — Python pre-audit analyzed the full JS above';
      console.log(`[Claude] JS truncated to ${Math.round(jsAlloc/1024)}KB`);
    }
  }

  const cssSizeKB = Math.round(processedCSS.length / 1024);
  const jsSizeKB = Math.round(processedJS.length / 1024);
  const totalKB = htmlSizeKB + cssSizeKB + jsSizeKB;
  console.log(`[Claude] Final payload: HTML ${htmlSizeKB}KB + CSS ${cssSizeKB}KB + JS ${jsSizeKB}KB = ${totalKB}KB`);

  // Build CSS/JS blocks for Claude
  let sourceBlocks = '';
  if (processedCSS.length > 0) {
    sourceBlocks += `\n\nCSS (${cssSizeKB}KB — all external + inline stylesheets, compressed):\n\`\`\`css\n${processedCSS}\n\`\`\``;
  }
  if (processedJS.length > 0) {
    sourceBlocks += `\n\nJAVASCRIPT (${jsSizeKB}KB — all external + inline scripts, compressed):\n\`\`\`javascript\n${processedJS}\n\`\`\``;
  }

  const userMessage = preAuditData
    ? `URL: ${url}

${preAuditSummary}

FULL HTML (${htmlSizeKB}KB):
\`\`\`html
${html}
\`\`\`${sourceBlocks}

Evaluate ONLY the ${Object.values(preAuditData.findings).flat().filter(f => f.status === 'NEEDS_AI_REVIEW').length} checks listed above. Do NOT re-evaluate automated checks.
You have the COMPLETE source code (HTML + CSS + JS). Use it to give accurate, evidence-based evaluations.
Return JSON with the standard audit structure.
IMPORTANT: Be very concise - notes <100 chars, details <300 chars each.`
    : `Evaluate ${url} against all audit criteria.

FULL HTML (${htmlSizeKB}KB):
\`\`\`html
${html}
\`\`\`${sourceBlocks}

${focusedCriteria}

You have the COMPLETE source code. Use it to give accurate, evidence-based evaluations.
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
