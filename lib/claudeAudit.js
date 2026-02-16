/**
 * Claude API integration for AI-powered website evaluation
 * Sends page HTML + audit criteria to Claude and gets structured results
 */

const Anthropic = require('@anthropic-ai/sdk');

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
9. Sufficient contrast between text and background
10. Content is structured with clear hierarchy (H1 → H2 → H3)

### Interaction Design
11. Primary call-to-action is immediately identifiable
12. Interactive elements look clickable/tappable
13. Feedback is provided after user actions (hover states, click states)
14. Error states are informative and guide recovery
15. Loading states are present where needed

### Cognitive Load
16. Page does not overwhelm with too many options
17. Related items are grouped visually
18. Progressive disclosure is used for complex content
19. Consistent patterns are used across the page
20. Users can accomplish primary task without confusion

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
      { "check": "Clear primary navigation with logical grouping", "status": "pass|warn|fail|na", "note_no": "Brief note in Norwegian", "note_en": "Brief note in English", "details_no": "Detailed explanation in Norwegian", "details_en": "Detailed explanation in English", "recommendation_no": "How to fix in Norwegian (empty string if pass)", "recommendation_en": "How to fix in English (empty string if pass)" }
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
    "no": "3-5 paragraphs plain-language summary in Norwegian for client communication",
    "en": "3-5 paragraphs plain-language summary in English for client communication"
  },
  "executiveSummary": {
    "no": "1-2 sentence overview in Norwegian",
    "en": "1-2 sentence overview in English"
  }
}

Rules:
- Every check from the criteria list MUST appear in the output
- Use "na" status when something genuinely cannot be determined from HTML source
- Priority fixes should list the 5-10 most impactful issues, sorted by severity
- Customer summary should be accessible to non-technical readers
- Write both Norwegian (bokmål) and English for all text fields`;

async function runClaudeAudit(html, url, apiKey) {
  const client = new Anthropic({ apiKey });

  const userMessage = `Evaluate this webpage against all audit criteria.

URL: ${url}

HTML SOURCE CODE:
\`\`\`html
${html}
\`\`\`

${AUDIT_CRITERIA}

Return ONLY valid JSON matching the specified structure. No markdown, no code fences, just the JSON object.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

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
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${e.message}\nRaw response: ${text.substring(0, 500)}`);
  }
}

module.exports = { runClaudeAudit };
