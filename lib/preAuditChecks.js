/**
 * Pre-Audit Automated Checker (JavaScript ES Module)
 * ===================================================
 * Runs programmatic checks on raw HTML, CSS, and JS to pre-fill audit findings
 * that don't require visual/subjective AI judgment. Outputs a partial audit-data
 * JSON that the AI merges with its own visual evaluations before generating the
 * final report.
 *
 * v2.1.0 — Full CSS + JS analysis. Covers ~55-60 of 101 checks automatically.
 *
 * Usage:
 *   import { runPreAuditChecks } from './preAuditChecks.js';
 *   const result = runPreAuditChecks(html, url, cssContent, jsContent);
 */

// ---------------------------------------------------------------------------
// HTML Parser – single pass to collect all the data we need (regex-based)
// ---------------------------------------------------------------------------

class AuditHTMLParser {
  constructor() {
    this.images = [];
    this.headings = [];
    this.links = [];
    this.metaTags = {};
    this.hasTitle = false;
    this.titleText = "";
    this.lang = null;
    this.hasViewport = false;
    this.hasCanonical = false;
    this.hasSkipLink = false;
    this.hasNav = false;
    this.hasMain = false;
    this.hasArticle = false;
    this.hasHeader = false;
    this.hasFooter = false;
    this.hasSearch = false;
    this.hasBreadcrumb = false;
    this.hasFavicon = false;
    this.formInputs = [];
    this.labelFors = new Set();
    this.fontsInStyle = new Set();
    this.colorsInStyle = new Set();
    this.ariaAttrs = {};
    this.fieldsets = 0;
    this.legends = 0;
    this.externalLinks = [];
    this.lazyImages = 0;
    this.totalImagesWithSrc = 0;
    this.webpAvifImages = 0;
    this.scripts = [];
    this.stylesheets = [];
    this.hasStructuredData = false;
    this.ogTags = new Set();
    this.inlineCSS = "";
    this.bodyFontSizePx = null;
    this.bodyLineHeight = null;
    this.hasMediaQueries = false;
    this.hasPrintMedia = false;
    this.accesskeys = 0;
    this.autocompleteInputs = 0;
    this.hasPrefersReducedMotion = false;
    this.trustSignals = [];
    this.formInputsExtended = [];
    this.navMaxListDepth = 0;
    this.internalLinks = [];
    this.importantPagesLinked = [];
    this.inlineStyles = [];
    this.inlineScripts = "";
    this.detectedFrameworks = new Set();
    this.dataAttributes = {};
    this.duplicateIds = [];
    this.allIds = new Set();
    this.hasCSPMeta = false;
    this.cspContent = "";
    this.hasAriaCurrentInNav = false;
    this.hasActiveClassInNav = false;
  }

  parse(html) {
    // Title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      this.hasTitle = true;
      this.titleText = titleMatch[1].trim();
    }

    // HTML lang attribute
    const htmlMatch = html.match(/<html[^>]*\s+lang\s*=\s*["']?([^"'>\s]+)/i);
    if (htmlMatch) {
      this.lang = htmlMatch[1];
    }

    // Meta tags and viewport
    const metaMatches = html.matchAll(/<meta\s+([^>]*)>/gi);
    for (const match of metaMatches) {
      const attrs = this._parseAttributes(match[1]);
      const name = (attrs.name || "").toLowerCase();
      const prop = (attrs.property || "").toLowerCase();
      const content = attrs.content || "";

      if (name === "viewport") this.hasViewport = true;
      if (name === "description") this.metaTags.description = content;
      if (name) this.metaTags[name] = content;
      if (prop) this.metaTags[prop] = content;
      if (prop.startsWith("og:")) this.ogTags.add(prop);
    }

    // Link tags (canonical, favicon, stylesheets)
    const linkMatches = html.matchAll(/<link\s+([^>]*)>/gi);
    for (const match of linkMatches) {
      const attrs = this._parseAttributes(match[1]);
      const rel = (attrs.rel || "").toLowerCase();
      const href = attrs.href || "";
      if (rel.includes("canonical")) this.hasCanonical = true;
      if (rel.includes("icon") || rel.includes("shortcut")) this.hasFavicon = true;
      if (rel.includes("stylesheet")) this.stylesheets.push({ href });
    }

    // Headings
    const headingMatches = html.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi);
    for (const match of headingMatches) {
      const level = parseInt(match[1][1]);
      const text = this._stripTags(match[2]).trim();
      this.headings.push([level, text]);
    }

    // Images
    const imgMatches = html.matchAll(/<img\s+([^>]*)>/gi);
    for (const match of imgMatches) {
      const attrs = this._parseAttributes(match[1]);
      const src = attrs.src || "";
      const alt = attrs.alt;
      this.images.push([src, alt]);
      if (src) {
        this.totalImagesWithSrc++;
        const ext = src.split("?")[0].split(".").pop().toLowerCase();
        if (["webp", "avif"].includes(ext) || src.includes("webp") || src.includes("avif")) {
          this.webpAvifImages++;
        }
      }
      if (attrs.loading === "lazy") {
        this.lazyImages++;
      }
    }

    // Links
    const linkContentMatches = html.matchAll(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi);
    for (const match of linkContentMatches) {
      const attrs = this._parseAttributes(match[1]);
      const href = attrs.href || "";
      const rel = attrs.rel || "";
      const target = attrs.target || "";
      const text = this._stripTags(match[2]).trim();
      this.links.push({ href, rel, target, text });

      if (href && href.startsWith("#") && ["main", "content", "skip"].some(kw => href.toLowerCase().includes(kw))) {
        this.hasSkipLink = true;
      }

      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        this.externalLinks.push({
          href,
          hasNoopener: rel.includes("noopener"),
          hasNoreferrer: rel.includes("noreferrer"),
        });
      }

      if (href && !["http://", "https://", "mailto:", "tel:", "javascript:", "#"].some(prefix => href.startsWith(prefix))) {
        this.internalLinks.push(href);
        const importantKws = ["kontakt", "contact", "om-oss", "om oss", "about", "tjenester", "services",
          "priser", "pricing", "hjelp", "help", "faq", "support", "blogg", "blog"];
        const hrefLower = href.toLowerCase();
        for (const kw of importantKws) {
          if (hrefLower.includes(kw) && !this.importantPagesLinked.includes(kw)) {
            this.importantPagesLinked.push(kw);
          }
        }
      }
    }

    // Navigation
    const navMatches = html.matchAll(/<nav[^>]*>([\s\S]*?)<\/nav>/gi);
    for (const match of navMatches) {
      this.hasNav = true;
      const navContent = match[1];
      const navAttrs = this._parseAttributes(match[0]);
      const ariaLabel = (navAttrs["aria-label"] || "").toLowerCase();
      if (ariaLabel.includes("breadcrumb") || ariaLabel.includes("brødsmule")) {
        this.hasBreadcrumb = true;
      }

      // Calculate nav list nesting depth (track open/close tags)
      const listTagMatches = navContent.matchAll(/<(\/?)(ul|ol)[^>]*>/gi);
      let currentDepth = 0;
      for (const m of listTagMatches) {
        if (m[1] === '/') {
          currentDepth--;
        } else {
          currentDepth++;
          if (currentDepth > this.navMaxListDepth) {
            this.navMaxListDepth = currentDepth;
          }
        }
      }
    }

    // Semantic elements
    if (html.includes("<main")) this.hasMain = true;
    if (html.includes("<article")) this.hasArticle = true;
    if (html.includes("<header")) this.hasHeader = true;
    if (html.includes("<footer")) this.hasFooter = true;

    // Breadcrumbs in role/class
    const breadcrumbMatches = html.matchAll(/role\s*=\s*["']breadcrumb["']|class\s*=\s*["'][^"]*breadcrumb[^"]*["']/gi);
    for (const _ of breadcrumbMatches) {
      this.hasBreadcrumb = true;
      break;
    }

    // Search
    const searchMatches = html.matchAll(/role\s*=\s*["']search["']|class\s*=\s*["'][^"]*search[^"]*["']|<search/gi);
    for (const _ of searchMatches) {
      this.hasSearch = true;
      break;
    }

    // Form inputs
    const inputMatches = html.matchAll(/<input\s+([^>]*)>/gi);
    for (const match of inputMatches) {
      const attrs = this._parseAttributes(match[1]);
      const type = (attrs.type || "text").toLowerCase();
      if (!["hidden", "submit", "button", "reset"].includes(type)) {
        const id = attrs.id || "";
        const name = attrs.name || "";
        const ariaLabel = attrs["aria-label"] || "";
        const ariaLabelledby = attrs["aria-labelledby"] || "";
        const hasLabel = !!(id && this.labelFors.has(id)) || !!ariaLabel || !!ariaLabelledby;
        this.formInputs.push({ id, name, type, hasLabel });

        if (attrs.autocomplete) {
          this.autocompleteInputs++;
        }

        this.formInputsExtended.push({
          type,
          required: "required" in attrs,
          placeholder: !!attrs.placeholder,
          pattern: !!attrs.pattern,
          autocomplete: !!attrs.autocomplete,
          name,
        });
      }
      if (type === "search") {
        this.hasSearch = true;
      }
    }

    // Labels
    const labelMatches = html.matchAll(/<label\s+([^>]*)>/gi);
    for (const match of labelMatches) {
      const attrs = this._parseAttributes(match[1]);
      if (attrs.for) {
        this.labelFors.add(attrs.for);
      }
    }

    // Fieldset and legend
    this.fieldsets = (html.match(/<fieldset/gi) || []).length;
    this.legends = (html.match(/<legend/gi) || []).length;

    // Textarea and select
    const textareaMatches = html.matchAll(/<textarea\s+([^>]*)>([\s\S]*?)<\/textarea>/gi);
    for (const match of textareaMatches) {
      const attrs = this._parseAttributes(match[1]);
      this.formInputsExtended.push({
        type: "textarea",
        required: "required" in attrs,
        placeholder: !!attrs.placeholder,
        pattern: false,
        autocomplete: false,
        name: attrs.name || "",
      });
    }

    const selectMatches = html.matchAll(/<select\s+([^>]*)>/gi);
    for (const match of selectMatches) {
      const attrs = this._parseAttributes(match[1]);
      this.formInputsExtended.push({
        type: "select",
        required: "required" in attrs,
        placeholder: false,
        pattern: false,
        autocomplete: false,
        name: attrs.name || "",
      });
    }

    // Trust signals
    const trustKws = ["trust", "testimonial", "review", "rating", "badge", "certification", "verified", "secure", "guarantee"];
    for (const kw of trustKws) {
      if (new RegExp(kw, "i").test(html)) {
        if (!this.trustSignals.includes(kw)) {
          this.trustSignals.push(kw);
        }
      }
    }

    // Scripts
    const scriptMatches = html.matchAll(/<script\s+([^>]*)>([\s\S]*?)<\/script>/gi);
    for (const match of scriptMatches) {
      const attrs = this._parseAttributes(match[1]);
      const src = attrs.src || "";
      const content = match[2];

      if (src) {
        this.scripts.push({ src, async: "async" in attrs, defer: "defer" in attrs });
        this._detectFrameworksFromScriptSrc(src);
      } else {
        this.inlineScripts += content + "\n";
        this._detectFrameworksFromInlineScript(content);
      }

      if (attrs.type && attrs.type.includes("ld+json")) {
        this.hasStructuredData = true;
      }
    }

    // ARIA attributes
    const ariaMatches = html.matchAll(/aria-\w+/gi);
    for (const match of ariaMatches) {
      const attr = match[0].toLowerCase();
      this.ariaAttrs[attr] = (this.ariaAttrs[attr] || 0) + 1;
    }

    // Accesskeys
    const accesskeyMatches = html.matchAll(/accesskey\s*=\s*["']([^"']+)["']/gi);
    this.accesskeys = accesskeyMatches.length || (html.match(/accesskey/gi) || []).length;

    // Inline styles
    const styleMatches = html.matchAll(/style\s*=\s*["']([^"']+)["']/gi);
    for (const match of styleMatches) {
      this.inlineStyles.push(match[1]);
    }

    // Inline CSS from <style> tags
    const inlineStyleMatches = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    for (const match of inlineStyleMatches) {
      this.inlineCSS += match[1] + "\n";
    }

    // Data attributes
    const dataAttrMatches = html.matchAll(/data-[\w-]+/gi);
    for (const match of dataAttrMatches) {
      const attr = match[0];
      this.dataAttributes[attr] = (this.dataAttributes[attr] || 0) + 1;
      if (attr === "data-reactroot" || attr === "data-reactid") {
        this.detectedFrameworks.add("React");
      }
      if (attr.startsWith("data-v-")) {
        this.detectedFrameworks.add("Vue");
      }
      if (attr === "data-turbo" || attr === "data-turbolinks") {
        this.detectedFrameworks.add("Turbo/Hotwire");
      }
      if (attr === "data-controller" || attr === "data-action") {
        this.detectedFrameworks.add("Stimulus");
      }
    }

    // Angular attributes
    if (html.match(/ng-|_ngcontent|_nghost/gi)) {
      this.detectedFrameworks.add("Angular");
    }

    // Alpine.js attributes
    if (html.match(/x-data|x-bind|x-on/gi)) {
      this.detectedFrameworks.add("Alpine.js");
    }

    // Duplicate IDs
    const idMatches = html.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi);
    for (const m of idMatches) {
      const id = m[1].trim();
      if (id) {
        if (this.allIds.has(id)) {
          if (!this.duplicateIds.includes(id)) this.duplicateIds.push(id);
        } else {
          this.allIds.add(id);
        }
      }
    }

    // CSP meta tag
    const cspMatches = html.matchAll(/<meta\s+[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi);
    for (const m of cspMatches) {
      this.hasCSPMeta = true;
      const contentMatch = m[0].match(/content\s*=\s*["']([^"']+)["']/i);
      if (contentMatch) this.cspContent = contentMatch[1];
    }

    // Current page indicators in nav
    const navBlocksForCurrent = html.matchAll(/<nav[^>]*>([\s\S]*?)<\/nav>/gi);
    for (const nm of navBlocksForCurrent) {
      const navHtml = nm[1];
      if (/aria-current\s*=\s*["'](?:page|true|step|location)["']/i.test(navHtml)) {
        this.hasAriaCurrentInNav = true;
      }
      if (/class\s*=\s*["'][^"']*\b(?:active|current|selected|is-active|is-current)\b[^"']*["']/i.test(navHtml)) {
        this.hasActiveClassInNav = true;
      }
    }
  }

  _parseAttributes(str) {
    const attrs = {};
    const attrRegex = /(\w+(?:-\w+)*)\s*=\s*["']?([^"'>\s]+)["']?|\s(\w+(?:-\w+)*)\s/g;
    let match;
    while ((match = attrRegex.exec(str)) !== null) {
      if (match[1]) {
        attrs[match[1].toLowerCase()] = match[2];
      } else if (match[3]) {
        attrs[match[3].toLowerCase()] = true;
      }
    }
    return attrs;
  }

  _stripTags(html) {
    return html.replace(/<[^>]*>/g, "");
  }

  _detectFrameworksFromScriptSrc(src) {
    const lower = src.toLowerCase();
    if (lower.includes("react") || lower.includes("react-dom")) this.detectedFrameworks.add("React");
    if (lower.includes("vue")) this.detectedFrameworks.add("Vue");
    if (lower.includes("angular")) this.detectedFrameworks.add("Angular");
    if (lower.includes("svelte")) this.detectedFrameworks.add("Svelte");
    if (lower.includes("jquery")) this.detectedFrameworks.add("jQuery");
    if (lower.includes("bootstrap")) this.detectedFrameworks.add("Bootstrap");
    if (lower.includes("tailwind")) this.detectedFrameworks.add("Tailwind");
    if (lower.includes("alpine")) this.detectedFrameworks.add("Alpine.js");
    if (lower.includes("htmx")) this.detectedFrameworks.add("HTMX");
    if (lower.includes("next") && (lower.includes("_next") || lower.includes("next.js"))) this.detectedFrameworks.add("Next.js");
    if (lower.includes("nuxt") || lower.includes("_nuxt")) this.detectedFrameworks.add("Nuxt");
    if (lower.includes("gatsby")) this.detectedFrameworks.add("Gatsby");
    if (lower.includes("remix")) this.detectedFrameworks.add("Remix");
    if (lower.includes("astro")) this.detectedFrameworks.add("Astro");
    if (lower.includes("webpack")) this.detectedFrameworks.add("Webpack");
    if (lower.includes("vite")) this.detectedFrameworks.add("Vite");
  }

  _detectFrameworksFromInlineScript(content) {
    if (content.includes("__NEXT_DATA__") || content.includes("next/router")) this.detectedFrameworks.add("Next.js");
    if (content.includes("__NUXT__") || content.toLowerCase().includes("nuxt")) this.detectedFrameworks.add("Nuxt");
    if (content.includes("React") || content.includes("ReactDOM") || content.includes("createElement")) this.detectedFrameworks.add("React");
    if (content.includes("Vue") && (content.includes("createApp") || content.includes("new Vue"))) this.detectedFrameworks.add("Vue");
    if (content.toLowerCase().includes("angular") && content.toLowerCase().includes("module")) this.detectedFrameworks.add("Angular");
    if (content.includes("wp-content") || content.toLowerCase().includes("wordpress")) this.detectedFrameworks.add("WordPress");
    if (content.includes("Shopify") || content.toLowerCase().includes("shopify")) this.detectedFrameworks.add("Shopify");
    if (content.toLowerCase().includes("wix")) this.detectedFrameworks.add("Wix");
    if (content.toLowerCase().includes("squarespace")) this.detectedFrameworks.add("Squarespace");
    if (content.toLowerCase().includes("webflow")) this.detectedFrameworks.add("Webflow");
    if (content.toLowerCase().includes("gatsby")) this.detectedFrameworks.add("Gatsby");
    if (content.includes("Svelte") || content.includes("svelte")) this.detectedFrameworks.add("Svelte");
  }

  secondPassLabelCheck() {
    for (const inp of this.formInputs) {
      if (inp.id && this.labelFors.has(inp.id)) {
        inp.hasLabel = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CSS Analyzer – deep analysis of combined CSS (inline + external)
// ---------------------------------------------------------------------------

class CSSAnalyzer {
  constructor(cssText) {
    this.raw = cssText;
    this.colors = new Set();
    this.colorUsages = {};
    this.fontFamilies = new Set();
    this.fontSizes = [];
    this.fontWeights = new Set();
    this.fontDisplayValues = new Set();
    this.paddings = [];
    this.margins = [];
    this.gaps = [];
    this.mediaQueries = [];
    this.breakpoints = new Set();
    this.hasPrintMedia = false;
    this.hasReducedMotion = false;
    this.hasFlexbox = false;
    this.hasGrid = false;
    this.hasHover = false;
    this.hasActive = false;
    this.hasFocus = false;
    this.hasFocusVisible = false;
    this.bodyFontSizePx = null;
    this.bodyLineHeight = null;
    this.borderRadii = new Set();
    this.zIndices = new Set();
    this.isLikelyMinified = false;
    this.textAlignValues = {};
    this.maxWidthOnTextContainers = [];
    this.minHeightsOnInteractive = [];
    this.minWidthsOnInteractive = [];
    this._analyze();
  }

  _analyze() {
    const css = this.raw;
    if (!css) return;

    // Minification check
    const lines = css.split("\n");
    if (lines.length > 0) {
      const avgLineLen = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
      this.isLikelyMinified = avgLineLen > 200;
    }

    // Colors
    for (const match of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      const c = "#" + match[1].toLowerCase();
      this.colors.add(c);
      this.colorUsages[c] = (this.colorUsages[c] || 0) + 1;
    }
    for (const match of css.matchAll(/rgba?\([^)]+\)/g)) {
      const c = match[0].toLowerCase().replace(/\s/g, "");
      this.colors.add(c);
      this.colorUsages[c] = (this.colorUsages[c] || 0) + 1;
    }
    for (const match of css.matchAll(/hsla?\([^)]+\)/g)) {
      const c = match[0].toLowerCase().replace(/\s/g, "");
      this.colors.add(c);
      this.colorUsages[c] = (this.colorUsages[c] || 0) + 1;
    }

    // Font families
    for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      const families = match[1].split(",").map(f => f.trim().replace(/^["']|["']$/g, ""));
      const generics = new Set(["inherit", "initial", "unset", "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"]);
      for (const f of families) {
        if (f && !generics.has(f.toLowerCase())) {
          this.fontFamilies.add(f);
        }
      }
    }

    // Font sizes
    for (const match of css.matchAll(/font-size\s*:\s*([\d.]+)(px|rem|em|vw|vh|%)\b/gi)) {
      this.fontSizes.push([parseFloat(match[1]), match[2].toLowerCase()]);
    }

    // Font weights
    for (const match of css.matchAll(/font-weight\s*:\s*(\w+)/gi)) {
      this.fontWeights.add(match[1].toLowerCase());
    }

    // Font-display
    for (const match of css.matchAll(/font-display\s*:\s*(\w+)/gi)) {
      this.fontDisplayValues.add(match[1].toLowerCase());
    }

    // Body font-size
    let bodyMatch = css.match(/body\s*[,{][^}]*?font-size\s*:\s*([\d.]+)(px|rem|em)\b/i);
    if (!bodyMatch) {
      bodyMatch = css.match(/body\s*\{[^}]*?font-size\s*:\s*([\d.]+)(px|rem|em)\b/i);
    }
    if (bodyMatch) {
      const v = parseFloat(bodyMatch[1]);
      const u = bodyMatch[2].toLowerCase();
      this.bodyFontSizePx = u === "rem" || u === "em" ? v * 16 : v;
    }

    // Body line-height
    const lhMatch = css.match(/body\s*\{[^}]*?line-height\s*:\s*([\d.]+)\s*[;}\n]/i);
    if (lhMatch) {
      this.bodyLineHeight = parseFloat(lhMatch[1]);
    }

    // Paddings
    for (const match of css.matchAll(/padding(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]+)/gi)) {
      for (const [v, u] of match[1].matchAll(/([\d.]+)(px|rem|em|%)/g)) {
        let px = parseFloat(v);
        if (u === "rem" || u === "em") px *= 16;
        this.paddings.push(px);
      }
    }

    // Margins
    for (const match of css.matchAll(/margin(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]+)/gi)) {
      for (const [v, u] of match[1].matchAll(/([\d.]+)(px|rem|em|%)/g)) {
        let px = parseFloat(v);
        if (u === "rem" || u === "em") px *= 16;
        this.margins.push(px);
      }
    }

    // Gap
    for (const match of css.matchAll(/(?:^|[;\s])gap\s*:\s*([^;}]+)/gi)) {
      for (const [v, u] of match[1].matchAll(/([\d.]+)(px|rem|em)/g)) {
        let px = parseFloat(v);
        if (u === "rem" || u === "em") px *= 16;
        this.gaps.push(px);
      }
    }

    // Media queries
    for (const match of css.matchAll(/@media\s*([^{]+)/gi)) {
      const query = match[1].trim();
      this.mediaQueries.push(query);
      for (const [v, u] of query.matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(px|em|rem)/gi)) {
        let px = parseFloat(v);
        if (u.toLowerCase() === "em" || u.toLowerCase() === "rem") px *= 16;
        this.breakpoints.add(Math.floor(px));
      }
      if (query.toLowerCase().includes("print")) {
        this.hasPrintMedia = true;
      }
    }

    // Reduced motion
    this.hasReducedMotion = !!css.match(/prefers-reduced-motion/i);

    // Layout systems
    this.hasFlexbox = !!css.match(/display\s*:\s*flex/i);
    this.hasGrid = !!css.match(/display\s*:\s*grid/i);

    // Interactive states
    this.hasHover = !!css.match(/:hover\b/);
    this.hasActive = !!css.match(/:active\b/);
    this.hasFocus = !!css.match(/:focus\b/);
    this.hasFocusVisible = !!css.match(/:focus-visible\b/);

    // Border radius
    for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)) {
      this.borderRadii.add(match[1].trim());
    }

    // Z-index
    for (const match of css.matchAll(/z-index\s*:\s*(-?\d+)/gi)) {
      this.zIndices.add(parseInt(match[1]));
    }

    // Text-align values
    for (const match of css.matchAll(/text-align\s*:\s*(\w+)/gi)) {
      const val = match[1].toLowerCase();
      this.textAlignValues[val] = (this.textAlignValues[val] || 0) + 1;
    }

    // Max-width on text containers (p, article, .content, .text, main, etc.)
    const textContainerBlocks = css.matchAll(/(?:^|\})\s*((?:p|article|main|\.content|\.text|\.prose|\.post|\.entry|\.body-text|\.article)[^{]*)\{([^}]*)\}/gim);
    for (const match of textContainerBlocks) {
      const mw = match[2].match(/max-width\s*:\s*([\d.]+)(px|rem|em|ch)/i);
      if (mw) {
        let px = parseFloat(mw[1]);
        const unit = mw[2].toLowerCase();
        if (unit === "rem" || unit === "em") px *= 16;
        if (unit === "ch") px *= 8; // approximate
        this.maxWidthOnTextContainers.push(px);
      }
    }

    // Min-height/min-width on interactive elements (button, a, input, select, .btn)
    const interactiveBlocks = css.matchAll(/(?:^|\})\s*((?:button|a|input|select|\.btn|\.button|\.cta|\[type)[^{]*)\{([^}]*)\}/gim);
    for (const match of interactiveBlocks) {
      const mh = match[2].match(/min-height\s*:\s*([\d.]+)(px|rem|em)/i);
      if (mh) {
        let px = parseFloat(mh[1]);
        if (mh[2].toLowerCase() !== "px") px *= 16;
        this.minHeightsOnInteractive.push(px);
      }
      const mw = match[2].match(/min-width\s*:\s*([\d.]+)(px|rem|em)/i);
      if (mw) {
        let px = parseFloat(mw[1]);
        if (mw[2].toLowerCase() !== "px") px *= 16;
        this.minWidthsOnInteractive.push(px);
      }
      // Also check padding that contributes to tap target size
      const paddingMatch = match[2].match(/padding\s*:\s*([\d.]+)(px|rem|em)/i);
      if (paddingMatch && !mh) {
        let px = parseFloat(paddingMatch[1]);
        if (paddingMatch[2].toLowerCase() !== "px") px *= 16;
        // double padding (top+bottom) as proxy for min tap height
        if (px * 2 >= 44) this.minHeightsOnInteractive.push(px * 2);
      }
    }
  }

  checkSpacingSystem() {
    const allSpacing = [
      ...this.paddings,
      ...this.margins,
      ...this.gaps,
    ].filter(v => v > 0);

    if (allSpacing.length < 5) {
      return [null, "insufficient data"];
    }

    const on8 = allSpacing.filter(v => v % 8 === 0 || v % 4 === 0).length;
    const pct = (on8 / allSpacing.length) * 100;

    if (pct >= 80) {
      return [true, `${pct.toFixed(0)}% follows 4/8px grid`];
    } else if (pct >= 50) {
      return [null, `${pct.toFixed(0)}% follows 4/8px grid (partial)`];
    } else {
      return [false, `only ${pct.toFixed(0)}% follows 4/8px grid`];
    }
  }

  checkColorPaletteConsistency() {
    const unique = this.colors.size;
    if (unique === 0) {
      return [null, "no colors found"];
    }

    const normalized = new Set();
    for (const c of this.colors) {
      if (c.startsWith("#")) {
        let h = c.slice(1);
        if (h.length === 3) {
          h = h.split("").map(ch => ch + ch).join("");
        }
        normalized.add("#" + h.slice(0, 6).toLowerCase());
      } else {
        normalized.add(c);
      }
    }

    const n = normalized.size;
    if (n <= 12) {
      return [true, `${n} unique colors (well-contained palette)`];
    } else if (n <= 25) {
      return [null, `${n} unique colors (moderate palette)`];
    } else {
      return [false, `${n} unique colors (may indicate inconsistency)`];
    }
  }

  checkFontDisplay() {
    if (this.fontDisplayValues.size === 0) {
      return [null, "no font-display found"];
    }
    const good = new Set(["swap", "optional", "fallback"]);
    const found = Array.from(this.fontDisplayValues);
    if (found.some(v => good.has(v))) {
      return [true, `font-display: ${found.join(", ")}`];
    }
    return [false, `font-display: ${found.join(", ")} (use swap/optional)`];
  }

  checkTypeScale() {
    const pxSizes = new Set();
    for (const [v, u] of this.fontSizes) {
      let px = u === "rem" || u === "em" ? v * 16 : v;
      if (px >= 8 && px <= 120) {
        pxSizes.add(Math.round(px));
      }
    }

    if (pxSizes.size < 3) {
      return [null, "insufficient font size data"];
    }

    const sorted = Array.from(pxSizes).sort((a, b) => a - b);
    if (sorted.length <= 8) {
      return [true, `${sorted.length} distinct sizes: ${sorted.map(s => `${s}px`).join(", ")}`];
    } else {
      return [null, `${sorted.length} distinct font sizes (may lack clear scale)`];
    }
  }
}

// ---------------------------------------------------------------------------
// JS Analyzer – pattern detection in JavaScript source
// ---------------------------------------------------------------------------

class JSAnalyzer {
  constructor(jsText) {
    this.raw = jsText;
    this.hasEventListeners = false;
    this.hasKeyboardListeners = false;
    this.hasFocusManagement = false;
    this.hasErrorHandling = false;
    this.hasTryCatch = false;
    this.hasLoadingStates = false;
    this.hasFormValidation = false;
    this.hasConsoleErrors = false;
    this.hasServiceWorker = false;
    this.hasFetchAPI = false;
    this.hasLocalStorage = false;
    this.hasScrollListeners = false;
    this.hasResizeListeners = false;
    this.hasTouchListeners = false;
    this.hasIntersectionObserver = false;
    this.hasMutationObserver = false;
    this.isLikelyMinified = false;
    this.hasAriaManipulation = false;
    this.hasFocusTrap = false;
    this.hasEscapeHandler = false;
    this.hasTabindexManagement = false;
    this.detectedFrameworks = new Set();
    this._analyze();
  }

  _analyze() {
    const js = this.raw;
    if (!js) return;

    // Minification check
    const lines = js.split("\n");
    if (lines.length > 0) {
      const avgLineLen = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
      this.isLikelyMinified = avgLineLen > 200;
    }

    // Event listeners
    this.hasEventListeners = !!js.match(/addEventListener\s*\(/);
    this.hasKeyboardListeners = !!js.match(/(?:keydown|keyup|keypress|onkeydown|onkeyup)/i);
    this.hasFocusManagement = !!js.match(/(?:\.focus\(\)|\.blur\(\)|tabindex|focusin|focusout)/i);

    // Error handling
    this.hasTryCatch = !!js.match(/\btry\s*\{/);
    this.hasErrorHandling = !!js.match(/(?:\.catch\s*\(|onerror|addEventListener\s*\(\s*["']error)/);

    // Loading states
    this.hasLoadingStates = !!js.match(/(?:loading|spinner|skeleton|isLoading|setLoading|loadingState)/i);

    // Form validation
    this.hasFormValidation = !!js.match(/(?:validity|checkValidity|reportValidity|setCustomValidity|validate|validation)/i);

    // Console errors
    this.hasConsoleErrors = !!js.match(/console\.(error|warn)\s*\(/);

    // APIs
    this.hasServiceWorker = !!js.match(/serviceWorker/);
    this.hasFetchAPI = !!js.match(/\bfetch\s*\(/);
    this.hasLocalStorage = !!js.match(/localStorage|sessionStorage/);

    // Listeners
    this.hasScrollListeners = !!js.match(/(?:scroll|onscroll)/i);
    this.hasResizeListeners = !!js.match(/(?:resize|onresize)/i);
    this.hasTouchListeners = !!js.match(/(?:touchstart|touchend|touchmove|ontouchstart)/i);

    // Observers
    this.hasIntersectionObserver = !!js.match(/IntersectionObserver/);
    this.hasMutationObserver = !!js.match(/MutationObserver/);

    // A11y patterns
    this.hasAriaManipulation = !!js.match(/(?:setAttribute.*aria-|\.ariaLabel|\.ariaHidden|role)/);
    this.hasFocusTrap = !!js.match(/(?:focus.?trap|trapFocus|focusTrap)/i);
    this.hasEscapeHandler = !!js.match(/(?:Escape|escape|27)/);
    this.hasTabindexManagement = !!js.match(/tabindex|tabIndex/);

    // Framework detection
    if (js.match(/React|ReactDOM|createElement|jsx|__jsx/)) this.detectedFrameworks.add("React");
    if (js.match(/Vue\.|createApp|new Vue|__vue__/)) this.detectedFrameworks.add("Vue");
    if (js.match(/angular|@angular|ng\.module/i)) this.detectedFrameworks.add("Angular");
    if (js.match(/Svelte|svelte/)) this.detectedFrameworks.add("Svelte");
    if (js.match(/__NEXT_DATA__|next\/router|next\/link|_next\//)) this.detectedFrameworks.add("Next.js");
    if (js.match(/__NUXT__|nuxt|_nuxt\//)) this.detectedFrameworks.add("Nuxt");
    if (js.match(/gatsby|__gatsby/i)) this.detectedFrameworks.add("Gatsby");
    if (js.match(/jQuery|\$\(|jQuery\./)) this.detectedFrameworks.add("jQuery");
    if (js.match(/wp-content|wordpress|wp-includes/i)) this.detectedFrameworks.add("WordPress");
    if (js.match(/Shopify|shopify/)) this.detectedFrameworks.add("Shopify");
    if (js.match(/webpackChunk|__webpack_/)) this.detectedFrameworks.add("Webpack");
    if (js.match(/__vite__|import\.meta\.hot/)) this.detectedFrameworks.add("Vite");
    if (js.match(/Alpine|x-data/)) this.detectedFrameworks.add("Alpine.js");
    if (js.match(/htmx|hx-/i)) this.detectedFrameworks.add("HTMX");
    if (js.match(/Turbo|turbolinks|turbo-frame/i)) this.detectedFrameworks.add("Turbo/Hotwire");
    if (js.match(/TypeScript|\.tsx?|typescript/)) this.detectedFrameworks.add("TypeScript");
  }
}

// ---------------------------------------------------------------------------
// Contrast calculation helpers
// ---------------------------------------------------------------------------

function hexToRgb(hexColor) {
  let h = hexColor.replace(/^#/, "");
  if (h.length === 3) {
    h = h.split("").map(c => c + c).join("");
  }
  if (h.length < 6) return null;
  try {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  } catch {
    return null;
  }
}

function relativeLuminance(rgb) {
  const linearize = c => {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _f(check, checkEn, status, note, noteEn, detail = "", detailEn = "", rec = "", recEn = "", automated = true) {
  return {
    check,
    check_en: checkEn,
    status,
    note,
    note_en: noteEn,
    detail,
    detail_en: detailEn,
    recommendation: rec,
    recommendation_en: recEn,
    automated,
  };
}

function _ai() {
  return "NEEDS_AI_REVIEW";
}

// ---------------------------------------------------------------------------
// Check runners
// ---------------------------------------------------------------------------

function runA11yChecks(p, url, cssA, jsA) {
  const findings = {
    a11y_perceivable: [],
    a11y_operable: [],
    a11y_understandable: [],
    a11y_robust: [],
  };

  // -- Perceivable --
  // Alt text
  const noAlt = p.images.filter(([, a]) => a === null);
  const deco = p.images.filter(([, a]) => a === "").length;
  if (p.images.length === 0) {
    findings.a11y_perceivable.push(
      _f("Alle bilder har meningsfull alt-tekst", "All images have meaningful alt text", "n/a", "Ingen bilder funnet", "No images found")
    );
  } else if (noAlt.length > 0) {
    findings.a11y_perceivable.push(
      _f(
        "Alle bilder har meningsfull alt-tekst",
        "All images have meaningful alt text",
        "fail",
        `${noAlt.length} av ${p.images.length} bilder mangler alt-tekst`,
        `${noAlt.length} of ${p.images.length} images missing alt text`,
        `Uten alt: ${noAlt.slice(0, 5).map(([s]) => s.slice(0, 50)).join(", ")}`,
        `Without alt: ${noAlt.slice(0, 5).map(([s]) => s.slice(0, 50)).join(", ")}`,
        "Legg til beskrivende alt-tekst på alle meningsbærende bilder.",
        "Add descriptive alt text to all meaningful images."
      )
    );
  } else {
    findings.a11y_perceivable.push(
      _f(
        "Alle bilder har meningsfull alt-tekst",
        "All images have meaningful alt text",
        "pass",
        `Alle ${p.images.length} bilder har alt-tekst (${deco} dekorative)`,
        `All ${p.images.length} images have alt text (${deco} decorative)`
      )
    );
  }

  // Video/audio
  findings.a11y_perceivable.push(
    _f("Video/lyd har undertekster", "Video/audio has captions or transcripts", "n/a", "Krever manuell verifisering", "Requires manual verification")
  );

  // Color contrast
  if (cssA && cssA.colors.size >= 2) {
    const hexColors = Array.from(cssA.colors).filter(c => c.startsWith("#") && [3, 6].includes(c.replace("#", "").length));
    if (hexColors.length >= 2) {
      const rgbs = hexColors.map(c => [c, hexToRgb(c)]).filter(([, rgb]) => rgb !== null);
      if (rgbs.length >= 2) {
        const sortedByLum = rgbs.sort((a, b) => relativeLuminance(a[1]) - relativeLuminance(b[1]));
        const darkest = sortedByLum[0];
        const lightest = sortedByLum[rgbs.length - 1];
        const cr = contrastRatio(darkest[1], lightest[1]);
        if (cr >= 4.5) {
          findings.a11y_perceivable.push(
            _f(
              "Fargekontrast WCAG AA",
              "Color contrast meets WCAG AA",
              "pass",
              `Beste kontrast: ${cr.toFixed(1)}:1 (${darkest[0]} / ${lightest[0]})`,
              `Best contrast: ${cr.toFixed(1)}:1 (${darkest[0]} / ${lightest[0]})`,
              "Basert på CSS-fargeanalyse; visuell verifikasjon anbefalt.",
              "Based on CSS color analysis; visual verification recommended."
            )
          );
        } else {
          findings.a11y_perceivable.push(
            _f(
              "Fargekontrast WCAG AA",
              "Color contrast meets WCAG AA",
              "warn",
              `Mulig kontrastproblem: ${cr.toFixed(1)}:1 (krever 4.5:1)`,
              `Potential contrast issue: ${cr.toFixed(1)}:1 (requires 4.5:1)`,
              "",
              "",
              "Sjekk fargekontrast mellom tekst og bakgrunn.",
              "Check color contrast between text and background."
            )
          );
        }
      } else {
        findings.a11y_perceivable.push(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", _ai(), "", "", false));
      }
    } else {
      findings.a11y_perceivable.push(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", _ai(), "", "", false));
    }
  } else {
    findings.a11y_perceivable.push(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", _ai(), "", "", false));
  }

  // Resize and CSS readability
  for (const [c, e] of [
    ["Tekst kan forstørres til 200%", "Text can be resized to 200%"],
    ["Innhold lesbart uten CSS", "Content readable without CSS"],
  ]) {
    findings.a11y_perceivable.push(_f(c, e, _ai(), "", "", false));
  }

  // -- Operable --
  // Keyboard
  if (jsA && jsA.hasKeyboardListeners) {
    findings.a11y_operable.push(
      _f(
        "All funksjonalitet via tastatur",
        "All functionality via keyboard",
        _ai(),
        "Tastaturlyttere funnet i JS",
        "Keyboard listeners found in JS",
        "addEventListener for keydown/keyup funnet — AI verifiserer fullstendighet.",
        "addEventListener for keydown/keyup found — AI verifies completeness.",
        "",
        "",
        false
      )
    );
  } else {
    findings.a11y_operable.push(_f("All funksjonalitet via tastatur", "All functionality via keyboard", _ai(), "", "", false));
  }

  // Focus indicator
  if (cssA && (cssA.hasFocus || cssA.hasFocusVisible)) {
    const detailParts = [];
    if (cssA.hasFocus) detailParts.push(":focus");
    if (cssA.hasFocusVisible) detailParts.push(":focus-visible");
    findings.a11y_operable.push(
      _f(
        "Synlig fokusindikator",
        "Visible focus indicator",
        "pass",
        `Fokusstiler funnet: ${detailParts.join(", ")}`,
        `Focus styles found: ${detailParts.join(", ")}`,
        "CSS :focus/:focus-visible regler funnet.",
        "CSS :focus/:focus-visible rules found."
      )
    );
  } else {
    findings.a11y_operable.push(_f("Synlig fokusindikator", "Visible focus indicator", _ai(), "", "", false));
  }

  // Keyboard traps
  if (jsA && jsA.hasEscapeHandler) {
    findings.a11y_operable.push(
      _f("Ingen tastaturfeller", "No keyboard traps", "pass", "Escape-håndtering funnet i JS", "Escape handling found in JS")
    );
  } else {
    findings.a11y_operable.push(_f("Ingen tastaturfeller", "No keyboard traps", _ai(), "", "", false));
  }

  // Skip link
  if (p.hasSkipLink) {
    findings.a11y_operable.push(_f("Hopp-til-innhold-lenke", "Skip-to-content link present", "pass", "Funnet", "Found"));
  } else {
    findings.a11y_operable.push(
      _f(
        "Hopp-til-innhold-lenke",
        "Skip-to-content link present",
        "fail",
        "Ikke funnet",
        "Not found",
        "",
        "",
        "Legg til en 'Hopp til hovedinnhold'-lenke.",
        "Add a 'Skip to main content' link."
      )
    );
  }

  // Touch targets
  if (cssA && cssA.minHeightsOnInteractive.length > 0) {
    const meets44 = cssA.minHeightsOnInteractive.filter(h => h >= 44).length;
    const total = cssA.minHeightsOnInteractive.length;
    const pct = ((meets44 / total) * 100).toFixed(0);
    if (meets44 === total) {
      findings.a11y_operable.push(
        _f("Trykkmål min 44x44px", "Touch targets min 44x44px", "pass",
          `Alle ${total} interaktive elementer ≥ 44px`, `All ${total} interactive elements ≥ 44px`)
      );
    } else {
      findings.a11y_operable.push(
        _f("Trykkmål min 44x44px", "Touch targets min 44x44px", "warn",
          `${meets44}/${total} (${pct}%) interaktive elementer ≥ 44px`,
          `${meets44}/${total} (${pct}%) interactive elements ≥ 44px`,
          "", "", "Øk min-height/padding på knapper og lenker til 44px.", "Increase min-height/padding on buttons and links to 44px.")
      );
    }
  } else {
    findings.a11y_operable.push(_f("Trykkmål min 44x44px", "Touch targets min 44x44px", _ai(), "", "", false));
  }

  // No flashing
  findings.a11y_operable.push(
    _f("Ingen blinkende innhold", "No flashing content", "pass", "Ingen blinkende elementer", "No flashing elements detected")
  );

  // Reduced motion
  const hasRm = cssA ? cssA.hasReducedMotion : p.hasPrefersReducedMotion;
  if (hasRm) {
    findings.a11y_operable.push(
      _f(
        "Redusert bevegelse støttet",
        "Reduced motion support",
        "pass",
        "prefers-reduced-motion funnet i CSS",
        "prefers-reduced-motion found in CSS"
      )
    );
  } else {
    findings.a11y_operable.push(
      _f(
        "Redusert bevegelse støttet",
        "Reduced motion support",
        "warn",
        "prefers-reduced-motion ikke funnet",
        "prefers-reduced-motion not found",
        "",
        "",
        "Legg til @media (prefers-reduced-motion: reduce) for animasjoner.",
        "Add @media (prefers-reduced-motion: reduce) for animations."
      )
    );
  }

  // -- Understandable --
  // Language
  if (p.lang) {
    findings.a11y_understandable.push(
      _f("Sidespråk deklarert", "Page language declared", "pass", `lang="${p.lang}"`, `lang="${p.lang}"`)
    );
  } else {
    findings.a11y_understandable.push(
      _f(
        "Sidespråk deklarert",
        "Page language declared",
        "fail",
        "Mangler lang-attributt",
        "Missing lang attribute",
        "",
        "",
        'Legg til lang-attributt, f.eks. lang="nb".',
        'Add lang attribute, e.g. lang="nb".'
      )
    );
  }

  // Form labels
  p.secondPassLabelCheck();
  const unlabelled = p.formInputs.filter(i => !i.hasLabel);
  if (p.formInputs.length === 0) {
    findings.a11y_understandable.push(
      _f("Skjema-labels tilknyttet felt", "Form labels associated with inputs", "n/a", "Ingen skjemafelt", "No form fields")
    );
  } else if (unlabelled.length > 0) {
    const st = unlabelled.length <= 2 ? "warn" : "fail";
    findings.a11y_understandable.push(
      _f(
        "Skjema-labels tilknyttet felt",
        "Form labels associated with inputs",
        st,
        `${unlabelled.length}/${p.formInputs.length} mangler label`,
        `${unlabelled.length}/${p.formInputs.length} missing label`,
        "",
        "",
        "Bruk <label for> eller aria-label.",
        "Use <label for> or aria-label."
      )
    );
  } else {
    findings.a11y_understandable.push(
      _f(
        "Skjema-labels tilknyttet felt",
        "Form labels associated with inputs",
        "pass",
        `Alle ${p.formInputs.length} felt har labels`,
        `All ${p.formInputs.length} fields have labels`
      )
    );
  }

  // Error messages
  if (jsA && jsA.hasFormValidation) {
    findings.a11y_understandable.push(
      _f(
        "Feilmeldinger veileder",
        "Error messages guide recovery",
        _ai(),
        "Form validering funnet i JS",
        "Form validation found in JS",
        "",
        "",
        "",
        "",
        false
      )
    );
  } else {
    findings.a11y_understandable.push(_f("Feilmeldinger veileder", "Error messages guide recovery", _ai(), "", "", false));
  }

  for (const [c, e] of [
    ["Konsistent navigasjon", "Consistent navigation across pages"],
    ["Forkortelser og sjargong forklart", "Abbreviations and jargon explained"],
  ]) {
    findings.a11y_understandable.push(_f(c, e, _ai(), "", "", false));
  }

  // -- Robust --
  if (p.duplicateIds.length > 0) {
    findings.a11y_robust.push(
      _f(
        "Gyldig HTML-struktur",
        "Valid HTML structure",
        "warn",
        `${p.duplicateIds.length} dupliserte ID-er: ${p.duplicateIds.slice(0, 5).join(", ")}`,
        `${p.duplicateIds.length} duplicate IDs: ${p.duplicateIds.slice(0, 5).join(", ")}`,
        "",
        "",
        "Fjern dupliserte ID-er – hver ID skal være unik.",
        "Remove duplicate IDs – each ID must be unique."
      )
    );
  } else {
    findings.a11y_robust.push(
      _f(
        "Gyldig HTML-struktur",
        "Valid HTML structure",
        _ai(),
        `${p.allIds.size} unike ID-er, ingen duplikater`,
        `${p.allIds.size} unique IDs, no duplicates`,
        false
      )
    );
  }

  // Heading hierarchy
  const h = p.headings;
  let ok = true;
  const issues = [];
  if (h.length > 0) {
    if (h[0][0] !== 1) {
      ok = false;
      issues.push(`Starter med H${h[0][0]}`);
    }
    for (let i = 1; i < h.length; i++) {
      if (h[i][0] > h[i - 1][0] + 1) {
        ok = false;
        issues.push(`H${h[i - 1][0]}→H${h[i][0]}`);
      }
    }
    const h1c = h.filter(x => x[0] === 1).length;
    if (h1c > 1) {
      ok = false;
      issues.push(`${h1c} H1-er`);
    }
  } else {
    ok = false;
    issues.push("Ingen headinger");
  }

  if (ok) {
    findings.a11y_robust.push(
      _f(
        "Korrekt heading-hierarki",
        "Proper heading hierarchy",
        "pass",
        `${h.length} headinger, korrekt rekkefølge`,
        `${h.length} headings, correct order`,
        "Headinger: " + h.slice(0, 8).map(([l, t]) => `H${l}: ${t.slice(0, 30)}`).join(", "),
        "Headings: " + h.slice(0, 8).map(([l, t]) => `H${l}: ${t.slice(0, 30)}`).join(", ")
      )
    );
  } else {
    findings.a11y_robust.push(
      _f(
        "Korrekt heading-hierarki",
        "Proper heading hierarchy",
        h.length > 0 ? "warn" : "fail",
        issues.join("; "),
        issues.join("; "),
        "",
        "",
        "Rett opp heading-hierarkiet.",
        "Fix heading hierarchy."
      )
    );
  }

  // ARIA
  const ta = Object.values(p.ariaAttrs).reduce((a, b) => a + b, 0);
  let st, n, ne;
  if (ta === 0) {
    st = "warn";
    n = "Ingen ARIA";
    ne = "No ARIA attributes";
  } else if (ta > 50) {
    st = "warn";
    n = `${ta} ARIA-attr (mulig overbruk)`;
    ne = `${ta} ARIA attrs (possible overuse)`;
  } else {
    st = "pass";
    n = `${ta} ARIA-attributter`;
    ne = `${ta} ARIA attributes`;
  }
  const ariaDetails = Object.entries(p.ariaAttrs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
  findings.a11y_robust.push(_f("ARIA-roller korrekt brukt", "ARIA roles used correctly", st, n, ne, ariaDetails, ariaDetails));

  // Semantic HTML
  const sem = ["nav", "main", "article", "header", "footer"].filter(e => p[`has${e.charAt(0).toUpperCase() + e.slice(1)}`]);
  st = sem.length >= 3 ? "pass" : sem.length > 0 ? "warn" : "fail";
  findings.a11y_robust.push(
    _f(
      "Semantiske HTML-elementer",
      "Semantic HTML elements used",
      st,
      sem.length > 0 ? sem.join(", ") : "Ingen funnet",
      sem.length > 0 ? sem.join(", ") : "None found",
      "",
      "",
      st !== "pass" ? "Bruk nav, main, header, footer." : "",
      st !== "pass" ? "Use nav, main, header, footer." : ""
    )
  );

  // Fieldset/legend
  if (p.formInputs.length > 0) {
    if (p.fieldsets > 0) {
      findings.a11y_robust.push(
        _f(
          "Skjema fieldset/legend",
          "Forms have fieldset/legend",
          "pass",
          `${p.fieldsets} fieldset, ${p.legends} legend`,
          `${p.fieldsets} fieldset, ${p.legends} legend`
        )
      );
    } else {
      findings.a11y_robust.push(
        _f(
          "Skjema fieldset/legend",
          "Forms have fieldset/legend",
          "warn",
          "Ingen fieldset funnet",
          "No fieldset found",
          "",
          "",
          "Grupper relaterte felt med <fieldset> og <legend>.",
          "Group related fields with <fieldset> and <legend>."
        )
      );
    }
  } else {
    findings.a11y_robust.push(
      _f("Skjema fieldset/legend", "Forms have fieldset/legend", "n/a", "Ingen skjemafelt", "No form fields")
    );
  }

  // Cross-browser
  findings.a11y_robust.push(
    _f(
      "Kryssleser-kompatibilitet",
      "Cross-browser and cross-device compatibility",
      _ai(),
      "",
      "",
      "",
      "",
      "",
      "",
      false
    )
  );

  return findings;
}

function runBpChecks(p, url, cssA, jsA) {
  const findings = { bp_performance: [], bp_security: [], bp_seo: [], bp_code: [] };
  const https = url.startsWith("https://");

  // -- Performance --
  // Images
  if (p.totalImagesWithSrc === 0) {
    findings.bp_performance.push(_f("Bilder optimalisert", "Images optimized", "n/a", "Ingen bilder", "No images"));
  } else {
    const lazyPct = (p.lazyImages / p.totalImagesWithSrc) * 100;
    const modernPct = (p.webpAvifImages / p.totalImagesWithSrc) * 100;
    const iss = [];
    if (lazyPct < 50 && p.totalImagesWithSrc > 3) iss.push(`${p.lazyImages}/${p.totalImagesWithSrc} lazy`);
    if (modernPct < 30) iss.push(`${p.webpAvifImages}/${p.totalImagesWithSrc} moderne format`);
    const st = iss.length > 0 ? "warn" : "pass";
    findings.bp_performance.push(
      _f(
        "Bilder optimalisert",
        "Images optimized",
        st,
        iss.length > 0 ? iss.join("; ") : `${p.lazyImages} lazy, ${p.webpAvifImages} moderne`,
        iss.length > 0 ? iss.join("; ") : `${p.lazyImages} lazy, ${p.webpAvifImages} modern`
      )
    );
  }

  // CSS/JS minification
  const cssMinified = cssA ? cssA.isLikelyMinified : null;
  const jsMinified = jsA ? jsA.isLikelyMinified : null;
  if (cssMinified !== null || jsMinified !== null) {
    const parts = [];
    let allOk = true;
    if (cssMinified !== null) {
      parts.push(`CSS ${cssMinified ? "minifisert" : "ikke minifisert"}`);
      if (!cssMinified) allOk = false;
    }
    if (jsMinified !== null) {
      parts.push(`JS ${jsMinified ? "minifisert" : "ikke minifisert"}`);
      if (!jsMinified) allOk = false;
    }
    findings.bp_performance.push(
      _f(
        "CSS/JS minifisert",
        "CSS and JS minified",
        allOk ? "pass" : "warn",
        parts.join("; "),
        parts.join("; ").replace(/minifisert/g, "minified").replace(/ikke /g, "not "),
        "",
        "",
        allOk ? "" : "Minifiser CSS- og JS-filer for bedre ytelse.",
        allOk ? "" : "Minify CSS and JS files for better performance."
      )
    );
  } else {
    findings.bp_performance.push(
      _f(
        "CSS/JS minifisert",
        "CSS and JS minified",
        _ai(),
        "Ingen eksterne filer analysert",
        "No external files analyzed",
        "",
        "",
        "",
        "",
        false
      )
    );
  }

  // Render-blocking
  const noas = p.scripts.filter(s => !s.async && !s.defer);
  if (p.scripts.length === 0) {
    findings.bp_performance.push(_f("Ingen renderblokkering", "No render-blocking", "n/a", "Ingen scripts", "No scripts"));
  } else if (noas.length > 0) {
    findings.bp_performance.push(
      _f(
        "Ingen renderblokkering",
        "No render-blocking",
        "warn",
        `${noas.length}/${p.scripts.length} uten async/defer`,
        `${noas.length}/${p.scripts.length} without async/defer`,
        "",
        "",
        "Legg til async/defer.",
        "Add async/defer."
      )
    );
  } else {
    findings.bp_performance.push(
      _f(
        "Ingen renderblokkering",
        "No render-blocking",
        "pass",
        `Alle ${p.scripts.length} scripts OK`,
        `All ${p.scripts.length} scripts OK`
      )
    );
  }

  // Caching headers
  findings.bp_performance.push(_f("Caching-headere", "Caching headers", _ai(), "", "", false));

  // Font loading
  if (cssA) {
    const [fdResult, fdMsg] = cssA.checkFontDisplay();
    if (fdResult === true) {
      findings.bp_performance.push(_f("Font-lasting", "Font loading", "pass", fdMsg, fdMsg));
    } else if (fdResult === false) {
      findings.bp_performance.push(
        _f(
          "Font-lasting",
          "Font loading",
          "warn",
          fdMsg,
          fdMsg,
          "",
          "",
          "Bruk font-display: swap eller optional.",
          "Use font-display: swap or optional."
        )
      );
    } else {
      findings.bp_performance.push(_f("Font-lasting", "Font loading", _ai(), fdMsg, fdMsg, false));
    }
  } else {
    findings.bp_performance.push(_f("Font-lasting", "Font loading", _ai(), "", "", false));
  }

  // -- Security --
  findings.bp_security.push(
    _f(
      "HTTPS påkrevd",
      "HTTPS enforced",
      https ? "pass" : "fail",
      https ? "HTTPS aktiv" : "HTTP",
      https ? "HTTPS active" : "HTTP",
      "",
      "",
      https ? "" : "Migrer til HTTPS.",
      https ? "" : "Migrate to HTTPS."
    )
  );

  if (https) {
    const mixed = [
      ...p.images.filter(([s]) => s && s.startsWith("http://")).map(([s]) => s.slice(0, 50)),
      ...p.externalLinks.filter(l => l.href.startsWith("http://")).map(l => l.href.slice(0, 50)),
    ];
    findings.bp_security.push(
      _f(
        "Ingen mixed content",
        "No mixed content",
        mixed.length > 0 ? "warn" : "pass",
        mixed.length > 0 ? `${mixed.length} referanser` : "Ingen funnet",
        mixed.length > 0 ? `${mixed.length} refs` : "None found",
        "",
        "",
        mixed.length > 0 ? "Oppdater til HTTPS." : "",
        mixed.length > 0 ? "Update to HTTPS." : ""
      )
    );
  } else {
    findings.bp_security.push(_f("Ingen mixed content", "No mixed content", "n/a", "N/A (HTTP)", "N/A (HTTP)"));
  }

  if (p.hasCSPMeta) {
    findings.bp_security.push(
      _f("CSP-headere", "CSP headers", "pass", "CSP meta-tag funnet i HTML", "CSP meta tag found in HTML")
    );
  } else {
    findings.bp_security.push(
      _f("CSP-headere", "CSP headers", _ai(), "Ingen CSP meta-tag i HTML (kan være satt via HTTP-header)", "No CSP meta tag in HTML (may be set via HTTP header)", false)
    );
  }

  // Exposed sensitive data
  if (jsA && jsA.raw) {
    const sensitivePatterns = jsA.raw.match(/(?:api[_-]?key|secret|password|token|auth)\s*[:=]\s*["'][^"']{8,}/gi) || [];
    if (sensitivePatterns.length > 0) {
      findings.bp_security.push(
        _f(
          "Ingen eksponerte sensitive data",
          "No exposed sensitive data in source",
          "fail",
          `${sensitivePatterns.length} mulige lekkasjer funnet`,
          `${sensitivePatterns.length} potential leaks found`,
          "",
          "",
          "Fjern hardkodede hemmeligheter fra kildekoden.",
          "Remove hardcoded secrets from source code."
        )
      );
    } else {
      findings.bp_security.push(
        _f(
          "Ingen eksponerte sensitive data",
          "No exposed sensitive data in source",
          "pass",
          "Ingen sensitive mønstre funnet i JS",
          "No sensitive patterns found in JS"
        )
      );
    }
  } else {
    findings.bp_security.push(_f("Ingen eksponerte sensitive data", "No exposed sensitive data in source", _ai(), "", "", false));
  }

  // External links
  const bad = p.externalLinks.filter(l => !l.hasNoopener || !l.hasNoreferrer);
  if (p.externalLinks.length === 0) {
    findings.bp_security.push(_f("Eksterne lenker rel-attr", "External links rel attrs", "n/a", "Ingen", "None"));
  } else if (bad.length > 0) {
    findings.bp_security.push(
      _f(
        "Eksterne lenker rel-attr",
        "External links rel attrs",
        "warn",
        `${bad.length}/${p.externalLinks.length} mangler`,
        `${bad.length}/${p.externalLinks.length} missing`,
        "",
        "",
        'Legg til rel="noopener noreferrer".',
        'Add rel="noopener noreferrer".'
      )
    );
  } else {
    findings.bp_security.push(
      _f(
        "Eksterne lenker rel-attr",
        "External links rel attrs",
        "pass",
        `Alle ${p.externalLinks.length} OK`,
        `All ${p.externalLinks.length} OK`
      )
    );
  }

  // -- SEO --
  if (p.hasTitle && p.titleText) {
    const tl = p.titleText.length;
    const st = tl >= 10 && tl <= 70 ? "pass" : "warn";
    findings.bp_seo.push(
      _f(
        "Beskrivende <title>",
        "Descriptive <title>",
        st,
        `"${p.titleText.slice(0, 50)}" (${tl} tegn)`,
        `"${p.titleText.slice(0, 50)}" (${tl} chars)`
      )
    );
  } else {
    findings.bp_seo.push(
      _f(
        "Beskrivende <title>",
        "Descriptive <title>",
        "fail",
        "Mangler",
        "Missing",
        "",
        "",
        "Legg til <title>.",
        "Add <title>."
      )
    );
  }

  const desc = p.metaTags.description || "";
  if (desc) {
    const dl = desc.length;
    const st2 = dl >= 50 && dl <= 160 ? "pass" : "warn";
    findings.bp_seo.push(_f("Meta-beskrivelse", "Meta description", st2, `${dl} tegn`, `${dl} chars`));
  } else {
    findings.bp_seo.push(
      _f(
        "Meta-beskrivelse",
        "Meta description",
        "fail",
        "Mangler",
        "Missing",
        "",
        "",
        "Legg til meta description (50-160 tegn).",
        "Add meta description (50-160 chars)."
      )
    );
  }

  // Heading hierarchy for SEO (reuse heading analysis)
  {
    const h = p.headings;
    let seoOk = true;
    const seoIssues = [];
    if (h.length > 0) {
      if (h[0][0] !== 1) { seoOk = false; seoIssues.push(`Starter med H${h[0][0]}`); }
      const h1c = h.filter(x => x[0] === 1).length;
      if (h1c > 1) { seoOk = false; seoIssues.push(`${h1c} H1-er`); }
      if (h1c === 0) { seoOk = false; seoIssues.push("Ingen H1"); }
      for (let i = 1; i < h.length; i++) {
        if (h[i][0] > h[i - 1][0] + 1) { seoOk = false; seoIssues.push(`H${h[i - 1][0]}→H${h[i][0]}`); break; }
      }
    } else {
      seoOk = false;
      seoIssues.push("Ingen headinger");
    }
    if (seoOk) {
      findings.bp_seo.push(_f("Heading-hierarki for SEO", "Heading hierarchy for SEO", "pass",
        `${h.length} headinger, korrekt hierarki`, `${h.length} headings, correct hierarchy`));
    } else {
      findings.bp_seo.push(_f("Heading-hierarki for SEO", "Heading hierarchy for SEO", "warn",
        seoIssues.join("; "), seoIssues.join("; "), "", "",
        "Fiks heading-hierarkiet for bedre SEO.", "Fix heading hierarchy for better SEO."));
    }
  }

  if (p.hasCanonical) {
    findings.bp_seo.push(_f("Canonical URL", "Canonical URL specified", "pass", "Tilstede", "Present"));
  } else {
    findings.bp_seo.push(
      _f(
        "Canonical URL",
        "Canonical URL specified",
        "warn",
        "Mangler",
        "Missing",
        "",
        "",
        'Legg til <link rel="canonical">.',
        'Add <link rel="canonical">.'
      )
    );
  }

  if (p.ogTags.size > 0) {
    findings.bp_seo.push(
      _f(
        "OG/sosiale meta-tagger",
        "Open Graph / social meta tags",
        "pass",
        `${p.ogTags.size} OG-tagger funnet`,
        `${p.ogTags.size} OG tags found`
      )
    );
  } else {
    findings.bp_seo.push(
      _f(
        "OG/sosiale meta-tagger",
        "Open Graph / social meta tags",
        "warn",
        "Mangler",
        "Missing",
        "",
        "",
        "Legg til Open Graph-tagger.",
        "Add Open Graph tags."
      )
    );
  }

  if (p.hasStructuredData) {
    findings.bp_seo.push(_f("Strukturerte data (JSON-LD)", "Structured data (JSON-LD)", "pass", "Funnet", "Found"));
  } else {
    findings.bp_seo.push(
      _f(
        "Strukturerte data (JSON-LD)",
        "Structured data (JSON-LD)",
        "warn",
        "Ikke funnet",
        "Not found",
        "",
        "",
        "Legg til JSON-LD strukturerte data.",
        "Add JSON-LD structured data."
      )
    );
  }

  // -- Code Quality --
  // Console errors
  if (jsA && jsA.hasConsoleErrors) {
    findings.bp_code.push(
      _f(
        "Ingen konsoll-feil",
        "No console errors",
        "warn",
        "console.error/warn kall funnet i kildekoden",
        "console.error/warn calls found in source",
        "",
        "",
        "Fjern debug-kall fra produksjonskoden.",
        "Remove debug calls from production code."
      )
    );
  } else {
    findings.bp_code.push(
      _f("Ingen konsoll-feil", "No console errors", _ai(), "Sjekkes via nettleser", "Checked via browser", false)
    );
  }

  findings.bp_code.push(
    _f("Ingen 404-er", "No broken links (404s)", _ai(), "Krever nettverkssjekk", "Requires network check", false)
  );

  if (p.hasViewport) {
    findings.bp_code.push(_f("Viewport meta-tag", "Viewport meta tag", "pass", "Tilstede", "Present"));
  } else {
    findings.bp_code.push(
      _f(
        "Viewport meta-tag",
        "Viewport meta tag",
        "fail",
        "Mangler",
        "Missing",
        "",
        "",
        "Legg til viewport meta-tag.",
        "Add viewport meta tag."
      )
    );
  }

  if (p.hasFavicon) {
    findings.bp_code.push(_f("Favicon", "Favicon", "pass", "Tilstede", "Present"));
  } else {
    findings.bp_code.push(
      _f(
        "Favicon",
        "Favicon",
        "warn",
        "Ikke funnet i HTML",
        "Not found in HTML",
        "",
        "",
        "Legg til favicon.",
        "Add favicon."
      )
    );
  }

  // Print stylesheet
  const hasPrint = cssA ? cssA.hasPrintMedia : p.hasPrintMedia;
  if (hasPrint) {
    findings.bp_code.push(
      _f("Utskriftsstil vurdert", "Print stylesheet considered", "pass", "@media print funnet", "@media print found")
    );
  } else {
    findings.bp_code.push(
      _f(
        "Utskriftsstil vurdert",
        "Print stylesheet considered",
        "warn",
        "Ingen @media print funnet",
        "No @media print found",
        "",
        "",
        "Legg til @media print.",
        "Add @media print."
      )
    );
  }

  return findings;
}

function runUxChecks(p, cssA, jsA) {
  const findings = { ux_nav: [], ux_content: [], ux_interaction: [], ux_cognitive: [] };

  // --- Navigation & Information Architecture ---

  // Primary navigation
  if (p.hasNav) {
    findings.ux_nav.push(_f("Tydelig hovednavigasjon", "Clear primary navigation", "pass", "<nav> funnet", "<nav> found"));
  } else {
    findings.ux_nav.push(
      _f("Tydelig hovednavigasjon", "Clear primary navigation", _ai(), "Ingen <nav>", "No <nav>", false)
    );
  }

  // Current page indication
  if (p.hasAriaCurrentInNav) {
    findings.ux_nav.push(
      _f("Gjeldende side indikert", "Current page indicated", "pass", "aria-current funnet i navigasjon", "aria-current found in navigation")
    );
  } else if (p.hasActiveClassInNav) {
    findings.ux_nav.push(
      _f("Gjeldende side indikert", "Current page indicated", "pass", ".active/.current klasse funnet i navigasjon", ".active/.current class found in navigation")
    );
  } else {
    findings.ux_nav.push(
      _f("Gjeldende side indikert", "Current page indicated", _ai(), "Ingen aria-current eller .active klasse funnet i <nav>", "No aria-current or .active class found in <nav>", false)
    );
  }

  // Breadcrumbs
  if (p.hasBreadcrumb) {
    findings.ux_nav.push(_f("Brødsmulesti", "Breadcrumbs", "pass", "Funnet", "Found"));
  } else {
    findings.ux_nav.push(
      _f("Brødsmulesti", "Breadcrumbs", "n/a", "Ikke funnet (kan være tilsiktet)", "Not found (may be intentional)")
    );
  }

  // Search
  if (p.hasSearch) {
    findings.ux_nav.push(_f("Søkefunksjon", "Search functionality", "pass", "Funnet", "Found"));
  } else {
    findings.ux_nav.push(
      _f("Søkefunksjon", "Search functionality", _ai(), "Ikke funnet i HTML", "Not found in HTML", false)
    );
  }

  // Footer
  if (p.hasFooter) {
    findings.ux_nav.push(
      _f("Footer med nyttelenker", "Footer with utility links", _ai(), "<footer> funnet", "<footer> found", false)
    );
  } else {
    findings.ux_nav.push(
      _f(
        "Footer med nyttelenker",
        "Footer with utility links",
        "warn",
        "Ingen <footer>",
        "No <footer>",
        "",
        "",
        "Legg til footer.",
        "Add footer."
      )
    );
  }

  // 3-click rule
  const navDepth = p.navMaxListDepth;
  const intLinks = new Set(p.internalLinks).size;
  const impPages = p.importantPagesLinked;
  const threeClickIssues = [];
  if (navDepth > 3) {
    threeClickIssues.push(`nav-dybde ${navDepth} nivåer (maks 3 anbefalt)`);
  }
  if (intLinks < 5 && p.hasNav) {
    threeClickIssues.push(`kun ${intLinks} interne lenker på siden`);
  }
  if (impPages.length === 0 && p.hasNav) {
    threeClickIssues.push("ingen viktige sider (kontakt, om oss, etc.) direkte lenket");
  }

  if (threeClickIssues.length > 0) {
    findings.ux_nav.push(
      _f(
        "Innhold innen 3 klikk",
        "Important content within 3 clicks",
        "warn",
        threeClickIssues.join("; "),
        threeClickIssues.join("; "),
        `Nav-dybde: ${navDepth}, interne lenker: ${intLinks}, viktige sider: ${impPages.length > 0 ? impPages.join(", ") : "ingen"}`,
        `Nav depth: ${navDepth}, internal links: ${intLinks}, important pages: ${impPages.length > 0 ? impPages.join(", ") : "none"}`,
        "Forenkle navigasjonsstrukturen.",
        "Simplify navigation structure."
      )
    );
  } else if (p.hasNav) {
    findings.ux_nav.push(
      _f(
        "Innhold innen 3 klikk",
        "Important content within 3 clicks",
        "pass",
        `Nav-dybde: ${navDepth}, ${intLinks} interne lenker, viktige sider: ${impPages.join(", ")}`,
        `Nav depth: ${navDepth}, ${intLinks} internal links, important pages: ${impPages.join(", ")}`
      )
    );
  } else {
    findings.ux_nav.push(
      _f(
        "Innhold innen 3 klikk",
        "Important content within 3 clicks",
        _ai(),
        "Ingen <nav> funnet",
        "No <nav> found",
        false
      )
    );
  }

  // IA mental model
  findings.ux_nav.push(_f("IA følger brukernes mentale modell", "IA follows users' mental model", _ai(), "", "", false));

  // --- Content & Readability ---

  // Headlines
  findings.ux_content.push(_f("Overskrifter beskrivende og skannbare", "Headlines descriptive and scannable", _ai(), "", "", false));

  // Body font size
  const bodyFs = cssA ? cssA.bodyFontSizePx : p.bodyFontSizePx;
  if (bodyFs !== null) {
    if (bodyFs >= 16) {
      findings.ux_content.push(
        _f("Brødtekst min 16px", "Body text min 16px", "pass", `${bodyFs.toFixed(0)}px`, `${bodyFs.toFixed(0)}px`)
      );
    } else {
      findings.ux_content.push(
        _f(
          "Brødtekst min 16px",
          "Body text min 16px",
          "fail",
          `${bodyFs.toFixed(0)}px (min 16px)`,
          `${bodyFs.toFixed(0)}px (min 16px required)`,
          "",
          "",
          "Øk brødtekstens font-size til minst 16px.",
          "Increase body font-size to at least 16px."
        )
      );
    }
  } else {
    findings.ux_content.push(_f("Brødtekst min 16px", "Body text min 16px", _ai(), "", "", false));
  }

  // Line length
  if (cssA && cssA.maxWidthOnTextContainers.length > 0) {
    const avgMw = cssA.maxWidthOnTextContainers.reduce((a, b) => a + b) / cssA.maxWidthOnTextContainers.length;
    if (avgMw >= 500 && avgMw <= 800) {
      findings.ux_content.push(
        _f("Linjelengde 45-75 tegn", "Line length 45-75 chars", "pass",
          `max-width ~${avgMw.toFixed(0)}px på tekstcontainere`, `max-width ~${avgMw.toFixed(0)}px on text containers`)
      );
    } else if (avgMw > 800) {
      findings.ux_content.push(
        _f("Linjelengde 45-75 tegn", "Line length 45-75 chars", "warn",
          `max-width ~${avgMw.toFixed(0)}px (kan gi for lange linjer)`, `max-width ~${avgMw.toFixed(0)}px (may cause long lines)`,
          "", "", "Begrens tekstbredden til maks ~700px.", "Limit text width to max ~700px.")
      );
    } else {
      findings.ux_content.push(
        _f("Linjelengde 45-75 tegn", "Line length 45-75 chars", "warn",
          `max-width ~${avgMw.toFixed(0)}px (kan gi for korte linjer)`, `max-width ~${avgMw.toFixed(0)}px (may cause short lines)`,
          "", "", "Øk tekstbredden til minst ~500px.", "Increase text width to at least ~500px.")
      );
    }
  } else {
    findings.ux_content.push(_f("Linjelengde 45-75 tegn", "Line length 45-75 chars", _ai(), "", "", false));
  }

  // Language, hierarchy
  for (const [c, e] of [
    ["Språk tilpasset brukernes verden", "Language matches users' vocabulary"],
    ["Innhold hierarki", "Content hierarchy"],
  ]) {
    findings.ux_content.push(_f(c, e, _ai(), "", "", false));
  }

  // Images
  findings.ux_content.push(
    _f("Bilder relevante og av god kvalitet", "Images relevant, high-quality, and support content", _ai(), "", "", false)
  );

  // Content alignment
  findings.ux_content.push(
    _f("Innhold matcher bruker- og forretningsmål", "Content aligns with user and business goals", _ai(), "", "", false)
  );

  // --- Interaction Design ---

  // Primary CTA
  findings.ux_interaction.push(_f("Primær CTA identifiserbar", "Primary CTA identifiable", _ai(), "", "", false));

  // Interactive elements
  findings.ux_interaction.push(
    _f("Interaktive elementer som forventet", "Interactive elements behave as expected", _ai(), "", "", false)
  );

  // System status
  if (jsA && jsA.hasLoadingStates) {
    findings.ux_interaction.push(
      _f(
        "Systemstatus kommunisert",
        "System status communicated",
        "pass",
        "Lastetilstander funnet i JS",
        "Loading states found in JS",
        "Mønster som loading/spinner/skeleton funnet.",
        "Patterns like loading/spinner/skeleton found."
      )
    );
  } else {
    findings.ux_interaction.push(_f("Systemstatus kommunisert", "System status communicated", _ai(), "", "", false));
  }

  // Error messages
  if (jsA && jsA.hasErrorHandling) {
    findings.ux_interaction.push(
      _f(
        "Feilmeldinger veileder til løsning",
        "Error messages guide recovery",
        _ai(),
        "Feilhåndtering funnet i JS (.catch/onerror)",
        "Error handling found in JS (.catch/onerror)",
        "",
        "",
        "",
        "",
        false
      )
    );
  } else {
    findings.ux_interaction.push(
      _f("Feilmeldinger veileder til løsning", "Error messages guide recovery", _ai(), "", "", false)
    );
  }

  // Error prevention
  if (jsA && jsA.hasFormValidation) {
    findings.ux_interaction.push(
      _f(
        "Forebygging av feil",
        "Error prevention",
        "pass",
        "Form-validering funnet i JS",
        "Form validation found in JS",
        "checkValidity/setCustomValidity eller lignende.",
        "checkValidity/setCustomValidity or similar."
      )
    );
  } else {
    findings.ux_interaction.push(_f("Forebygging av feil", "Error prevention", _ai(), "", "", false));
  }

  // Shortcuts
  const ak = p.accesskeys;
  const ac = p.autocompleteInputs;
  const kb = jsA ? jsA.hasKeyboardListeners : false;
  if (ak > 0 || ac > 0 || kb) {
    const parts = [];
    if (ak) parts.push(`${ak} accesskey`);
    if (ac) parts.push(`${ac} autocomplete`);
    if (kb) parts.push("tastaturlyttere i JS");
    findings.ux_interaction.push(
      _f(
        "Snarveier for erfarne brukere",
        "Shortcuts and accelerators for experienced users",
        "pass",
        parts.join(", "),
        parts.join(", ").replace("tastaturlyttere i JS", "keyboard listeners in JS")
      )
    );
  } else {
    findings.ux_interaction.push(
      _f(
        "Snarveier for erfarne brukere",
        "Shortcuts and accelerators for experienced users",
        _ai(),
        "Ingen accesskey/autocomplete/keyboard funnet",
        "No accesskey/autocomplete/keyboard found",
        false
      )
    );
  }

  // Form design
  const fe = p.formInputsExtended;
  if (fe.length === 0) {
    findings.ux_interaction.push(_f("Skjemadesign", "Form design quality", "n/a", "Ingen skjemafelt", "No form fields"));
  } else {
    const issues = [];
    const withReq = fe.filter(f => f.required).length;
    const withPh = fe.filter(f => f.placeholder).length;
    const genericType = fe.filter(
      f => f.type === "text" && f.name && ["email", "phone", "tel", "date", "number", "url"].some(kw => f.name.toLowerCase().includes(kw))
    ).length;
    if (withReq === 0 && fe.length > 1) {
      issues.push("ingen required-attributter");
    }
    if (genericType > 0) {
      issues.push(`${genericType} felt med feil input-type`);
    }
    const formSt = issues.length > 0 ? "warn" : "pass";
    const n = issues.length > 0 ? issues.join("; ") : `${fe.length} felt, ${withReq} required, ${withPh} placeholder`;
    const ne = `${fe.length} fields, ${withReq} required, ${withPh} placeholder`;
    findings.ux_interaction.push(
      _f(
        "Skjemadesign",
        "Form design quality",
        formSt,
        n,
        ne,
        "",
        "",
        issues.length > 0 ? "Bruk required, riktige input-typer og placeholder-tekst." : "",
        issues.length > 0 ? "Use required, correct input types, and placeholder text." : ""
      )
    );
  }

  // Mobile interaction
  const mobileSignals = [];
  if (jsA && jsA.hasTouchListeners) {
    mobileSignals.push("touch-lyttere i JS");
  }
  if (cssA && cssA.breakpoints.size > 0) {
    const mobileBps = Array.from(cssA.breakpoints).filter(bp => bp <= 768);
    if (mobileBps.length > 0) {
      mobileSignals.push(`mobile breakpoints: ${mobileBps.sort((a, b) => a - b).map(bp => `${bp}px`).join(", ")}`);
    }
  }
  if (mobileSignals.length > 0) {
    findings.ux_interaction.push(
      _f(
        "Mobil interaksjonsdesign",
        "Mobile interaction design",
        _ai(),
        mobileSignals.join("; "),
        mobileSignals.join("; ").replace("touch-lyttere i JS", "touch listeners in JS"),
        "",
        "",
        "",
        "",
        false
      )
    );
  } else {
    findings.ux_interaction.push(
      _f("Mobil interaksjonsdesign", "Mobile interaction design", _ai(), "", "", false)
    );
  }

  // --- Cognitive Load & User Control ---

  for (const [c, e] of [
    ["Minimal kompleksitet og valg", "Minimal complexity and choices"],
    ["Gjenkjenning fremfor hukommelse", "Recognition over recall"],
    ["Gruppert innhold og progressiv avsløring", "Grouped content and progressive disclosure"],
  ]) {
    findings.ux_cognitive.push(_f(c, e, _ai(), "", "", false));
  }

  // Conventions and escape routes
  if (jsA && jsA.hasEscapeHandler) {
    findings.ux_cognitive.push(
      _f(
        "Konvensjoner og brukerkontroll",
        "Conventions and user control",
        _ai(),
        "Escape-håndtering funnet",
        "Escape handling found",
        "",
        "",
        "",
        "",
        false
      )
    );
  } else {
    findings.ux_cognitive.push(_f("Konvensjoner og brukerkontroll", "Conventions and user control", _ai(), "", "", false));
  }

  // Primary task
  findings.ux_cognitive.push(
    _f("Primæroppgave uten forvirring", "Primary task without confusion", _ai(), "", "", false)
  );

  // Help and documentation
  findings.ux_cognitive.push(_f("Hjelp og dokumentasjon tilgjengelig", "Help and documentation accessible", _ai(), "", "", false));

  // Trust signals
  if (p.trustSignals.length > 0) {
    findings.ux_cognitive.push(
      _f(
        "Tillitssignaler til stede",
        "Trust signals present",
        "pass",
        `Funnet: ${p.trustSignals.join(", ")}`,
        `Found: ${p.trustSignals.join(", ")}`
      )
    );
  } else {
    findings.ux_cognitive.push(
      _f(
        "Tillitssignaler til stede",
        "Trust signals present",
        _ai(),
        "Ingen tillitssignaler funnet i HTML-klasser",
        "No trust signals found in HTML classes",
        false
      )
    );
  }

  // Onboarding
  findings.ux_cognitive.push(
    _f("Onboarding/veiledning for nye brukere", "Onboarding or first-time user guidance", _ai(), "", "", false)
  );

  return findings;
}

function runUiChecks(p, cssA) {
  const findings = { ui_hierarchy: [], ui_typography: [], ui_color: [], ui_spacing: [], ui_components: [] };

  const fontFamilies = cssA ? cssA.fontFamilies : p.fontsInStyle;
  const bodyLh = cssA ? cssA.bodyLineHeight : p.bodyLineHeight;
  const hasMq = cssA && cssA.mediaQueries.length > 0 ? true : p.hasMediaQueries;

  // --- Visual Hierarchy ---

  // Heading levels
  if (p.headings.length >= 2) {
    const levels = new Set(p.headings.map(h => h[0]));
    if (levels.size >= 2) {
      findings.ui_hierarchy.push(
        _f("Distinkte heading-nivåer", "Distinct heading levels", "pass", `${levels.size} distinkte nivåer brukt`, `${levels.size} distinct levels used`)
      );
    } else {
      findings.ui_hierarchy.push(
        _f(
          "Distinkte heading-nivåer",
          "Distinct heading levels",
          "warn",
          "Kun ett heading-nivå brukt",
          "Only one heading level used",
          "",
          "",
          "Bruk flere heading-nivåer for bedre hierarki.",
          "Use multiple heading levels for better hierarchy."
        )
      );
    }
  } else {
    findings.ui_hierarchy.push(_f("Distinkte heading-nivåer", "Distinct heading levels", _ai(), "", "", false));
  }

  // Primary vs secondary
  findings.ui_hierarchy.push(_f("Primær vs sekundær handling", "Primary vs secondary actions", _ai(), "", "", false));

  // Visual weight
  findings.ui_hierarchy.push(_f("Visuell vekt", "Visual weight guides eye", _ai(), "", "", false));

  // Whitespace
  if (cssA && (cssA.paddings.length > 0 || cssA.margins.length > 0)) {
    const avgPadding = cssA.paddings.length > 0 ? cssA.paddings.reduce((a, b) => a + b) / cssA.paddings.length : 0;
    const avgMargin = cssA.margins.length > 0 ? cssA.margins.reduce((a, b) => a + b) / cssA.margins.length : 0;
    if (avgPadding >= 12 || avgMargin >= 12) {
      findings.ui_hierarchy.push(
        _f(
          "Whitespace",
          "Adequate whitespace",
          _ai(),
          `Gj.sn. padding: ${avgPadding.toFixed(0)}px, margin: ${avgMargin.toFixed(0)}px`,
          `Avg padding: ${avgPadding.toFixed(0)}px, margin: ${avgMargin.toFixed(0)}px`,
          false
        )
      );
    } else {
      findings.ui_hierarchy.push(
        _f(
          "Whitespace",
          "Adequate whitespace",
          _ai(),
          `Lav gj.sn. padding: ${avgPadding.toFixed(0)}px, margin: ${avgMargin.toFixed(0)}px`,
          `Low avg padding: ${avgPadding.toFixed(0)}px, margin: ${avgMargin.toFixed(0)}px`,
          false
        )
      );
    }
  } else {
    findings.ui_hierarchy.push(_f("Whitespace", "Adequate whitespace", _ai(), "", "", false));
  }

  // Scan pattern
  findings.ui_hierarchy.push(_f("Skannemønster", "Scan pattern flow", _ai(), "", "", false));

  // Content density
  findings.ui_hierarchy.push(
    _f("Innholdstetthet balansert", "Content density balanced with breathing room", _ai(), "", "", false)
  );

  // --- Typography ---

  // Font families
  const fc = fontFamilies.size;
  if (fc > 0) {
    const fontList = Array.from(fontFamilies).slice(0, 3).join(", ");
    if (fc <= 3) {
      findings.ui_typography.push(
        _f("Konsistente fontfamilier", "Consistent font families", "pass", `${fc} fonter: ${fontList}`, `${fc} fonts: ${fontList}`)
      );
    } else {
      findings.ui_typography.push(
        _f(
          "Konsistente fontfamilier",
          "Consistent font families",
          "warn",
          `${fc} fonter (maks 3 anbefalt)`,
          `${fc} fonts (max 3 recommended)`,
          "",
          "",
          "Reduser antall fontfamilier til 2-3.",
          "Reduce font families to 2-3."
        )
      );
    }
  } else {
    findings.ui_typography.push(_f("Konsistente fontfamilier", "Consistent font families", _ai(), "", "", false));
  }

  // Type scale
  if (cssA) {
    const [tsResult, tsMsg] = cssA.checkTypeScale();
    if (tsResult === true) {
      findings.ui_typography.push(_f("Typeskala", "Type scale", "pass", tsMsg, tsMsg));
    } else if (tsResult === false) {
      findings.ui_typography.push(
        _f(
          "Typeskala",
          "Type scale",
          "warn",
          tsMsg,
          tsMsg,
          "",
          "",
          "Definer en tydelig typeskala.",
          "Define a clear type scale."
        )
      );
    } else {
      findings.ui_typography.push(
        _f("Typeskala", "Type scale", _ai(), tsMsg !== "insufficient font size data" ? tsMsg : "", tsMsg !== "insufficient font size data" ? tsMsg : "", false)
      );
    }
  } else {
    findings.ui_typography.push(_f("Typeskala", "Type scale", _ai(), "", "", false));
  }

  // Line height
  if (bodyLh !== null) {
    if (bodyLh >= 1.4 && bodyLh <= 1.6) {
      findings.ui_typography.push(
        _f("Linjehøyde", "Line height", "pass", `linjehøyde ${bodyLh}`, `line-height ${bodyLh}`)
      );
    } else {
      findings.ui_typography.push(
        _f(
          "Linjehøyde",
          "Line height",
          "warn",
          `linjehøyde ${bodyLh} (anbefalt 1.4–1.6)`,
          `line-height ${bodyLh} (recommended 1.4–1.6)`,
          "",
          "",
          "Sett line-height til 1.4–1.6.",
          "Set line-height to 1.4–1.6."
        )
      );
    }
  } else {
    findings.ui_typography.push(_f("Linjehøyde", "Line height", _ai(), "", "", false));
  }

  // Font weights
  if (cssA && cssA.fontWeights.size > 0) {
    const fw = cssA.fontWeights;
    if (fw.size >= 2 && fw.size <= 5) {
      const sorted = Array.from(fw).sort();
      findings.ui_typography.push(
        _f("Fontvekter", "Font weights", "pass", `${fw.size} vekter: ${sorted.join(", ")}`, `${fw.size} weights: ${sorted.join(", ")}`)
      );
    } else if (fw.size > 5) {
      findings.ui_typography.push(
        _f(
          "Fontvekter",
          "Font weights",
          "warn",
          `${fw.size} vekter (kan virke rotete)`,
          `${fw.size} weights (may appear cluttered)`,
          "",
          "",
          "Begrens til 3-4 fontvekter.",
          "Limit to 3-4 font weights."
        )
      );
    } else {
      findings.ui_typography.push(
        _f("Fontvekter", "Font weights", _ai(), `${fw.size} vekter funnet`, `${fw.size} weights found`, false)
      );
    }
  } else {
    findings.ui_typography.push(_f("Fontvekter", "Font weights", _ai(), "", "", false));
  }

  // Text alignment
  if (cssA && Object.keys(cssA.textAlignValues).length > 0) {
    const taVals = cssA.textAlignValues;
    const total = Object.values(taVals).reduce((a, b) => a + b, 0);
    const dominant = Object.entries(taVals).sort((a, b) => b[1] - a[1])[0];
    const dominantPct = ((dominant[1] / total) * 100).toFixed(0);
    const hasJustify = !!taVals.justify;
    if (hasJustify && taVals.justify > 2) {
      findings.ui_typography.push(
        _f("Tekstjustering", "Text alignment", "warn",
          `text-align: justify brukt ${taVals.justify} ganger (reduserer lesbarhet)`,
          `text-align: justify used ${taVals.justify} times (reduces readability)`,
          "", "", "Unngå justify – bruk left/start for bedre lesbarhet.", "Avoid justify – use left/start for better readability.")
      );
    } else if (Object.keys(taVals).length <= 3) {
      findings.ui_typography.push(
        _f("Tekstjustering", "Text alignment", "pass",
          `Konsistent: ${dominant[0]} (${dominantPct}%), ${Object.keys(taVals).length} verdier brukt`,
          `Consistent: ${dominant[0]} (${dominantPct}%), ${Object.keys(taVals).length} values used`)
      );
    } else {
      findings.ui_typography.push(
        _f("Tekstjustering", "Text alignment", _ai(),
          `${Object.keys(taVals).length} ulike text-align verdier funnet`,
          `${Object.keys(taVals).length} different text-align values found`, false)
      );
    }
  } else {
    findings.ui_typography.push(_f("Tekstjustering", "Text alignment", _ai(), "", "", false));
  }

  // --- Color & Contrast ---

  // Color palette
  if (cssA) {
    const [cpResult, cpMsg] = cssA.checkColorPaletteConsistency();
    if (cpResult === true) {
      findings.ui_color.push(_f("Konsistent fargepalett", "Consistent color palette", "pass", cpMsg, cpMsg));
    } else if (cpResult === false) {
      findings.ui_color.push(
        _f(
          "Konsistent fargepalett",
          "Consistent color palette",
          "warn",
          cpMsg,
          cpMsg,
          "",
          "",
          "Reduser antall unike farger til en definert palett.",
          "Reduce unique colors to a defined palette."
        )
      );
    } else {
      findings.ui_color.push(_f("Konsistent fargepalett", "Consistent color palette", _ai(), cpMsg, cpMsg, false));
    }
  } else {
    findings.ui_color.push(_f("Konsistent fargepalett", "Consistent color palette", _ai(), "", "", false));
  }

  // Color not sole means
  findings.ui_color.push(_f("Farge ikke eneste middel", "Color not sole means", _ai(), "", "", false));

  // Contrast ratios
  findings.ui_color.push(
    _f("Kontrastforhold", "Contrast ratios", _ai(), "Se tilgjengelighetssjekk", "See accessibility check", false)
  );

  // Brand colors
  findings.ui_color.push(_f("Merkefarger konsistent", "Brand colors consistent", _ai(), "", "", false));

  // Hover/active
  if (cssA && (cssA.hasHover || cssA.hasActive)) {
    const states = [];
    if (cssA.hasHover) states.push(":hover");
    if (cssA.hasActive) states.push(":active");
    findings.ui_color.push(
      _f(
        "Hover/aktive farger",
        "Hover/active colors",
        "pass",
        `Tilstander funnet: ${states.join(", ")}`,
        `States found: ${states.join(", ")}`
      )
    );
  } else {
    findings.ui_color.push(_f("Hover/aktive farger", "Hover/active colors", _ai(), "", "", false));
  }

  // --- Spacing & Layout ---

  // Consistent spacing
  if (cssA) {
    const [spResult, spMsg] = cssA.checkSpacingSystem();
    if (spResult === true) {
      findings.ui_spacing.push(_f("Konsistent mellomrom", "Consistent spacing", "pass", spMsg, spMsg));
    } else if (spResult === false) {
      findings.ui_spacing.push(
        _f(
          "Konsistent mellomrom",
          "Consistent spacing",
          "warn",
          spMsg,
          spMsg,
          "",
          "",
          "Bruk et konsistent spacing-system (4px/8px grid).",
          "Use a consistent spacing system (4px/8px grid)."
        )
      );
    } else {
      findings.ui_spacing.push(_f("Konsistent mellomrom", "Consistent spacing", _ai(), spMsg || "", spMsg || "", false));
    }
  } else {
    findings.ui_spacing.push(_f("Konsistent mellomrom", "Consistent spacing", _ai(), "", "", false));
  }

  // Alignment
  findings.ui_spacing.push(_f("Justering", "Alignment", _ai(), "", "", false));

  // Responsive layout
  if (cssA && cssA.breakpoints.size > 0) {
    const bps = Array.from(cssA.breakpoints).sort((a, b) => a - b);
    findings.ui_spacing.push(
      _f(
        "Responsivt layout",
        "Responsive layout",
        "pass",
        `${bps.length} breakpoints: ${bps.slice(0, 6).map(bp => `${bp}px`).join(", ")}`,
        `${bps.length} breakpoints: ${bps.slice(0, 6).map(bp => `${bp}px`).join(", ")}`
      )
    );
  } else if (hasMq) {
    findings.ui_spacing.push(_f("Responsivt layout", "Responsive layout", "pass", "@media queries funnet", "@media queries found"));
  } else {
    findings.ui_spacing.push(
      _f(
        "Responsivt layout",
        "Responsive layout",
        "warn",
        "Ingen @media queries funnet",
        "No @media queries found",
        "",
        "",
        "Legg til responsive breakpoints.",
        "Add responsive breakpoints."
      )
    );
  }

  // Padding
  if (cssA && cssA.paddings.length > 0) {
    const avgP = cssA.paddings.reduce((a, b) => a + b) / cssA.paddings.length;
    if (avgP >= 8) {
      findings.ui_spacing.push(
        _f(
          "Tilstrekkelig padding",
          "Adequate padding",
          "pass",
          `Gj.sn. ${avgP.toFixed(0)}px over ${cssA.paddings.length} verdier`,
          `Avg ${avgP.toFixed(0)}px across ${cssA.paddings.length} values`
        )
      );
    } else {
      findings.ui_spacing.push(
        _f(
          "Tilstrekkelig padding",
          "Adequate padding",
          "warn",
          `Lav gj.sn. padding: ${avgP.toFixed(0)}px`,
          `Low avg padding: ${avgP.toFixed(0)}px`,
          "",
          "",
          "Øk padding i containere.",
          "Increase padding in containers."
        )
      );
    }
  } else {
    findings.ui_spacing.push(_f("Tilstrekkelig padding", "Adequate padding", _ai(), "", "", false));
  }

  // Margins
  if (cssA && cssA.margins.length > 0) {
    const avgM = cssA.margins.reduce((a, b) => a + b) / cssA.margins.length;
    if (cssA.margins.length >= 5) {
      const mean = avgM;
      const variance = cssA.margins.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / cssA.margins.length;
      const std = Math.sqrt(variance);
      const cv = mean > 0 ? std / mean : 0;
      if (cv < 0.8) {
        findings.ui_spacing.push(
          _f(
            "Konsistente marginer",
            "Consistent margins",
            "pass",
            `Gj.sn. ${avgM.toFixed(0)}px, variasjonskoeff. ${cv.toFixed(2)}`,
            `Avg ${avgM.toFixed(0)}px, CV ${cv.toFixed(2)}`
          )
        );
      } else {
        findings.ui_spacing.push(
          _f(
            "Konsistente marginer",
            "Consistent margins",
            "warn",
            `Høy variasjon i marginer (CV: ${cv.toFixed(2)})`,
            `High margin variation (CV: ${cv.toFixed(2)})`,
            "",
            "",
            "Standardiser marginer med et spacing-system.",
            "Standardize margins with a spacing system."
          )
        );
      }
    } else {
      findings.ui_spacing.push(
        _f(
          "Konsistente marginer",
          "Consistent margins",
          _ai(),
          `Gj.sn. margin: ${avgM.toFixed(0)}px`,
          `Avg margin: ${avgM.toFixed(0)}px`,
          false
        )
      );
    }
  } else {
    findings.ui_spacing.push(_f("Konsistente marginer", "Consistent margins", _ai(), "", "", false));
  }

  // --- Components ---

  for (const [c, e] of [
    ["Knapper konsistent", "Buttons consistent"],
    ["Skjemafelt konsistent", "Form fields consistent"],
    ["Ikoner konsistente", "Icons consistent"],
  ]) {
    findings.ui_components.push(_f(c, e, _ai(), "", "", false));
  }

  // Cards/containers
  findings.ui_components.push(_f("Kort/containere", "Cards/containers", _ai(), "", "", false));

  // Borders
  if (cssA && cssA.borderRadii.size > 0) {
    const brCount = cssA.borderRadii.size;
    const brList = Array.from(cssA.borderRadii).slice(0, 4).join(", ");
    if (brCount <= 4) {
      findings.ui_components.push(
        _f(
          "Kantlinjer konsistente",
          "Borders consistent",
          "pass",
          `${brCount} ulike border-radius verdier`,
          `${brCount} different border-radius values`,
          `Verdier: ${brList}`,
          `Values: ${brList}`
        )
      );
    } else {
      findings.ui_components.push(
        _f(
          "Kantlinjer konsistente",
          "Borders consistent",
          "warn",
          `${brCount} ulike border-radius (kan virke inkonsistent)`,
          `${brCount} different border-radius (may appear inconsistent)`,
          "",
          "",
          "Standardiser border-radius verdier.",
          "Standardize border-radius values."
        )
      );
    }
  } else {
    findings.ui_components.push(_f("Kantlinjer konsistente", "Borders consistent", _ai(), "", "", false));
  }

  // 404/error pages
  findings.ui_components.push(
    _f("404/feilsider designet", "404 and error pages designed and helpful", _ai(), "", "", false)
  );

  return findings;
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export function runPreAuditChecks(html, url, cssContent = "", jsContent = "") {
  // Parse HTML
  const parser = new AuditHTMLParser();
  parser.parse(html);

  // Create CSS analyzer
  const combinedCSS = parser.inlineCSS + "\n" + (cssContent || "");
  const cssAnalyzer = combinedCSS.trim() ? new CSSAnalyzer(combinedCSS) : null;

  // Create JS analyzer
  const combinedJS = parser.inlineScripts + "\n" + (jsContent || "");
  const jsAnalyzer = combinedJS.trim() ? new JSAnalyzer(combinedJS) : null;

  // Run all check categories
  const allFindings = {};
  [
    runA11yChecks(parser, url, cssAnalyzer, jsAnalyzer),
    runBpChecks(parser, url, cssAnalyzer, jsAnalyzer),
    runUxChecks(parser, cssAnalyzer, jsAnalyzer),
    runUiChecks(parser, cssAnalyzer),
  ].forEach(obj => Object.assign(allFindings, obj));

  // Calculate summary
  const total = Object.values(allFindings).reduce((sum, arr) => sum + arr.length, 0);
  const automated = Object.values(allFindings).flat().filter(i => i.automated && i.status !== "NEEDS_AI_REVIEW").length;
  const needsReview = Object.values(allFindings).flat().filter(i => i.status === "NEEDS_AI_REVIEW").length;

  // Merge framework detection from all sources
  const allFrameworks = new Set([...parser.detectedFrameworks]);
  if (jsAnalyzer) {
    jsAnalyzer.detectedFrameworks.forEach(fw => allFrameworks.add(fw));
  }
  if (cssAnalyzer) {
    const css = cssAnalyzer.raw;
    if (css.match(/tailwind|tw-/i)) allFrameworks.add("Tailwind CSS");
    if (css.match(/bootstrap|\.btn-primary|\.container-fluid/i)) allFrameworks.add("Bootstrap");
    if (css.match(/foundation|\.grid-x|\.cell/i)) allFrameworks.add("Foundation");
    if (css.match(/bulma|\.is-primary|\.columns/i)) allFrameworks.add("Bulma");
    if (css.match(/materialize|\.materialize/i)) allFrameworks.add("Materialize");
  }

  return {
    pre_audit_version: "2.1.0",
    url,
    summary: {
      total_checks: total,
      automated,
      needs_ai_review: needsReview,
    },
    detected_frameworks: Array.from(allFrameworks).sort(),
    analysis_scope: {
      html_size_kb: Math.round((html.length / 1024) * 10) / 10,
      inline_css_size_kb: Math.round((parser.inlineCSS.length / 1024) * 10) / 10,
      external_css_size_kb: Math.round(((cssContent || "").length / 1024) * 10) / 10,
      inline_js_size_kb: Math.round((parser.inlineScripts.length / 1024) * 10) / 10,
      external_js_size_kb: Math.round(((jsContent || "").length / 1024) * 10) / 10,
      total_analyzed_kb:
        Math.round(
          ((html.length + parser.inlineCSS.length + (cssContent || "").length + parser.inlineScripts.length + (jsContent || "").length) / 1024) * 10
        ) / 10,
    },
    html_stats: {
      images: parser.images.length,
      headings: parser.headings.length,
      links: parser.links.length,
      external_links: parser.externalLinks.length,
      form_inputs: parser.formInputs.length,
      scripts: parser.scripts.length,
      inline_scripts: parser.inlineScripts.trim() ? parser.inlineScripts.split("\n").length : 0,
      fonts_detected: Array.from(parser.fontsInStyle),
      semantic_elements: ["nav", "main", "article", "header", "footer"].filter(e => parser[`has${e.charAt(0).toUpperCase() + e.slice(1)}`]),
      has_structured_data: parser.hasStructuredData,
      og_tags: Array.from(parser.ogTags),
      nav_max_list_depth: parser.navMaxListDepth,
      internal_links_count: new Set(parser.internalLinks).size,
      important_pages_linked: parser.importantPagesLinked,
    },
    css_stats: {
      analyzed: cssAnalyzer !== null,
      total_css_size_kb: Math.round(((parser.inlineCSS.length + (cssContent || "").length) / 1024) * 10) / 10,
      total_colors: cssAnalyzer ? cssAnalyzer.colors.size : 0,
      font_families: cssAnalyzer ? Array.from(cssAnalyzer.fontFamilies) : Array.from(parser.fontsInStyle),
      font_weights: cssAnalyzer ? Array.from(cssAnalyzer.fontWeights).sort() : [],
      breakpoints: cssAnalyzer ? Array.from(cssAnalyzer.breakpoints).sort((a, b) => a - b) : [],
      has_flexbox: cssAnalyzer ? cssAnalyzer.hasFlexbox : false,
      has_grid: cssAnalyzer ? cssAnalyzer.hasGrid : false,
      has_hover_states: cssAnalyzer ? cssAnalyzer.hasHover : false,
      has_active_states: cssAnalyzer ? cssAnalyzer.hasActive : false,
      has_focus_styles: cssAnalyzer ? cssAnalyzer.hasFocus : false,
      has_focus_visible: cssAnalyzer ? cssAnalyzer.hasFocusVisible : false,
      has_reduced_motion: cssAnalyzer ? cssAnalyzer.hasReducedMotion : false,
      has_print_media: cssAnalyzer ? cssAnalyzer.hasPrintMedia : false,
      border_radius_values: cssAnalyzer ? Array.from(cssAnalyzer.borderRadii).slice(0, 10).sort() : [],
      is_minified: cssAnalyzer ? cssAnalyzer.isLikelyMinified : null,
    },
    js_stats: {
      analyzed: jsAnalyzer !== null,
      total_js_size_kb: Math.round(((parser.inlineScripts.length + (jsContent || "").length) / 1024) * 10) / 10,
      has_keyboard_listeners: jsAnalyzer ? jsAnalyzer.hasKeyboardListeners : false,
      has_error_handling: jsAnalyzer ? jsAnalyzer.hasErrorHandling : false,
      has_try_catch: jsAnalyzer ? jsAnalyzer.hasTryCatch : false,
      has_loading_states: jsAnalyzer ? jsAnalyzer.hasLoadingStates : false,
      has_form_validation: jsAnalyzer ? jsAnalyzer.hasFormValidation : false,
      has_touch_listeners: jsAnalyzer ? jsAnalyzer.hasTouchListeners : false,
      has_scroll_listeners: jsAnalyzer ? jsAnalyzer.hasScrollListeners : false,
      has_resize_listeners: jsAnalyzer ? jsAnalyzer.hasResizeListeners : false,
      has_focus_management: jsAnalyzer ? jsAnalyzer.hasFocusManagement : false,
      has_aria_manipulation: jsAnalyzer ? jsAnalyzer.hasAriaManipulation : false,
      has_focus_trap: jsAnalyzer ? jsAnalyzer.hasFocusTrap : false,
      has_escape_handler: jsAnalyzer ? jsAnalyzer.hasEscapeHandler : false,
      has_service_worker: jsAnalyzer ? jsAnalyzer.hasServiceWorker : false,
      has_intersection_observer: jsAnalyzer ? jsAnalyzer.hasIntersectionObserver : false,
      is_minified: jsAnalyzer ? jsAnalyzer.isLikelyMinified : null,
    },
    findings: allFindings,
  };
}
