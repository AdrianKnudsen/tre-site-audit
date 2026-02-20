# Audit Criteria

Complete checklist of evaluation items per audit domain (101 checks). Use status: pass, warn, fail, or n/a for each item.
Heuristic references (e.g. [Nielsen #1]) indicate alignment with Jakob Nielsen's 10 Usability Heuristics.

## 1. UX (User Experience) — 30 checks

### Navigation & Information Architecture (7)
1. Clear primary navigation with logical grouping
2. Current page/section is visually indicated [Nielsen #1]
3. Breadcrumbs present where appropriate
4. Search functionality is accessible and functional
5. Footer contains expected utility links
6. Important content reachable within 3 clicks from landing page (3-click rule)
7. Information architecture follows users' mental model — labels and grouping match user expectations [Nielsen #2]

### Content & Readability (7)
8. Headlines are descriptive and scannable
9. Body text is appropriately sized (minimum 16px)
10. Line length is comfortable (45-75 characters)
11. Language and terminology match users' real-world vocabulary (no unexplained jargon or internal labels) [Nielsen #2]
12. Content is structured with clear hierarchy (H1 → H2 → H3)
13. Images and media are relevant, high-quality, and support the content
14. Content aligns with user goals and business objectives — clear value proposition

### Interaction Design (8)
15. Primary call-to-action is immediately identifiable
16. Interactive elements look and behave as expected (clear affordances)
17. Visibility of system status: loading indicators, progress, success, and error states are communicated clearly [Nielsen #1]
18. Error messages are specific and guide users toward recovery [Nielsen #9]
19. Error prevention: risky or irreversible actions require confirmation; forms use inline validation to catch mistakes early [Nielsen #5]
20. Shortcuts and accelerators available for experienced users (keyboard shortcuts, quick actions, auto-complete) [Nielsen #7]
21. Form design: inline validation, clearly marked required fields, appropriate input types, and helpful placeholder text
22. Mobile interaction design: touch targets in thumb zone, swipe-friendly, no hover-dependent functionality

### Cognitive Load & User Control (8)
23. Page offers minimal but sufficient choices; no unnecessary complexity or clutter (Hick's Law) [Nielsen #8]
24. UI surfaces available options; users recognize rather than recall information (recognition over recall) [Nielsen #6]
25. Related items are visually grouped; progressive disclosure is used for complex or secondary content
26. Platform conventions are respected and escape routes are available (back, cancel, undo) — no dead ends [Nielsen #3 + #4]
27. Users can accomplish the primary task without confusion or external help
28. Help and documentation is accessible when needed — FAQ, tooltips, contextual help [Nielsen #10]
29. Trust signals present: security badges, certifications, testimonials, social proof where appropriate
30. Onboarding or first-time user guidance for complex features or flows

## 2. UI (User Interface) — 27 checks

### Visual Hierarchy (6)
31. Clear distinction between heading levels
32. Primary action stands out from secondary actions
33. Visual weight guides the eye through content
34. Adequate whitespace between sections
35. Reading flow follows natural scan patterns (F-pattern or Z-pattern)
36. Content density is balanced — sufficient breathing room without excessive empty space

### Typography (5)
37. Consistent font families (max 2-3)
38. Clear type scale with distinct heading sizes
39. Appropriate line height (1.4-1.6 for body text)
40. Font weights used purposefully for emphasis
41. Text alignment is consistent

### Color & Contrast (5)
42. Consistent color palette throughout
43. Color is not the sole means of conveying information
44. Sufficient contrast ratios (4.5:1 for normal text, 3:1 for large text)
45. Brand colors applied consistently
46. Hover/active states have distinct colors

### Spacing & Layout (5)
47. Consistent spacing system (8px grid or similar)
48. Proper alignment across elements
49. Responsive layout adapts to viewport
50. Adequate padding within containers
51. Margins are consistent between similar elements

### Components (6)
52. Buttons have consistent styling across the page
53. Form fields have consistent styling
54. Icons are consistent in style, size, and weight
55. Cards/containers follow a consistent pattern
56. Borders and border-radius are consistent
57. 404 and error pages are designed, branded, and guide users back to valid content

## 3. Accessibility (UU / WCAG 2.1) — 23 checks

### Perceivable (5)
58. All images have meaningful alt text (or alt="" for decorative)
59. Video/audio has captions or transcripts
60. Color contrast meets WCAG AA (4.5:1 normal, 3:1 large)
61. Text can be resized to 200% without loss of content
62. Content is readable without CSS

### Operable (7)
63. All functionality available via keyboard
64. Visible focus indicator on interactive elements
65. No keyboard traps
66. Skip-to-content link present
67. Touch targets minimum 44x44px on mobile
68. No content flashes more than 3 times per second
69. Reduced motion support: respects `prefers-reduced-motion` for animations and transitions

### Understandable (5)
70. Page language is declared (`lang` attribute)
71. Form labels are associated with inputs
72. Error messages identify the field and describe the error
73. Consistent navigation across pages
74. Abbreviations and jargon are explained

### Robust (6)
75. Valid HTML structure
76. Proper heading hierarchy (no skipped levels)
77. ARIA roles used correctly (not overused)
78. Semantic HTML elements used (nav, main, article, etc.)
79. Forms have proper fieldset/legend grouping
80. Cross-browser and cross-device compatibility — no major rendering differences

## 4. Best Practices — 21 checks

### Performance Indicators (5)
81. Images are optimized (WebP/AVIF, proper sizing, lazy loading)
82. CSS and JS are minified
83. No render-blocking resources in critical path
84. Efficient caching headers
85. Fonts are preloaded or use font-display swap

### Security (5)
86. HTTPS is enforced
87. No mixed content warnings
88. Proper CSP headers
89. External links use `rel="noopener noreferrer"`
90. No exposed sensitive data in source

### SEO Fundamentals (6)
91. Unique, descriptive `<title>` tag
92. Meta description present and relevant
93. Proper use of heading hierarchy for content
94. Canonical URL specified
95. Open Graph / social meta tags present
96. Structured data (JSON-LD) where appropriate

### Code Quality (5)
97. No console errors
98. No broken links or missing resources (404s)
99. Responsive meta viewport tag present
100. Favicon present
101. Print stylesheet considered

## 5. Lighthouse Metrics Reference

### Performance Metrics
| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| First Contentful Paint (FCP) | < 1.8s | 1.8-3.0s | > 3.0s |
| Largest Contentful Paint (LCP) | < 2.5s | 2.5-4.0s | > 4.0s |
| Total Blocking Time (TBT) | < 200ms | 200-600ms | > 600ms |
| Cumulative Layout Shift (CLS) | < 0.1 | 0.1-0.25 | > 0.25 |
| Speed Index (SI) | < 3.4s | 3.4-5.8s | > 5.8s |

### Score Thresholds
| Score | Rating |
|-------|--------|
| 90-100 | Good (green) |
| 50-89 | Needs Improvement (orange) |
| 0-49 | Poor (red) |

## Nielsen's 10 Usability Heuristics — Reference

| # | Heuristic | Covered in checks |
|---|-----------|------------------|
| 1 | Visibility of system status | #2, #17 |
| 2 | Match between system and real world | #7, #11 |
| 3 | User control and freedom | #26 |
| 4 | Consistency and standards | #26 |
| 5 | Error prevention | #19 |
| 6 | Recognition rather than recall | #24 |
| 7 | Flexibility and efficiency of use | #20 |
| 8 | Aesthetic and minimalist design | #23 |
| 9 | Help users recognize, diagnose, recover from errors | #18 |
| 10 | Help and documentation | #28 |
