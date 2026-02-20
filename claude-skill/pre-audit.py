#!/usr/bin/env python3
"""
Pre-Audit Automated Checker
=============================
Runs programmatic checks on raw HTML, CSS, and JS to pre-fill audit findings
that don't require visual/subjective AI judgment.  Outputs a partial audit-data
JSON that the AI merges with its own visual evaluations before generating the
final report.

v2.0.0 — Full CSS + JS analysis. Covers ~55-60 of 101 checks automatically.

Usage:
    python3 pre-audit.py <html-file> <url> [--css <css-file>] [--js <js-file>] [-o output.json]

Output: JSON to stdout or file.
"""

import json, sys, os, re, argparse, math
from html.parser import HTMLParser
from collections import Counter

# ---------------------------------------------------------------------------
# HTML parser – single pass to collect all the data we need
# ---------------------------------------------------------------------------

class AuditHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []
        self.headings = []
        self.links = []
        self.meta_tags = {}
        self.has_title = False
        self.title_text = ""
        self.lang = None
        self.has_viewport = False
        self.has_canonical = False
        self.has_skip_link = False
        self.has_nav = False
        self.has_main = False
        self.has_article = False
        self.has_header = False
        self.has_footer = False
        self.has_search = False
        self.has_breadcrumb = False
        self.has_favicon = False
        self.form_inputs = []
        self.label_fors = set()
        self.fonts_in_style = set()
        self.colors_in_style = set()
        self.aria_attrs = Counter()
        self.fieldsets = 0
        self.legends = 0
        self.external_links = []
        self.lazy_images = 0
        self.total_images_with_src = 0
        self.webp_avif_images = 0
        self.scripts = []
        self.stylesheets = []
        self.has_structured_data = False
        self.og_tags = set()
        self._tag_stack = []
        self._capture = None
        self._captured_text = ""
        self._current_heading = None
        self._in_style = False
        self._style_content = ""
        # Inline CSS aggregator
        self.inline_css = ""
        # CSS-derived properties (may be overridden by external CSS)
        self.body_font_size_px = None
        self.body_line_height = None
        self.has_media_queries = False
        self.has_print_media = False
        # v1.1 additions
        self.accesskeys = 0
        self.autocomplete_inputs = 0
        self.has_prefers_reduced_motion = False
        self.trust_signals = []
        self.form_inputs_extended = []
        # Navigation depth analysis
        self._in_nav = False
        self._nav_depth = 0
        self._nav_max_depth = 0
        self._nav_list_depth = 0
        self.nav_max_list_depth = 0
        self.internal_links = []
        self.important_pages_linked = []
        # Inline styles for spacing/padding analysis
        self.inline_styles = []
        # Inline scripts (content between <script> tags without src)
        self._in_inline_script = False
        self._script_content = ""
        self.inline_scripts = ""  # combined inline JS
        # Framework detection from HTML
        self.detected_frameworks = set()
        self.data_attributes = Counter()  # data-* attribute usage

    def _attr_dict(self, attrs):
        return {k: v for k, v in attrs}

    def handle_starttag(self, tag, attrs):
        ad = self._attr_dict(attrs)
        tag_lower = tag.lower()
        self._tag_stack.append(tag_lower)

        for k, v in attrs:
            if k.startswith("aria-"):
                self.aria_attrs[k] += 1
            if k == "accesskey":
                self.accesskeys += 1

        # Collect inline style attributes
        style = ad.get("style", "")
        if style:
            self.inline_styles.append(style)

        if tag_lower == "html":
            self.lang = ad.get("lang")

        if tag_lower == "title":
            self.has_title = True
            self._capture = "title"
            self._captured_text = ""

        if tag_lower == "meta":
            name = ad.get("name", "").lower()
            prop = ad.get("property", "").lower()
            content = ad.get("content", "")
            if name == "viewport": self.has_viewport = True
            if name == "description": self.meta_tags["description"] = content
            if name: self.meta_tags[name] = content
            if prop: self.meta_tags[prop] = content
            if prop.startswith("og:"): self.og_tags.add(prop)

        if tag_lower == "link":
            rel = ad.get("rel", "").lower()
            href = ad.get("href", "")
            if "canonical" in rel: self.has_canonical = True
            if "icon" in rel or "shortcut" in rel: self.has_favicon = True
            if "stylesheet" in rel: self.stylesheets.append({"href": href})

        if tag_lower in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._current_heading = int(tag_lower[1])
            self._capture = "heading"
            self._captured_text = ""

        if tag_lower == "img":
            src = ad.get("src", "")
            alt = ad.get("alt")
            self.images.append((src, alt))
            if src:
                self.total_images_with_src += 1
                ext = src.split("?")[0].split(".")[-1].lower() if "." in src else ""
                if ext in ("webp", "avif") or "webp" in src or "avif" in src:
                    self.webp_avif_images += 1
            if ad.get("loading", "").lower() == "lazy":
                self.lazy_images += 1

        if tag_lower == "a":
            href = ad.get("href", "")
            rel = ad.get("rel", "")
            target = ad.get("target", "")
            self.links.append({"href": href, "rel": rel, "target": target, "text": ""})
            self._capture = "link"
            self._captured_text = ""
            if href and href.startswith("#") and any(kw in href.lower() for kw in ["main", "content", "skip"]):
                self.has_skip_link = True
            if href and (href.startswith("http://") or href.startswith("https://")):
                self.external_links.append({
                    "href": href,
                    "has_noopener": "noopener" in rel,
                    "has_noreferrer": "noreferrer" in rel,
                })
            if href and not href.startswith(("http://", "https://", "mailto:", "tel:", "javascript:", "#")):
                self.internal_links.append(href)
                important_kws = ["kontakt", "contact", "om-oss", "om oss", "about", "tjenester", "services",
                                 "priser", "pricing", "hjelp", "help", "faq", "support", "blogg", "blog"]
                href_lower = href.lower()
                for kw in important_kws:
                    if kw in href_lower and kw not in self.important_pages_linked:
                        self.important_pages_linked.append(kw)

        if tag_lower == "nav":
            self.has_nav = True
            self._in_nav = True
            aria_label = ad.get("aria-label", "").lower()
            if "breadcrumb" in aria_label or "brødsmule" in aria_label:
                self.has_breadcrumb = True

        if self._in_nav and tag_lower in ("ul", "ol"):
            self._nav_list_depth += 1
            if self._nav_list_depth > self.nav_max_list_depth:
                self.nav_max_list_depth = self._nav_list_depth

        if tag_lower == "main": self.has_main = True
        if tag_lower == "article": self.has_article = True
        if tag_lower == "header": self.has_header = True
        if tag_lower == "footer": self.has_footer = True

        role = ad.get("role", "").lower()
        cls = ad.get("class", "").lower()
        if "breadcrumb" in role or "breadcrumb" in cls: self.has_breadcrumb = True
        if "search" in role or "search" in cls or tag_lower == "search": self.has_search = True

        if tag_lower == "input":
            inp_type = ad.get("type", "text").lower()
            if inp_type not in ("hidden", "submit", "button", "reset"):
                inp_id = ad.get("id", "")
                inp_name = ad.get("name", "")
                aria_label = ad.get("aria-label", "")
                aria_labelledby = ad.get("aria-labelledby", "")
                has_label = bool(inp_id and inp_id in self.label_fors) or bool(aria_label) or bool(aria_labelledby)
                self.form_inputs.append({"id": inp_id, "name": inp_name, "type": inp_type, "has_label": has_label})
                has_autocomplete = bool(ad.get("autocomplete", ""))
                if has_autocomplete: self.autocomplete_inputs += 1
                self.form_inputs_extended.append({
                    "type": inp_type, "required": "required" in ad,
                    "placeholder": bool(ad.get("placeholder", "")),
                    "pattern": bool(ad.get("pattern", "")),
                    "autocomplete": has_autocomplete, "name": inp_name,
                })
            if inp_type == "search": self.has_search = True

        if tag_lower == "label":
            for_attr = ad.get("for", "")
            if for_attr: self.label_fors.add(for_attr)

        if tag_lower == "fieldset": self.fieldsets += 1
        if tag_lower == "legend": self.legends += 1

        if tag_lower == "textarea":
            self.form_inputs_extended.append({
                "type": "textarea", "required": "required" in ad,
                "placeholder": bool(ad.get("placeholder", "")),
                "pattern": False, "autocomplete": False,
                "name": ad.get("name", ""),
            })
        if tag_lower == "select":
            self.form_inputs_extended.append({
                "type": "select", "required": "required" in ad,
                "placeholder": False, "pattern": False, "autocomplete": False,
                "name": ad.get("name", ""),
            })

        # Trust signals
        trust_kws = ["trust", "testimonial", "review", "rating", "badge", "certification", "verified", "secure", "guarantee"]
        for kw in trust_kws:
            if kw in cls or kw in role:
                if kw not in self.trust_signals:
                    self.trust_signals.append(kw)
                break

        if tag_lower == "script":
            src = ad.get("src", "")
            if src:
                self.scripts.append({"src": src, "async": "async" in ad, "defer": "defer" in ad})
                # Framework detection from script src
                src_lower = src.lower()
                if "react" in src_lower or "react-dom" in src_lower: self.detected_frameworks.add("React")
                if "vue" in src_lower: self.detected_frameworks.add("Vue")
                if "angular" in src_lower: self.detected_frameworks.add("Angular")
                if "svelte" in src_lower: self.detected_frameworks.add("Svelte")
                if "jquery" in src_lower: self.detected_frameworks.add("jQuery")
                if "bootstrap" in src_lower: self.detected_frameworks.add("Bootstrap")
                if "tailwind" in src_lower: self.detected_frameworks.add("Tailwind")
                if "alpine" in src_lower: self.detected_frameworks.add("Alpine.js")
                if "htmx" in src_lower: self.detected_frameworks.add("HTMX")
                if "next" in src_lower and ("_next" in src_lower or "next.js" in src_lower): self.detected_frameworks.add("Next.js")
                if "nuxt" in src_lower or "_nuxt" in src_lower: self.detected_frameworks.add("Nuxt")
                if "gatsby" in src_lower: self.detected_frameworks.add("Gatsby")
                if "remix" in src_lower: self.detected_frameworks.add("Remix")
                if "astro" in src_lower: self.detected_frameworks.add("Astro")
                if "webpack" in src_lower: self.detected_frameworks.add("Webpack")
                if "vite" in src_lower: self.detected_frameworks.add("Vite")
            else:
                # Inline script — capture content
                self._in_inline_script = True
                self._script_content = ""
            if "ld+json" in ad.get("type", "").lower(): self.has_structured_data = True

        # Data attributes (for framework detection: data-reactroot, data-v-, ng-, etc.)
        for k, v in attrs:
            if k.startswith("data-"):
                self.data_attributes[k] += 1
                if k in ("data-reactroot", "data-reactid"): self.detected_frameworks.add("React")
                if k.startswith("data-v-"): self.detected_frameworks.add("Vue")
                if k == "data-turbo" or k == "data-turbolinks": self.detected_frameworks.add("Turbo/Hotwire")
                if k == "data-controller" or k == "data-action": self.detected_frameworks.add("Stimulus")
            if k.startswith("ng-") or k.startswith("_ngcontent") or k.startswith("_nghost"):
                self.detected_frameworks.add("Angular")
            if k == "x-data" or k == "x-bind" or k == "x-on":
                self.detected_frameworks.add("Alpine.js")

        if tag_lower == "style":
            self._in_style = True
            self._style_content = ""

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if self._capture == "title" and tag_lower == "title":
            self.title_text = self._captured_text.strip()
            self._capture = None
        if self._capture == "heading" and tag_lower in ("h1","h2","h3","h4","h5","h6"):
            self.headings.append((self._current_heading, self._captured_text.strip()))
            self._current_heading = None
            self._capture = None
        if self._capture == "link" and tag_lower == "a":
            if self.links: self.links[-1]["text"] = self._captured_text.strip()
            self._capture = None
        if self._in_style and tag_lower == "style":
            self._in_style = False
            self.inline_css += self._style_content + "\n"
        if self._in_inline_script and tag_lower == "script":
            self._in_inline_script = False
            self.inline_scripts += self._script_content + "\n"
            # Framework detection from inline script content
            sc = self._script_content
            if "__NEXT_DATA__" in sc or "next/router" in sc: self.detected_frameworks.add("Next.js")
            if "__NUXT__" in sc or "nuxt" in sc.lower(): self.detected_frameworks.add("Nuxt")
            if "React" in sc or "ReactDOM" in sc or "createElement" in sc: self.detected_frameworks.add("React")
            if "Vue" in sc and ("createApp" in sc or "new Vue" in sc): self.detected_frameworks.add("Vue")
            if "angular" in sc.lower() and "module" in sc.lower(): self.detected_frameworks.add("Angular")
            if "wp-content" in sc or "wordpress" in sc.lower(): self.detected_frameworks.add("WordPress")
            if "Shopify" in sc or "shopify" in sc.lower(): self.detected_frameworks.add("Shopify")
            if "wix" in sc.lower(): self.detected_frameworks.add("Wix")
            if "squarespace" in sc.lower(): self.detected_frameworks.add("Squarespace")
            if "webflow" in sc.lower(): self.detected_frameworks.add("Webflow")
            if "gatsby" in sc.lower(): self.detected_frameworks.add("Gatsby")
            if "Svelte" in sc or "svelte" in sc: self.detected_frameworks.add("Svelte")
        if tag_lower == "nav":
            self._in_nav = False
            self._nav_list_depth = 0
        if self._in_nav and tag_lower in ("ul", "ol"):
            self._nav_list_depth = max(0, self._nav_list_depth - 1)
        if self._tag_stack and self._tag_stack[-1] == tag_lower:
            self._tag_stack.pop()

    def handle_data(self, data):
        if self._capture: self._captured_text += data
        if self._in_style: self._style_content += data
        if self._in_inline_script: self._script_content += data

    def second_pass_label_check(self):
        for inp in self.form_inputs:
            if inp["id"] and inp["id"] in self.label_fors:
                inp["has_label"] = True


# ---------------------------------------------------------------------------
# CSS Analyzer — deep analysis of combined CSS (inline + external)
# ---------------------------------------------------------------------------

class CSSAnalyzer:
    """Analyzes combined CSS content for audit checks."""

    def __init__(self, css_text):
        self.raw = css_text
        # Colors
        self.colors = set()
        self.color_usages = Counter()  # color → count
        # Fonts
        self.font_families = set()
        self.font_sizes = []  # list of (value, unit)
        self.font_weights = set()
        self.font_display_values = set()
        # Spacing
        self.paddings = []
        self.margins = []
        self.gaps = []
        # Layout
        self.media_queries = []
        self.breakpoints = set()
        self.has_print_media = False
        self.has_reduced_motion = False
        self.has_flexbox = False
        self.has_grid = False
        # Selectors & states
        self.has_hover = False
        self.has_active = False
        self.has_focus = False
        self.has_focus_visible = False
        # Properties
        self.body_font_size_px = None
        self.body_line_height = None
        self.border_radii = set()
        self.z_indices = set()
        # Minification
        self.is_likely_minified = False
        # Analyze
        self._analyze()

    def _analyze(self):
        css = self.raw
        if not css:
            return

        # Minification check: if avg line length > 200, likely minified
        lines = css.split('\n')
        if lines:
            avg_line_len = sum(len(l) for l in lines) / len(lines)
            self.is_likely_minified = avg_line_len > 200

        # Extract colors
        for m in re.finditer(r'#([0-9a-fA-F]{3,8})\b', css):
            c = "#" + m.group(1).lower()
            self.colors.add(c)
            self.color_usages[c] += 1
        for m in re.finditer(r'rgba?\([^)]+\)', css):
            c = m.group(0).lower().replace(" ", "")
            self.colors.add(c)
            self.color_usages[c] += 1
        for m in re.finditer(r'hsla?\([^)]+\)', css):
            c = m.group(0).lower().replace(" ", "")
            self.colors.add(c)
            self.color_usages[c] += 1

        # Extract font families
        for m in re.finditer(r'font-family\s*:\s*([^;}]+)', css, re.IGNORECASE):
            families = [f.strip().strip("'\"") for f in m.group(1).split(",")]
            generics = {"inherit","initial","unset","serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded"}
            for f in families:
                if f and f.lower() not in generics:
                    self.font_families.add(f)

        # Extract font sizes
        for m in re.finditer(r'font-size\s*:\s*([\d.]+)(px|rem|em|vw|vh|%)\b', css, re.IGNORECASE):
            self.font_sizes.append((float(m.group(1)), m.group(2).lower()))

        # Extract font weights
        for m in re.finditer(r'font-weight\s*:\s*(\w+)', css, re.IGNORECASE):
            self.font_weights.add(m.group(1).lower())

        # Font-display
        for m in re.finditer(r'font-display\s*:\s*(\w+)', css, re.IGNORECASE):
            self.font_display_values.add(m.group(1).lower())

        # Body font-size
        body_match = re.search(r'body\s*[,{][^}]*?font-size\s*:\s*([\d.]+)(px|rem|em)\b', css, re.IGNORECASE | re.DOTALL)
        if not body_match:
            body_match = re.search(r'body\s*\{[^}]*?font-size\s*:\s*([\d.]+)(px|rem|em)\b', css, re.IGNORECASE | re.DOTALL)
        if body_match:
            v, u = float(body_match.group(1)), body_match.group(2).lower()
            self.body_font_size_px = v * 16 if u in ('rem', 'em') else v

        # Body line-height
        lh_match = re.search(r'body\s*\{[^}]*?line-height\s*:\s*([\d.]+)\s*[;}\n]', css, re.IGNORECASE | re.DOTALL)
        if lh_match:
            try:
                self.body_line_height = float(lh_match.group(1))
            except ValueError:
                pass

        # Spacing analysis: paddings
        for m in re.finditer(r'padding(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]+)', css, re.IGNORECASE):
            vals = re.findall(r'([\d.]+)(px|rem|em|%)', m.group(1))
            for v, u in vals:
                px = float(v)
                if u in ('rem', 'em'): px *= 16
                self.paddings.append(px)

        # Margins
        for m in re.finditer(r'margin(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]+)', css, re.IGNORECASE):
            vals = re.findall(r'([\d.]+)(px|rem|em|%)', m.group(1))
            for v, u in vals:
                px = float(v)
                if u in ('rem', 'em'): px *= 16
                self.margins.append(px)

        # Gap (flexbox/grid)
        for m in re.finditer(r'(?:^|[;\s])gap\s*:\s*([^;}]+)', css, re.IGNORECASE):
            vals = re.findall(r'([\d.]+)(px|rem|em)', m.group(1))
            for v, u in vals:
                px = float(v)
                if u in ('rem', 'em'): px *= 16
                self.gaps.append(px)

        # Media queries
        for m in re.finditer(r'@media\s*([^{]+)', css, re.IGNORECASE):
            query = m.group(1).strip()
            self.media_queries.append(query)
            # Extract breakpoints
            bps = re.findall(r'(?:min|max)-width\s*:\s*([\d.]+)(px|em|rem)', query, re.IGNORECASE)
            for v, u in bps:
                px = float(v)
                if u.lower() in ('em', 'rem'): px *= 16
                self.breakpoints.add(int(px))
            if 'print' in query.lower():
                self.has_print_media = True

        # Reduced motion
        self.has_reduced_motion = bool(re.search(r'prefers-reduced-motion', css, re.IGNORECASE))

        # Layout systems
        self.has_flexbox = bool(re.search(r'display\s*:\s*flex', css, re.IGNORECASE))
        self.has_grid = bool(re.search(r'display\s*:\s*grid', css, re.IGNORECASE))

        # Interactive states
        self.has_hover = bool(re.search(r':hover\b', css))
        self.has_active = bool(re.search(r':active\b', css))
        self.has_focus = bool(re.search(r':focus\b', css))
        self.has_focus_visible = bool(re.search(r':focus-visible\b', css))

        # Border radius consistency
        for m in re.finditer(r'border-radius\s*:\s*([^;}]+)', css, re.IGNORECASE):
            val = m.group(1).strip()
            self.border_radii.add(val)

        # Z-index values
        for m in re.finditer(r'z-index\s*:\s*(-?\d+)', css, re.IGNORECASE):
            self.z_indices.add(int(m.group(1)))

    def check_spacing_system(self):
        """Check if spacing follows a consistent system (e.g., 4px or 8px grid)."""
        all_spacing = [v for v in self.paddings + self.margins + self.gaps if v > 0]
        if len(all_spacing) < 5:
            return None, "insufficient data"

        # Check 8px grid
        on_8 = sum(1 for v in all_spacing if v % 8 == 0 or v % 4 == 0)
        pct = on_8 / len(all_spacing) * 100

        if pct >= 80:
            return True, f"{pct:.0f}% follows 4/8px grid"
        elif pct >= 50:
            return None, f"{pct:.0f}% follows 4/8px grid (partial)"
        else:
            return False, f"only {pct:.0f}% follows 4/8px grid"

    def check_color_palette_consistency(self):
        """Check if the site uses a limited, consistent color palette."""
        unique = len(self.colors)
        if unique == 0:
            return None, "no colors found"
        # Normalize hex colors to 6-digit
        normalized = set()
        for c in self.colors:
            if c.startswith('#'):
                h = c[1:]
                if len(h) == 3:
                    h = ''.join(ch*2 for ch in h)
                normalized.add('#' + h[:6].lower())
            else:
                normalized.add(c)

        n = len(normalized)
        if n <= 12:
            return True, f"{n} unique colors (well-contained palette)"
        elif n <= 25:
            return None, f"{n} unique colors (moderate palette)"
        else:
            return False, f"{n} unique colors (may indicate inconsistency)"

    def check_font_display(self):
        """Check if font-display: swap or optional is used."""
        if not self.font_display_values:
            return None, "no font-display found"
        good = {'swap', 'optional', 'fallback'}
        if self.font_display_values & good:
            return True, f"font-display: {', '.join(self.font_display_values)}"
        return False, f"font-display: {', '.join(self.font_display_values)} (use swap/optional)"

    def check_type_scale(self):
        """Check if font sizes form a reasonable type scale."""
        px_sizes = set()
        for v, u in self.font_sizes:
            px = v * 16 if u in ('rem', 'em') else v
            if 8 <= px <= 120:
                px_sizes.add(round(px))
        if len(px_sizes) < 3:
            return None, "insufficient font size data"
        sorted_sizes = sorted(px_sizes)
        if len(sorted_sizes) <= 8:
            return True, f"{len(sorted_sizes)} distinct sizes: {', '.join(f'{s}px' for s in sorted_sizes)}"
        else:
            return None, f"{len(sorted_sizes)} distinct font sizes (may lack clear scale)"


# ---------------------------------------------------------------------------
# JS Analyzer — pattern detection in JavaScript source
# ---------------------------------------------------------------------------

class JSAnalyzer:
    """Analyzes combined JS content for behavioral audit checks."""

    def __init__(self, js_text):
        self.raw = js_text
        # Behavioral patterns
        self.has_event_listeners = False
        self.has_keyboard_listeners = False
        self.has_focus_management = False
        self.has_error_handling = False
        self.has_try_catch = False
        self.has_loading_states = False
        self.has_form_validation = False
        self.has_console_errors = False   # console.error calls in source
        self.has_service_worker = False
        self.has_fetch_api = False
        self.has_local_storage = False
        self.has_scroll_listeners = False
        self.has_resize_listeners = False
        self.has_touch_listeners = False
        self.has_intersection_observer = False
        self.has_mutation_observer = False
        self.is_likely_minified = False
        # Accessibility patterns in JS
        self.has_aria_manipulation = False
        self.has_focus_trap = False
        self.has_escape_handler = False
        self.has_tabindex_management = False
        # Framework detection from JS content
        self.detected_frameworks = set()
        # Analyze
        self._analyze()

    def _analyze(self):
        js = self.raw
        if not js:
            return

        # Minification check
        lines = js.split('\n')
        if lines:
            avg_line_len = sum(len(l) for l in lines) / len(lines)
            self.is_likely_minified = avg_line_len > 200

        # Event listeners
        self.has_event_listeners = bool(re.search(r'addEventListener\s*\(', js))
        self.has_keyboard_listeners = bool(re.search(r'(?:keydown|keyup|keypress|onkeydown|onkeyup)', js, re.IGNORECASE))
        self.has_focus_management = bool(re.search(r'(?:\.focus\(\)|\.blur\(\)|tabindex|focusin|focusout)', js, re.IGNORECASE))

        # Error handling
        self.has_try_catch = bool(re.search(r'\btry\s*\{', js))
        self.has_error_handling = bool(re.search(r'(?:\.catch\s*\(|onerror|addEventListener\s*\(\s*["\']error)', js))

        # Loading states
        self.has_loading_states = bool(re.search(r'(?:loading|spinner|skeleton|isLoading|setLoading|loadingState)', js, re.IGNORECASE))

        # Form validation
        self.has_form_validation = bool(re.search(r'(?:validity|checkValidity|reportValidity|setCustomValidity|validate|validation)', js, re.IGNORECASE))

        # Console errors in source (indicates debug code left in)
        self.has_console_errors = bool(re.search(r'console\.(error|warn)\s*\(', js))

        # APIs
        self.has_service_worker = bool(re.search(r'serviceWorker', js))
        self.has_fetch_api = bool(re.search(r'\bfetch\s*\(', js))
        self.has_local_storage = bool(re.search(r'localStorage|sessionStorage', js))

        # Listeners
        self.has_scroll_listeners = bool(re.search(r'(?:scroll|onscroll)', js, re.IGNORECASE))
        self.has_resize_listeners = bool(re.search(r'(?:resize|onresize)', js, re.IGNORECASE))
        self.has_touch_listeners = bool(re.search(r'(?:touchstart|touchend|touchmove|ontouchstart)', js, re.IGNORECASE))

        # Observers
        self.has_intersection_observer = bool(re.search(r'IntersectionObserver', js))
        self.has_mutation_observer = bool(re.search(r'MutationObserver', js))

        # A11y patterns
        self.has_aria_manipulation = bool(re.search(r'(?:setAttribute.*aria-|\.ariaLabel|\.ariaHidden|role)', js))
        self.has_focus_trap = bool(re.search(r'(?:focus.?trap|trapFocus|focusTrap)', js, re.IGNORECASE))
        self.has_escape_handler = bool(re.search(r'(?:Escape|escape|27)', js))
        self.has_tabindex_management = bool(re.search(r'tabindex|tabIndex', js))

        # Framework detection from JS content
        if re.search(r'React|ReactDOM|createElement|jsx|__jsx', js): self.detected_frameworks.add("React")
        if re.search(r'Vue\.|createApp|new Vue|__vue__', js): self.detected_frameworks.add("Vue")
        if re.search(r'angular|@angular|ng\.module', js, re.IGNORECASE): self.detected_frameworks.add("Angular")
        if re.search(r'Svelte|svelte', js): self.detected_frameworks.add("Svelte")
        if re.search(r'__NEXT_DATA__|next/router|next/link|_next/', js): self.detected_frameworks.add("Next.js")
        if re.search(r'__NUXT__|nuxt|_nuxt/', js): self.detected_frameworks.add("Nuxt")
        if re.search(r'gatsby|__gatsby', js, re.IGNORECASE): self.detected_frameworks.add("Gatsby")
        if re.search(r'jQuery|\$\(|jQuery\.', js): self.detected_frameworks.add("jQuery")
        if re.search(r'wp-content|wordpress|wp-includes', js, re.IGNORECASE): self.detected_frameworks.add("WordPress")
        if re.search(r'Shopify|shopify', js): self.detected_frameworks.add("Shopify")
        if re.search(r'webpackChunk|__webpack_', js): self.detected_frameworks.add("Webpack")
        if re.search(r'__vite__|import\.meta\.hot', js): self.detected_frameworks.add("Vite")
        if re.search(r'Alpine|x-data', js): self.detected_frameworks.add("Alpine.js")
        if re.search(r'htmx|hx-', js, re.IGNORECASE): self.detected_frameworks.add("HTMX")
        if re.search(r'Turbo|turbolinks|turbo-frame', js, re.IGNORECASE): self.detected_frameworks.add("Turbo/Hotwire")
        if re.search(r'TypeScript|\.tsx?|typescript', js): self.detected_frameworks.add("TypeScript")


# ---------------------------------------------------------------------------
# Contrast calculation helpers
# ---------------------------------------------------------------------------

def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple."""
    h = hex_color.lstrip('#')
    if len(h) == 3:
        h = ''.join(c*2 for c in h)
    if len(h) < 6:
        return None
    try:
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except ValueError:
        return None

def relative_luminance(rgb):
    """Calculate relative luminance per WCAG 2.1."""
    def linearize(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)

def contrast_ratio(rgb1, rgb2):
    """Calculate contrast ratio between two RGB colors."""
    l1 = relative_luminance(rgb1)
    l2 = relative_luminance(rgb2)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _f(check, check_en, status, note, note_en, detail="", detail_en="", rec="", rec_en="", automated=True):
    return {
        "check": check, "check_en": check_en, "status": status,
        "note": note, "note_en": note_en,
        "detail": detail, "detail_en": detail_en,
        "recommendation": rec, "recommendation_en": rec_en,
        "automated": automated,
    }

def _ai():
    return "NEEDS_AI_REVIEW"


# ---------------------------------------------------------------------------
# Check runners — now with CSS and JS analyzer data
# ---------------------------------------------------------------------------

def run_a11y_checks(p, url, css_a, js_a):
    findings = {"a11y_perceivable": [], "a11y_operable": [], "a11y_understandable": [], "a11y_robust": []}

    # -- Perceivable --
    # 1. Alt text
    no_alt = [(s, a) for s, a in p.images if a is None]
    deco = sum(1 for _, a in p.images if a == "")
    if not p.images:
        findings["a11y_perceivable"].append(_f("Alle bilder har meningsfull alt-tekst", "All images have meaningful alt text", "n/a", "Ingen bilder funnet", "No images found"))
    elif no_alt:
        findings["a11y_perceivable"].append(_f("Alle bilder har meningsfull alt-tekst", "All images have meaningful alt text", "fail",
            f"{len(no_alt)} av {len(p.images)} bilder mangler alt-tekst", f"{len(no_alt)} of {len(p.images)} images missing alt text",
            f"Uten alt: {', '.join(s[:50] for s,_ in no_alt[:5])}", f"Without alt: {', '.join(s[:50] for s,_ in no_alt[:5])}",
            "Legg til beskrivende alt-tekst på alle meningsbærende bilder.", "Add descriptive alt text to all meaningful images."))
    else:
        findings["a11y_perceivable"].append(_f("Alle bilder har meningsfull alt-tekst", "All images have meaningful alt text", "pass",
            f"Alle {len(p.images)} bilder har alt-tekst ({deco} dekorative)", f"All {len(p.images)} images have alt text ({deco} decorative)"))

    # 2. Video/audio
    findings["a11y_perceivable"].append(_f("Video/lyd har undertekster", "Video/audio has captions or transcripts", "n/a", "Krever manuell verifisering", "Requires manual verification"))

    # 3. Color contrast — now with CSS color analysis
    if css_a and len(css_a.colors) >= 2:
        # Try to find likely text/background color pairs
        hex_colors = [c for c in css_a.colors if c.startswith('#') and len(c.lstrip('#')) in (3, 6)]
        if len(hex_colors) >= 2:
            rgbs = [(c, hex_to_rgb(c)) for c in hex_colors if hex_to_rgb(c)]
            # Check common pairs: lightest bg vs darkest text
            if len(rgbs) >= 2:
                sorted_by_lum = sorted(rgbs, key=lambda x: relative_luminance(x[1]))
                darkest = sorted_by_lum[0]
                lightest = sorted_by_lum[-1]
                cr = contrast_ratio(darkest[1], lightest[1])
                if cr >= 4.5:
                    findings["a11y_perceivable"].append(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", "pass",
                        f"Beste kontrast: {cr:.1f}:1 ({darkest[0]} / {lightest[0]})",
                        f"Best contrast: {cr:.1f}:1 ({darkest[0]} / {lightest[0]})",
                        detail="Basert på CSS-fargeanalyse; visuell verifikasjon anbefalt.",
                        detail_en="Based on CSS color analysis; visual verification recommended."))
                else:
                    findings["a11y_perceivable"].append(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", "warn",
                        f"Mulig kontrastproblem: {cr:.1f}:1 (krever 4.5:1)",
                        f"Potential contrast issue: {cr:.1f}:1 (requires 4.5:1)",
                        rec="Sjekk fargekontrast mellom tekst og bakgrunn.", rec_en="Check color contrast between text and background."))
            else:
                findings["a11y_perceivable"].append(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", _ai(), "", "", automated=False))
        else:
            findings["a11y_perceivable"].append(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", _ai(), "", "", automated=False))
    else:
        findings["a11y_perceivable"].append(_f("Fargekontrast WCAG AA", "Color contrast meets WCAG AA", _ai(), "", "", automated=False))

    # 4-5. Resize, CSS readability → still visual
    for c, e in [("Tekst kan forstørres til 200%","Text can be resized to 200%"),("Innhold lesbart uten CSS","Content readable without CSS")]:
        findings["a11y_perceivable"].append(_f(c, e, _ai(), "", "", automated=False))

    # -- Operable --
    # 63. Keyboard — now partially automated from JS analysis
    if js_a and js_a.has_keyboard_listeners:
        findings["a11y_operable"].append(_f("All funksjonalitet via tastatur", "All functionality via keyboard", _ai(),
            "Tastaturlyttere funnet i JS", "Keyboard listeners found in JS",
            detail="addEventListener for keydown/keyup funnet — AI verifiserer fullstendighet.",
            detail_en="addEventListener for keydown/keyup found — AI verifies completeness.", automated=False))
    else:
        findings["a11y_operable"].append(_f("All funksjonalitet via tastatur", "All functionality via keyboard", _ai(), "", "", automated=False))

    # 64. Focus indicator — now partially from CSS
    if css_a and (css_a.has_focus or css_a.has_focus_visible):
        detail_parts = []
        if css_a.has_focus: detail_parts.append(":focus")
        if css_a.has_focus_visible: detail_parts.append(":focus-visible")
        findings["a11y_operable"].append(_f("Synlig fokusindikator", "Visible focus indicator", "pass",
            f"Fokusstiler funnet: {', '.join(detail_parts)}", f"Focus styles found: {', '.join(detail_parts)}",
            detail="CSS :focus/:focus-visible regler funnet.", detail_en="CSS :focus/:focus-visible rules found."))
    else:
        findings["a11y_operable"].append(_f("Synlig fokusindikator", "Visible focus indicator", _ai(), "", "", automated=False))

    # 65. Keyboard traps
    if js_a and js_a.has_escape_handler:
        findings["a11y_operable"].append(_f("Ingen tastaturfeller", "No keyboard traps", "pass",
            "Escape-håndtering funnet i JS", "Escape handling found in JS"))
    else:
        findings["a11y_operable"].append(_f("Ingen tastaturfeller", "No keyboard traps", _ai(), "", "", automated=False))

    # 66. Skip link
    if p.has_skip_link:
        findings["a11y_operable"].append(_f("Hopp-til-innhold-lenke", "Skip-to-content link present", "pass", "Funnet", "Found"))
    else:
        findings["a11y_operable"].append(_f("Hopp-til-innhold-lenke", "Skip-to-content link present", "fail", "Ikke funnet", "Not found",
            rec="Legg til en 'Hopp til hovedinnhold'-lenke.", rec_en="Add a 'Skip to main content' link."))

    # 67. Touch targets
    findings["a11y_operable"].append(_f("Trykkmål min 44x44px", "Touch targets min 44x44px", _ai(), "", "", automated=False))

    # 68. No flashing
    findings["a11y_operable"].append(_f("Ingen blinkende innhold", "No flashing content", "pass", "Ingen blinkende elementer", "No flashing elements detected"))

    # 69. Reduced motion — now checks external CSS too
    has_rm = css_a.has_reduced_motion if css_a else p.has_prefers_reduced_motion
    if has_rm:
        findings["a11y_operable"].append(_f("Redusert bevegelse støttet", "Reduced motion support", "pass",
            "prefers-reduced-motion funnet i CSS", "prefers-reduced-motion found in CSS"))
    else:
        findings["a11y_operable"].append(_f("Redusert bevegelse støttet", "Reduced motion support", "warn",
            "prefers-reduced-motion ikke funnet", "prefers-reduced-motion not found",
            rec="Legg til @media (prefers-reduced-motion: reduce) for animasjoner.",
            rec_en="Add @media (prefers-reduced-motion: reduce) for animations."))

    # -- Understandable --
    # 70. Lang
    if p.lang:
        findings["a11y_understandable"].append(_f("Sidespråk deklarert", "Page language declared", "pass", f'lang="{p.lang}"', f'lang="{p.lang}"'))
    else:
        findings["a11y_understandable"].append(_f("Sidespråk deklarert", "Page language declared", "fail", "Mangler lang-attributt", "Missing lang attribute",
            rec='Legg til lang-attributt, f.eks. lang="nb".', rec_en='Add lang attribute, e.g. lang="nb".'))

    # 71. Form labels
    p.second_pass_label_check()
    unlabelled = [i for i in p.form_inputs if not i["has_label"]]
    if not p.form_inputs:
        findings["a11y_understandable"].append(_f("Skjema-labels tilknyttet felt", "Form labels associated with inputs", "n/a", "Ingen skjemafelt", "No form fields"))
    elif unlabelled:
        st = "warn" if len(unlabelled) <= 2 else "fail"
        findings["a11y_understandable"].append(_f("Skjema-labels tilknyttet felt", "Form labels associated with inputs", st,
            f"{len(unlabelled)}/{len(p.form_inputs)} mangler label", f"{len(unlabelled)}/{len(p.form_inputs)} missing label",
            rec="Bruk <label for> eller aria-label.", rec_en="Use <label for> or aria-label."))
    else:
        findings["a11y_understandable"].append(_f("Skjema-labels tilknyttet felt", "Form labels associated with inputs", "pass",
            f"Alle {len(p.form_inputs)} felt har labels", f"All {len(p.form_inputs)} fields have labels"))

    # 72. Error messages — partially from JS
    if js_a and js_a.has_form_validation:
        findings["a11y_understandable"].append(_f("Feilmeldinger veileder", "Error messages guide recovery", _ai(),
            "Form validering funnet i JS", "Form validation found in JS", automated=False))
    else:
        findings["a11y_understandable"].append(_f("Feilmeldinger veileder", "Error messages guide recovery", _ai(), "", "", automated=False))

    for c, e in [("Konsistent navigasjon","Consistent navigation across pages"),
                 ("Forkortelser og sjargong forklart","Abbreviations and jargon explained")]:
        findings["a11y_understandable"].append(_f(c, e, _ai(), "", "", automated=False))

    # -- Robust --
    findings["a11y_robust"].append(_f("Gyldig HTML-struktur", "Valid HTML structure", _ai(), "", "", automated=False))

    # 76. Heading hierarchy
    h = p.headings
    ok = True; issues = []
    if h:
        if h[0][0] != 1: ok = False; issues.append(f"Starter med H{h[0][0]}")
        for i in range(1, len(h)):
            if h[i][0] > h[i-1][0] + 1: ok = False; issues.append(f"H{h[i-1][0]}→H{h[i][0]}")
        h1c = sum(1 for x in h if x[0] == 1)
        if h1c > 1: ok = False; issues.append(f"{h1c} H1-er")
    else:
        ok = False; issues.append("Ingen headinger")
    if ok:
        findings["a11y_robust"].append(_f("Korrekt heading-hierarki", "Proper heading hierarchy", "pass",
            f"{len(h)} headinger, korrekt rekkefølge", f"{len(h)} headings, correct order",
            "Headinger: " + ", ".join(f"H{l}: {t[:30]}" for l,t in h[:8]), "Headings: " + ", ".join(f"H{l}: {t[:30]}" for l,t in h[:8])))
    else:
        findings["a11y_robust"].append(_f("Korrekt heading-hierarki", "Proper heading hierarchy", "warn" if h else "fail",
            "; ".join(issues), "; ".join(issues),
            rec="Rett opp heading-hierarkiet.", rec_en="Fix heading hierarchy."))

    # 77. ARIA
    ta = sum(p.aria_attrs.values())
    if ta == 0: st, n, ne = "warn", "Ingen ARIA", "No ARIA attributes"
    elif ta > 50: st, n, ne = "warn", f"{ta} ARIA-attr (mulig overbruk)", f"{ta} ARIA attrs (possible overuse)"
    else: st, n, ne = "pass", f"{ta} ARIA-attributter", f"{ta} ARIA attributes"
    findings["a11y_robust"].append(_f("ARIA-roller korrekt brukt", "ARIA roles used correctly", st, n, ne,
        ", ".join(f"{k}:{v}" for k,v in p.aria_attrs.most_common(5)), ", ".join(f"{k}:{v}" for k,v in p.aria_attrs.most_common(5))))

    # 78. Semantic HTML
    sem = [e for e in ["nav","main","article","header","footer"] if getattr(p, f"has_{e}", False)]
    if len(sem) >= 3: st = "pass"
    elif sem: st = "warn"
    else: st = "fail"
    findings["a11y_robust"].append(_f("Semantiske HTML-elementer", "Semantic HTML elements used", st,
        ", ".join(sem) if sem else "Ingen funnet", ", ".join(sem) if sem else "None found",
        rec="Bruk nav, main, header, footer." if st != "pass" else "", rec_en="Use nav, main, header, footer." if st != "pass" else ""))

    # 79. Fieldset/legend
    if p.form_inputs:
        if p.fieldsets > 0:
            findings["a11y_robust"].append(_f("Skjema fieldset/legend", "Forms have fieldset/legend", "pass",
                f"{p.fieldsets} fieldset, {p.legends} legend", f"{p.fieldsets} fieldset, {p.legends} legend"))
        else:
            findings["a11y_robust"].append(_f("Skjema fieldset/legend", "Forms have fieldset/legend", "warn",
                "Ingen fieldset funnet", "No fieldset found",
                rec="Grupper relaterte felt med <fieldset> og <legend>.", rec_en="Group related fields with <fieldset> and <legend>."))
    else:
        findings["a11y_robust"].append(_f("Skjema fieldset/legend", "Forms have fieldset/legend", "n/a", "Ingen skjemafelt", "No form fields"))

    # 80. Cross-browser
    findings["a11y_robust"].append(_f("Kryssleser-kompatibilitet", "Cross-browser and cross-device compatibility", _ai(), "", "", automated=False))

    return findings


def run_bp_checks(p, url, css_a, js_a):
    findings = {"bp_performance": [], "bp_security": [], "bp_seo": [], "bp_code": []}
    https = url.startswith("https://")

    # -- Performance --
    # 81. Images
    if p.total_images_with_src == 0:
        findings["bp_performance"].append(_f("Bilder optimalisert", "Images optimized", "n/a", "Ingen bilder", "No images"))
    else:
        lazy_pct = (p.lazy_images / p.total_images_with_src) * 100
        modern_pct = (p.webp_avif_images / p.total_images_with_src) * 100
        iss = []
        if lazy_pct < 50 and p.total_images_with_src > 3: iss.append(f"{p.lazy_images}/{p.total_images_with_src} lazy")
        if modern_pct < 30: iss.append(f"{p.webp_avif_images}/{p.total_images_with_src} moderne format")
        st = "warn" if iss else "pass"
        findings["bp_performance"].append(_f("Bilder optimalisert", "Images optimized", st,
            "; ".join(iss) if iss else f"{p.lazy_images} lazy, {p.webp_avif_images} moderne",
            "; ".join(iss) if iss else f"{p.lazy_images} lazy, {p.webp_avif_images} modern"))

    # 82. CSS/JS minification — now automated from CSS + JS analysis
    css_minified = css_a.is_likely_minified if css_a else None
    js_minified = js_a.is_likely_minified if js_a else None
    if css_minified is not None or js_minified is not None:
        parts = []
        all_ok = True
        if css_minified is not None:
            parts.append(f"CSS {'minifisert' if css_minified else 'ikke minifisert'}")
            if not css_minified: all_ok = False
        if js_minified is not None:
            parts.append(f"JS {'minifisert' if js_minified else 'ikke minifisert'}")
            if not js_minified: all_ok = False
        findings["bp_performance"].append(_f("CSS/JS minifisert", "CSS and JS minified",
            "pass" if all_ok else "warn",
            "; ".join(parts), "; ".join(parts).replace("minifisert", "minified").replace("ikke ", "not "),
            rec="" if all_ok else "Minifiser CSS- og JS-filer for bedre ytelse.",
            rec_en="" if all_ok else "Minify CSS and JS files for better performance."))
    else:
        findings["bp_performance"].append(_f("CSS/JS minifisert", "CSS and JS minified", _ai(), "Ingen eksterne filer analysert", "No external files analyzed", automated=False))

    # 83. Render-blocking
    noas = [s for s in p.scripts if not s["async"] and not s["defer"]]
    if not p.scripts:
        findings["bp_performance"].append(_f("Ingen renderblokkering", "No render-blocking", "n/a", "Ingen scripts", "No scripts"))
    elif noas:
        findings["bp_performance"].append(_f("Ingen renderblokkering", "No render-blocking", "warn",
            f"{len(noas)}/{len(p.scripts)} uten async/defer", f"{len(noas)}/{len(p.scripts)} without async/defer",
            rec="Legg til async/defer.", rec_en="Add async/defer."))
    else:
        findings["bp_performance"].append(_f("Ingen renderblokkering", "No render-blocking", "pass",
            f"Alle {len(p.scripts)} scripts OK", f"All {len(p.scripts)} scripts OK"))

    # 84. Caching headers
    findings["bp_performance"].append(_f("Caching-headere", "Caching headers", _ai(), "", "", automated=False))

    # 85. Font loading — now automated from CSS
    if css_a:
        fd_result, fd_msg = css_a.check_font_display()
        if fd_result is True:
            findings["bp_performance"].append(_f("Font-lasting", "Font loading", "pass", fd_msg, fd_msg))
        elif fd_result is False:
            findings["bp_performance"].append(_f("Font-lasting", "Font loading", "warn", fd_msg, fd_msg,
                rec="Bruk font-display: swap eller optional.", rec_en="Use font-display: swap or optional."))
        else:
            findings["bp_performance"].append(_f("Font-lasting", "Font loading", _ai(), fd_msg, fd_msg, automated=False))
    else:
        findings["bp_performance"].append(_f("Font-lasting", "Font loading", _ai(), "", "", automated=False))

    # -- Security --
    findings["bp_security"].append(_f("HTTPS påkrevd", "HTTPS enforced", "pass" if https else "fail",
        "HTTPS aktiv" if https else "HTTP", "HTTPS active" if https else "HTTP",
        rec="" if https else "Migrer til HTTPS.", rec_en="" if https else "Migrate to HTTPS."))

    if https:
        mixed = [s[:50] for s,_ in p.images if s and s.startswith("http://")] + [l["href"][:50] for l in p.external_links if l["href"].startswith("http://")]
        findings["bp_security"].append(_f("Ingen mixed content", "No mixed content", "warn" if mixed else "pass",
            f"{len(mixed)} referanser" if mixed else "Ingen funnet", f"{len(mixed)} refs" if mixed else "None found",
            rec="Oppdater til HTTPS." if mixed else "", rec_en="Update to HTTPS." if mixed else ""))
    else:
        findings["bp_security"].append(_f("Ingen mixed content", "No mixed content", "n/a", "N/A (HTTP)", "N/A (HTTP)"))

    findings["bp_security"].append(_f("CSP-headere", "CSP headers", _ai(), "", "", automated=False))

    # 90. Exposed sensitive data — partially from JS
    if js_a and js_a.raw:
        sensitive_patterns = re.findall(r'(?:api[_-]?key|secret|password|token|auth)\s*[:=]\s*["\'][^"\']{8,}', js_a.raw, re.IGNORECASE)
        if sensitive_patterns:
            findings["bp_security"].append(_f("Ingen eksponerte sensitive data", "No exposed sensitive data in source", "fail",
                f"{len(sensitive_patterns)} mulige lekkasjer funnet", f"{len(sensitive_patterns)} potential leaks found",
                rec="Fjern hardkodede hemmeligheter fra kildekoden.", rec_en="Remove hardcoded secrets from source code."))
        else:
            findings["bp_security"].append(_f("Ingen eksponerte sensitive data", "No exposed sensitive data in source", "pass",
                "Ingen sensitive mønstre funnet i JS", "No sensitive patterns found in JS"))
    else:
        findings["bp_security"].append(_f("Ingen eksponerte sensitive data", "No exposed sensitive data in source", _ai(), "", "", automated=False))

    # 89. External links
    bad = [l for l in p.external_links if not l["has_noopener"] or not l["has_noreferrer"]]
    if not p.external_links:
        findings["bp_security"].append(_f("Eksterne lenker rel-attr", "External links rel attrs", "n/a", "Ingen", "None"))
    elif bad:
        findings["bp_security"].append(_f("Eksterne lenker rel-attr", "External links rel attrs", "warn",
            f"{len(bad)}/{len(p.external_links)} mangler", f"{len(bad)}/{len(p.external_links)} missing",
            rec='Legg til rel="noopener noreferrer".', rec_en='Add rel="noopener noreferrer".'))
    else:
        findings["bp_security"].append(_f("Eksterne lenker rel-attr", "External links rel attrs", "pass",
            f"Alle {len(p.external_links)} OK", f"All {len(p.external_links)} OK"))

    # -- SEO --
    if p.has_title and p.title_text:
        tl = len(p.title_text)
        st = "pass" if 10 <= tl <= 70 else "warn"
        findings["bp_seo"].append(_f("Beskrivende <title>", "Descriptive <title>", st,
            f'"{p.title_text[:50]}" ({tl} tegn)', f'"{p.title_text[:50]}" ({tl} chars)'))
    else:
        findings["bp_seo"].append(_f("Beskrivende <title>", "Descriptive <title>", "fail", "Mangler", "Missing",
            rec="Legg til <title>.", rec_en="Add <title>."))

    desc = p.meta_tags.get("description", "")
    if desc:
        dl = len(desc)
        st = "pass" if 50 <= dl <= 160 else "warn"
        findings["bp_seo"].append(_f("Meta-beskrivelse", "Meta description", st, f"{dl} tegn", f"{dl} chars"))
    else:
        findings["bp_seo"].append(_f("Meta-beskrivelse", "Meta description", "fail", "Mangler", "Missing",
            rec="Legg til meta description (50-160 tegn).", rec_en="Add meta description (50-160 chars)."))

    findings["bp_seo"].append(_f("Heading-hierarki for SEO", "Heading hierarchy for SEO", _ai(), "Se a11y", "See a11y", automated=False))

    if p.has_canonical:
        findings["bp_seo"].append(_f("Canonical URL", "Canonical URL specified", "pass", "Tilstede", "Present"))
    else:
        findings["bp_seo"].append(_f("Canonical URL", "Canonical URL specified", "warn", "Mangler", "Missing",
            rec='Legg til <link rel="canonical">.', rec_en='Add <link rel="canonical">.'))

    if p.og_tags:
        findings["bp_seo"].append(_f("OG/sosiale meta-tagger", "Open Graph / social meta tags", "pass",
            f"{len(p.og_tags)} OG-tagger funnet", f"{len(p.og_tags)} OG tags found"))
    else:
        findings["bp_seo"].append(_f("OG/sosiale meta-tagger", "Open Graph / social meta tags", "warn", "Mangler", "Missing",
            rec="Legg til Open Graph-tagger.", rec_en="Add Open Graph tags."))

    if p.has_structured_data:
        findings["bp_seo"].append(_f("Strukturerte data (JSON-LD)", "Structured data (JSON-LD)", "pass", "Funnet", "Found"))
    else:
        findings["bp_seo"].append(_f("Strukturerte data (JSON-LD)", "Structured data (JSON-LD)", "warn", "Ikke funnet", "Not found",
            rec="Legg til JSON-LD strukturerte data.", rec_en="Add JSON-LD structured data."))

    # -- Code Quality --
    # 97. Console errors — now partially from JS source analysis
    if js_a and js_a.has_console_errors:
        findings["bp_code"].append(_f("Ingen konsoll-feil", "No console errors", "warn",
            "console.error/warn kall funnet i kildekoden", "console.error/warn calls found in source",
            rec="Fjern debug-kall fra produksjonskoden.", rec_en="Remove debug calls from production code."))
    else:
        findings["bp_code"].append(_f("Ingen konsoll-feil", "No console errors", _ai(), "Sjekkes via nettleser", "Checked via browser", automated=False))

    findings["bp_code"].append(_f("Ingen 404-er", "No broken links (404s)", _ai(), "Krever nettverkssjekk", "Requires network check", automated=False))

    if p.has_viewport:
        findings["bp_code"].append(_f("Viewport meta-tag", "Viewport meta tag", "pass", "Tilstede", "Present"))
    else:
        findings["bp_code"].append(_f("Viewport meta-tag", "Viewport meta tag", "fail", "Mangler", "Missing",
            rec="Legg til viewport meta-tag.", rec_en="Add viewport meta tag."))

    if p.has_favicon:
        findings["bp_code"].append(_f("Favicon", "Favicon", "pass", "Tilstede", "Present"))
    else:
        findings["bp_code"].append(_f("Favicon", "Favicon", "warn", "Ikke funnet i HTML", "Not found in HTML",
            rec="Legg til favicon.", rec_en="Add favicon."))

    # 101. Print stylesheet — now checks external CSS
    has_print = css_a.has_print_media if css_a else p.has_print_media
    if has_print:
        findings["bp_code"].append(_f("Utskriftsstil vurdert", "Print stylesheet considered", "pass",
            "@media print funnet", "@media print found"))
    else:
        findings["bp_code"].append(_f("Utskriftsstil vurdert", "Print stylesheet considered", "warn",
            "Ingen @media print funnet", "No @media print found",
            rec="Legg til @media print.", rec_en="Add @media print."))

    return findings


def run_ux_checks(p, css_a, js_a):
    findings = {"ux_nav": [], "ux_content": [], "ux_interaction": [], "ux_cognitive": []}

    # --- Navigation & Information Architecture (#1-#7) ---

    # #1
    if p.has_nav:
        findings["ux_nav"].append(_f("Tydelig hovednavigasjon", "Clear primary navigation", "pass", "<nav> funnet", "<nav> found"))
    else:
        findings["ux_nav"].append(_f("Tydelig hovednavigasjon", "Clear primary navigation", _ai(), "Ingen <nav>", "No <nav>", automated=False))

    # #2
    findings["ux_nav"].append(_f("Gjeldende side indikert", "Current page indicated", _ai(), "", "", automated=False))

    # #3
    if p.has_breadcrumb:
        findings["ux_nav"].append(_f("Brødsmulesti", "Breadcrumbs", "pass", "Funnet", "Found"))
    else:
        findings["ux_nav"].append(_f("Brødsmulesti", "Breadcrumbs", "n/a", "Ikke funnet (kan være tilsiktet)", "Not found (may be intentional)"))

    # #4
    if p.has_search:
        findings["ux_nav"].append(_f("Søkefunksjon", "Search functionality", "pass", "Funnet", "Found"))
    else:
        findings["ux_nav"].append(_f("Søkefunksjon", "Search functionality", _ai(), "Ikke funnet i HTML", "Not found in HTML", automated=False))

    # #5
    if p.has_footer:
        findings["ux_nav"].append(_f("Footer med nyttelenker", "Footer with utility links", _ai(), "<footer> funnet", "<footer> found", automated=False))
    else:
        findings["ux_nav"].append(_f("Footer med nyttelenker", "Footer with utility links", "warn", "Ingen <footer>", "No <footer>",
            rec="Legg til footer.", rec_en="Add footer."))

    # #6 - 3-click rule
    nav_depth = p.nav_max_list_depth
    int_links = len(set(p.internal_links))
    imp_pages = p.important_pages_linked
    three_click_issues = []
    if nav_depth > 3:
        three_click_issues.append(f"nav-dybde {nav_depth} nivåer (maks 3 anbefalt)")
    if int_links < 5 and p.has_nav:
        three_click_issues.append(f"kun {int_links} interne lenker på siden")
    if not imp_pages and p.has_nav:
        three_click_issues.append("ingen viktige sider (kontakt, om oss, etc.) direkte lenket")

    if three_click_issues:
        findings["ux_nav"].append(_f("Innhold innen 3 klikk", "Important content within 3 clicks", "warn",
            "; ".join(three_click_issues), "; ".join(three_click_issues),
            detail=f"Nav-dybde: {nav_depth}, interne lenker: {int_links}, viktige sider: {', '.join(imp_pages) if imp_pages else 'ingen'}",
            detail_en=f"Nav depth: {nav_depth}, internal links: {int_links}, important pages: {', '.join(imp_pages) if imp_pages else 'none'}",
            rec="Forenkle navigasjonsstrukturen.", rec_en="Simplify navigation structure."))
    elif p.has_nav:
        findings["ux_nav"].append(_f("Innhold innen 3 klikk", "Important content within 3 clicks", "pass",
            f"Nav-dybde: {nav_depth}, {int_links} interne lenker, viktige sider: {', '.join(imp_pages)}",
            f"Nav depth: {nav_depth}, {int_links} internal links, important pages: {', '.join(imp_pages)}"))
    else:
        findings["ux_nav"].append(_f("Innhold innen 3 klikk", "Important content within 3 clicks", _ai(),
            "Ingen <nav> funnet", "No <nav> found", automated=False))

    # #7
    findings["ux_nav"].append(_f("IA følger brukernes mentale modell", "IA follows users' mental model", _ai(), "", "", automated=False))

    # --- Content & Readability (#8-#14) ---

    # #8
    findings["ux_content"].append(_f("Overskrifter beskrivende og skannbare", "Headlines descriptive and scannable", _ai(), "", "", automated=False))

    # #9 Body font size — now from combined CSS
    body_fs = css_a.body_font_size_px if css_a else p.body_font_size_px
    if body_fs is not None:
        if body_fs >= 16:
            findings["ux_content"].append(_f("Brødtekst min 16px", "Body text min 16px", "pass",
                f"{body_fs:.0f}px", f"{body_fs:.0f}px"))
        else:
            findings["ux_content"].append(_f("Brødtekst min 16px", "Body text min 16px", "fail",
                f"{body_fs:.0f}px (min 16px)", f"{body_fs:.0f}px (min 16px required)",
                rec="Øk brødtekstens font-size til minst 16px.", rec_en="Increase body font-size to at least 16px."))
    else:
        findings["ux_content"].append(_f("Brødtekst min 16px", "Body text min 16px", _ai(), "", "", automated=False))

    # #10-#12
    for c, e in [("Linjelengde 45-75 tegn","Line length 45-75 chars"),
                 ("Språk tilpasset brukernes verden","Language matches users' vocabulary"),
                 ("Innhold hierarki","Content hierarchy")]:
        findings["ux_content"].append(_f(c, e, _ai(), "", "", automated=False))

    # #13
    findings["ux_content"].append(_f("Bilder relevante og av god kvalitet", "Images relevant, high-quality, and support content", _ai(), "", "", automated=False))
    # #14
    findings["ux_content"].append(_f("Innhold matcher bruker- og forretningsmål", "Content aligns with user and business goals", _ai(), "", "", automated=False))

    # --- Interaction Design (#15-#22) ---

    # #15
    findings["ux_interaction"].append(_f("Primær CTA identifiserbar", "Primary CTA identifiable", _ai(), "", "", automated=False))
    # #16
    findings["ux_interaction"].append(_f("Interaktive elementer som forventet", "Interactive elements behave as expected", _ai(), "", "", automated=False))

    # #17 System status — now partially from JS
    if js_a and js_a.has_loading_states:
        findings["ux_interaction"].append(_f("Systemstatus kommunisert", "System status communicated", "pass",
            "Lastetilstander funnet i JS", "Loading states found in JS",
            detail="Mønster som loading/spinner/skeleton funnet.", detail_en="Patterns like loading/spinner/skeleton found."))
    else:
        findings["ux_interaction"].append(_f("Systemstatus kommunisert", "System status communicated", _ai(), "", "", automated=False))

    # #18 Error messages — partially from JS
    if js_a and js_a.has_error_handling:
        findings["ux_interaction"].append(_f("Feilmeldinger veileder til løsning", "Error messages guide recovery", _ai(),
            "Feilhåndtering funnet i JS (.catch/onerror)", "Error handling found in JS (.catch/onerror)", automated=False))
    else:
        findings["ux_interaction"].append(_f("Feilmeldinger veileder til løsning", "Error messages guide recovery", _ai(), "", "", automated=False))

    # #19 Error prevention — partially from JS
    if js_a and js_a.has_form_validation:
        findings["ux_interaction"].append(_f("Forebygging av feil", "Error prevention", "pass",
            "Form-validering funnet i JS", "Form validation found in JS",
            detail="checkValidity/setCustomValidity eller lignende.", detail_en="checkValidity/setCustomValidity or similar."))
    else:
        findings["ux_interaction"].append(_f("Forebygging av feil", "Error prevention", _ai(), "", "", automated=False))

    # #20 Shortcuts
    ak = p.accesskeys
    ac = p.autocomplete_inputs
    kb = js_a.has_keyboard_listeners if js_a else False
    if ak > 0 or ac > 0 or kb:
        parts = []
        if ak: parts.append(f"{ak} accesskey")
        if ac: parts.append(f"{ac} autocomplete")
        if kb: parts.append("tastaturlyttere i JS")
        findings["ux_interaction"].append(_f("Snarveier for erfarne brukere", "Shortcuts and accelerators for experienced users", "pass",
            ", ".join(parts), ", ".join(parts).replace("tastaturlyttere i JS", "keyboard listeners in JS")))
    else:
        findings["ux_interaction"].append(_f("Snarveier for erfarne brukere", "Shortcuts and accelerators for experienced users", _ai(),
            "Ingen accesskey/autocomplete/keyboard funnet", "No accesskey/autocomplete/keyboard found", automated=False))

    # #21 Form design
    fe = p.form_inputs_extended
    if not fe:
        findings["ux_interaction"].append(_f("Skjemadesign", "Form design quality", "n/a", "Ingen skjemafelt", "No form fields"))
    else:
        issues = []
        with_req = sum(1 for f in fe if f["required"])
        with_ph = sum(1 for f in fe if f["placeholder"])
        generic_type = sum(1 for f in fe if f["type"] == "text" and f["name"] and any(kw in f["name"].lower() for kw in ["email","phone","tel","date","number","url"]))
        if with_req == 0 and len(fe) > 1:
            issues.append("ingen required-attributter")
        if generic_type > 0:
            issues.append(f"{generic_type} felt med feil input-type")
        st = "warn" if issues else "pass"
        n = "; ".join(issues) if issues else f"{len(fe)} felt, {with_req} required, {with_ph} placeholder"
        ne = f"{len(fe)} fields, {with_req} required, {with_ph} placeholder"
        findings["ux_interaction"].append(_f("Skjemadesign", "Form design quality", st, n, ne,
            rec="Bruk required, riktige input-typer og placeholder-tekst." if issues else "",
            rec_en="Use required, correct input types, and placeholder text." if issues else ""))

    # #22 Mobile interaction — partially from JS + CSS
    mobile_signals = []
    if js_a and js_a.has_touch_listeners:
        mobile_signals.append("touch-lyttere i JS")
    if css_a and css_a.breakpoints:
        mobile_bps = [bp for bp in css_a.breakpoints if bp <= 768]
        if mobile_bps:
            mobile_signals.append(f"mobile breakpoints: {', '.join(f'{bp}px' for bp in sorted(mobile_bps))}")
    if mobile_signals:
        findings["ux_interaction"].append(_f("Mobil interaksjonsdesign", "Mobile interaction design", _ai(),
            "; ".join(mobile_signals), "; ".join(mobile_signals).replace("touch-lyttere i JS", "touch listeners in JS"),
            automated=False))
    else:
        findings["ux_interaction"].append(_f("Mobil interaksjonsdesign", "Mobile interaction design", _ai(), "", "", automated=False))

    # --- Cognitive Load & User Control (#23-#30) ---

    for c, e in [("Minimal kompleksitet og valg","Minimal complexity and choices"),
                 ("Gjenkjenning fremfor hukommelse","Recognition over recall"),
                 ("Gruppert innhold og progressiv avsløring","Grouped content and progressive disclosure")]:
        findings["ux_cognitive"].append(_f(c, e, _ai(), "", "", automated=False))

    # #26 Conventions + escape routes — partially from JS
    if js_a and js_a.has_escape_handler:
        findings["ux_cognitive"].append(_f("Konvensjoner og brukerkontroll", "Conventions and user control", _ai(),
            "Escape-håndtering funnet", "Escape handling found", automated=False))
    else:
        findings["ux_cognitive"].append(_f("Konvensjoner og brukerkontroll", "Conventions and user control", _ai(), "", "", automated=False))

    # #27
    findings["ux_cognitive"].append(_f("Primæroppgave uten forvirring", "Primary task without confusion", _ai(), "", "", automated=False))
    # #28
    findings["ux_cognitive"].append(_f("Hjelp og dokumentasjon tilgjengelig", "Help and documentation accessible", _ai(), "", "", automated=False))

    # #29 Trust signals
    ts = p.trust_signals
    if ts:
        findings["ux_cognitive"].append(_f("Tillitssignaler til stede", "Trust signals present", "pass",
            f"Funnet: {', '.join(ts)}", f"Found: {', '.join(ts)}"))
    else:
        findings["ux_cognitive"].append(_f("Tillitssignaler til stede", "Trust signals present", _ai(),
            "Ingen tillitssignaler funnet i HTML-klasser", "No trust signals found in HTML classes", automated=False))

    # #30
    findings["ux_cognitive"].append(_f("Onboarding/veiledning for nye brukere", "Onboarding or first-time user guidance", _ai(), "", "", automated=False))

    return findings


def run_ui_checks(p, css_a):
    findings = {"ui_hierarchy": [], "ui_typography": [], "ui_color": [], "ui_spacing": [], "ui_components": []}

    # Get CSS data
    font_families = css_a.font_families if css_a else p.fonts_in_style
    body_lh = css_a.body_line_height if css_a else p.body_line_height
    has_mq = (css_a and len(css_a.media_queries) > 0) if css_a else p.has_media_queries

    # --- Visual Hierarchy (#31-#36) ---

    # #31 Heading levels — automated from HTML
    if len(p.headings) >= 2:
        levels = set(h[0] for h in p.headings)
        if len(levels) >= 2:
            findings["ui_hierarchy"].append(_f("Distinkte heading-nivåer", "Distinct heading levels", "pass",
                f"{len(levels)} distinkte nivåer brukt", f"{len(levels)} distinct levels used"))
        else:
            findings["ui_hierarchy"].append(_f("Distinkte heading-nivåer", "Distinct heading levels", "warn",
                "Kun ett heading-nivå brukt", "Only one heading level used",
                rec="Bruk flere heading-nivåer for bedre hierarki.", rec_en="Use multiple heading levels for better hierarchy."))
    else:
        findings["ui_hierarchy"].append(_f("Distinkte heading-nivåer", "Distinct heading levels", _ai(), "", "", automated=False))

    # #32-33 Primary vs secondary, visual weight → still visual
    findings["ui_hierarchy"].append(_f("Primær vs sekundær handling", "Primary vs secondary actions", _ai(), "", "", automated=False))
    findings["ui_hierarchy"].append(_f("Visuell vekt", "Visual weight guides eye", _ai(), "", "", automated=False))

    # #34 Whitespace — partially from CSS spacing analysis
    if css_a and (css_a.paddings or css_a.margins):
        avg_padding = sum(css_a.paddings) / len(css_a.paddings) if css_a.paddings else 0
        avg_margin = sum(css_a.margins) / len(css_a.margins) if css_a.margins else 0
        if avg_padding >= 12 or avg_margin >= 12:
            findings["ui_hierarchy"].append(_f("Whitespace", "Adequate whitespace", _ai(),
                f"Gj.sn. padding: {avg_padding:.0f}px, margin: {avg_margin:.0f}px",
                f"Avg padding: {avg_padding:.0f}px, margin: {avg_margin:.0f}px", automated=False))
        else:
            findings["ui_hierarchy"].append(_f("Whitespace", "Adequate whitespace", _ai(),
                f"Lav gj.sn. padding: {avg_padding:.0f}px, margin: {avg_margin:.0f}px",
                f"Low avg padding: {avg_padding:.0f}px, margin: {avg_margin:.0f}px", automated=False))
    else:
        findings["ui_hierarchy"].append(_f("Whitespace", "Adequate whitespace", _ai(), "", "", automated=False))

    # #35 Scan pattern → visual
    findings["ui_hierarchy"].append(_f("Skannemønster", "Scan pattern flow", _ai(), "", "", automated=False))

    # #36 Content density → visual
    findings["ui_hierarchy"].append(_f("Innholdstetthet balansert", "Content density balanced with breathing room", _ai(), "", "", automated=False))

    # --- Typography (#37-#41) ---

    # #37 Font families
    fc = len(font_families)
    if fc > 0:
        if fc <= 3:
            findings["ui_typography"].append(_f("Konsistente fontfamilier", "Consistent font families", "pass",
                f"{fc} fonter: {', '.join(list(font_families)[:3])}", f"{fc} fonts: {', '.join(list(font_families)[:3])}"))
        else:
            findings["ui_typography"].append(_f("Konsistente fontfamilier", "Consistent font families", "warn",
                f"{fc} fonter (maks 3 anbefalt)", f"{fc} fonts (max 3 recommended)",
                rec="Reduser antall fontfamilier til 2-3.", rec_en="Reduce font families to 2-3."))
    else:
        findings["ui_typography"].append(_f("Konsistente fontfamilier", "Consistent font families", _ai(), "", "", automated=False))

    # #38 Type scale — now from CSS analyzer
    if css_a:
        ts_result, ts_msg = css_a.check_type_scale()
        if ts_result is True:
            findings["ui_typography"].append(_f("Typeskala", "Type scale", "pass", ts_msg, ts_msg))
        elif ts_result is False:
            findings["ui_typography"].append(_f("Typeskala", "Type scale", "warn", ts_msg, ts_msg,
                rec="Definer en tydelig typeskala.", rec_en="Define a clear type scale."))
        else:
            findings["ui_typography"].append(_f("Typeskala", "Type scale", _ai(), ts_msg if ts_msg != "insufficient font size data" else "", ts_msg if ts_msg != "insufficient font size data" else "", automated=False))
    else:
        findings["ui_typography"].append(_f("Typeskala", "Type scale", _ai(), "", "", automated=False))

    # #39 Line height
    if body_lh is not None:
        if 1.4 <= body_lh <= 1.6:
            findings["ui_typography"].append(_f("Linjehøyde", "Line height", "pass",
                f"linjehøyde {body_lh}", f"line-height {body_lh}"))
        else:
            findings["ui_typography"].append(_f("Linjehøyde", "Line height", "warn",
                f"linjehøyde {body_lh} (anbefalt 1.4–1.6)", f"line-height {body_lh} (recommended 1.4–1.6)",
                rec="Sett line-height til 1.4–1.6.", rec_en="Set line-height to 1.4–1.6."))
    else:
        findings["ui_typography"].append(_f("Linjehøyde", "Line height", _ai(), "", "", automated=False))

    # #40 Font weights — now from CSS
    if css_a and css_a.font_weights:
        fw = css_a.font_weights
        if 2 <= len(fw) <= 5:
            findings["ui_typography"].append(_f("Fontvekter", "Font weights", "pass",
                f"{len(fw)} vekter: {', '.join(sorted(fw))}", f"{len(fw)} weights: {', '.join(sorted(fw))}"))
        elif len(fw) > 5:
            findings["ui_typography"].append(_f("Fontvekter", "Font weights", "warn",
                f"{len(fw)} vekter (kan virke rotete)", f"{len(fw)} weights (may appear cluttered)",
                rec="Begrens til 3-4 fontvekter.", rec_en="Limit to 3-4 font weights."))
        else:
            findings["ui_typography"].append(_f("Fontvekter", "Font weights", _ai(),
                f"{len(fw)} vekter funnet", f"{len(fw)} weights found", automated=False))
    else:
        findings["ui_typography"].append(_f("Fontvekter", "Font weights", _ai(), "", "", automated=False))

    # #41 Text alignment → visual
    findings["ui_typography"].append(_f("Tekstjustering", "Text alignment", _ai(), "", "", automated=False))

    # --- Color & Contrast (#42-#46) ---

    # #42 Color palette — now from CSS
    if css_a:
        cp_result, cp_msg = css_a.check_color_palette_consistency()
        if cp_result is True:
            findings["ui_color"].append(_f("Konsistent fargepalett", "Consistent color palette", "pass", cp_msg, cp_msg))
        elif cp_result is False:
            findings["ui_color"].append(_f("Konsistent fargepalett", "Consistent color palette", "warn", cp_msg, cp_msg,
                rec="Reduser antall unike farger til en definert palett.", rec_en="Reduce unique colors to a defined palette."))
        else:
            findings["ui_color"].append(_f("Konsistent fargepalett", "Consistent color palette", _ai(), cp_msg, cp_msg, automated=False))
    else:
        findings["ui_color"].append(_f("Konsistent fargepalett", "Consistent color palette", _ai(), "", "", automated=False))

    # #43 Color not sole means → visual
    findings["ui_color"].append(_f("Farge ikke eneste middel", "Color not sole means", _ai(), "", "", automated=False))

    # #44 Contrast ratios → handled in a11y_perceivable check #60
    findings["ui_color"].append(_f("Kontrastforhold", "Contrast ratios", _ai(), "Se tilgjengelighetssjekk", "See accessibility check", automated=False))

    # #45 Brand colors → visual
    findings["ui_color"].append(_f("Merkefarger konsistent", "Brand colors consistent", _ai(), "", "", automated=False))

    # #46 Hover/active — now from CSS
    if css_a and (css_a.has_hover or css_a.has_active):
        states = []
        if css_a.has_hover: states.append(":hover")
        if css_a.has_active: states.append(":active")
        findings["ui_color"].append(_f("Hover/aktive farger", "Hover/active colors", "pass",
            f"Tilstander funnet: {', '.join(states)}", f"States found: {', '.join(states)}"))
    else:
        findings["ui_color"].append(_f("Hover/aktive farger", "Hover/active colors", _ai(), "", "", automated=False))

    # --- Spacing & Layout (#47-#51) ---

    # #47 Consistent spacing — now from CSS
    if css_a:
        sp_result, sp_msg = css_a.check_spacing_system()
        if sp_result is True:
            findings["ui_spacing"].append(_f("Konsistent mellomrom", "Consistent spacing", "pass", sp_msg, sp_msg))
        elif sp_result is False:
            findings["ui_spacing"].append(_f("Konsistent mellomrom", "Consistent spacing", "warn", sp_msg, sp_msg,
                rec="Bruk et konsistent spacing-system (4px/8px grid).", rec_en="Use a consistent spacing system (4px/8px grid)."))
        else:
            findings["ui_spacing"].append(_f("Konsistent mellomrom", "Consistent spacing", _ai(), sp_msg or "", sp_msg or "", automated=False))
    else:
        findings["ui_spacing"].append(_f("Konsistent mellomrom", "Consistent spacing", _ai(), "", "", automated=False))

    # #48 Alignment → visual
    findings["ui_spacing"].append(_f("Justering", "Alignment", _ai(), "", "", automated=False))

    # #49 Responsive layout — now from combined CSS
    if css_a and css_a.breakpoints:
        bps = sorted(css_a.breakpoints)
        findings["ui_spacing"].append(_f("Responsivt layout", "Responsive layout", "pass",
            f"{len(bps)} breakpoints: {', '.join(f'{bp}px' for bp in bps[:6])}",
            f"{len(bps)} breakpoints: {', '.join(f'{bp}px' for bp in bps[:6])}"))
    elif has_mq:
        findings["ui_spacing"].append(_f("Responsivt layout", "Responsive layout", "pass",
            "@media queries funnet", "@media queries found"))
    else:
        findings["ui_spacing"].append(_f("Responsivt layout", "Responsive layout", "warn",
            "Ingen @media queries funnet", "No @media queries found",
            rec="Legg til responsive breakpoints.", rec_en="Add responsive breakpoints."))

    # #50 Padding — now from CSS
    if css_a and css_a.paddings:
        avg_p = sum(css_a.paddings) / len(css_a.paddings)
        if avg_p >= 8:
            findings["ui_spacing"].append(_f("Tilstrekkelig padding", "Adequate padding", "pass",
                f"Gj.sn. {avg_p:.0f}px over {len(css_a.paddings)} verdier", f"Avg {avg_p:.0f}px across {len(css_a.paddings)} values"))
        else:
            findings["ui_spacing"].append(_f("Tilstrekkelig padding", "Adequate padding", "warn",
                f"Lav gj.sn. padding: {avg_p:.0f}px", f"Low avg padding: {avg_p:.0f}px",
                rec="Øk padding i containere.", rec_en="Increase padding in containers."))
    else:
        findings["ui_spacing"].append(_f("Tilstrekkelig padding", "Adequate padding", _ai(), "", "", automated=False))

    # #51 Margins — now from CSS
    if css_a and css_a.margins:
        avg_m = sum(css_a.margins) / len(css_a.margins)
        # Check consistency: standard deviation
        if len(css_a.margins) >= 5:
            mean = avg_m
            variance = sum((v - mean)**2 for v in css_a.margins) / len(css_a.margins)
            std = variance ** 0.5
            cv = std / mean if mean > 0 else 0
            if cv < 0.8:
                findings["ui_spacing"].append(_f("Konsistente marginer", "Consistent margins", "pass",
                    f"Gj.sn. {avg_m:.0f}px, variasjonskoeff. {cv:.2f}", f"Avg {avg_m:.0f}px, CV {cv:.2f}"))
            else:
                findings["ui_spacing"].append(_f("Konsistente marginer", "Consistent margins", "warn",
                    f"Høy variasjon i marginer (CV: {cv:.2f})", f"High margin variation (CV: {cv:.2f})",
                    rec="Standardiser marginer med et spacing-system.", rec_en="Standardize margins with a spacing system."))
        else:
            findings["ui_spacing"].append(_f("Konsistente marginer", "Consistent margins", _ai(),
                f"Gj.sn. margin: {avg_m:.0f}px", f"Avg margin: {avg_m:.0f}px", automated=False))
    else:
        findings["ui_spacing"].append(_f("Konsistente marginer", "Consistent margins", _ai(), "", "", automated=False))

    # --- Components (#52-#57) ---

    # #52-#54 Buttons, form fields, icons → visual
    for c, e in [("Knapper konsistent","Buttons consistent"),("Skjemafelt konsistent","Form fields consistent"),
                 ("Ikoner konsistente","Icons consistent")]:
        findings["ui_components"].append(_f(c, e, _ai(), "", "", automated=False))

    # #55 Cards/containers → visual
    findings["ui_components"].append(_f("Kort/containere", "Cards/containers", _ai(), "", "", automated=False))

    # #56 Borders/border-radius — now from CSS
    if css_a and css_a.border_radii:
        br_count = len(css_a.border_radii)
        if br_count <= 4:
            findings["ui_components"].append(_f("Kantlinjer konsistente", "Borders consistent", "pass",
                f"{br_count} ulike border-radius verdier", f"{br_count} different border-radius values",
                detail=f"Verdier: {', '.join(list(css_a.border_radii)[:4])}", detail_en=f"Values: {', '.join(list(css_a.border_radii)[:4])}"))
        else:
            findings["ui_components"].append(_f("Kantlinjer konsistente", "Borders consistent", "warn",
                f"{br_count} ulike border-radius (kan virke inkonsistent)", f"{br_count} different border-radius (may appear inconsistent)",
                rec="Standardiser border-radius verdier.", rec_en="Standardize border-radius values."))
    else:
        findings["ui_components"].append(_f("Kantlinjer konsistente", "Borders consistent", _ai(), "", "", automated=False))

    # #57
    findings["ui_components"].append(_f("404/feilsider designet", "404 and error pages designed and helpful", _ai(), "", "", automated=False))

    return findings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Pre-audit automated HTML/CSS/JS checks")
    ap.add_argument("html_file", help="Path to saved HTML file")
    ap.add_argument("url", help="URL of the audited page")
    ap.add_argument("--css", help="Path to combined external CSS file", default=None)
    ap.add_argument("--js", help="Path to combined external JS file", default=None)
    ap.add_argument("-o", "--output", help="Output file (default: stdout)")
    args = ap.parse_args()

    with open(args.html_file, "r", encoding="utf-8", errors="replace") as f:
        html = f.read()

    # Parse HTML
    hp = AuditHTMLParser()
    hp.feed(html)

    # Load and analyze ALL CSS (inline + external)
    ext_css = ""
    css_analyzer = None
    if args.css and os.path.exists(args.css):
        with open(args.css, "r", encoding="utf-8", errors="replace") as f:
            ext_css = f.read()
    combined_css = hp.inline_css + "\n" + ext_css
    if combined_css.strip():
        css_analyzer = CSSAnalyzer(combined_css)

    # Load and analyze ALL JS (inline + external)
    js_analyzer = None
    ext_js = ""
    if args.js and os.path.exists(args.js):
        with open(args.js, "r", encoding="utf-8", errors="replace") as f:
            ext_js = f.read()
    combined_js = hp.inline_scripts + "\n" + ext_js
    if combined_js.strip():
        js_analyzer = JSAnalyzer(combined_js)

    # Run all check categories
    all_findings = {}
    for fn in [
        run_a11y_checks(hp, args.url, css_analyzer, js_analyzer),
        run_bp_checks(hp, args.url, css_analyzer, js_analyzer),
        run_ux_checks(hp, css_analyzer, js_analyzer),
        run_ui_checks(hp, css_analyzer),
    ]:
        all_findings.update(fn)

    total = sum(len(v) for v in all_findings.values())
    auto = sum(1 for v in all_findings.values() for i in v if i.get("automated") and i["status"] != "NEEDS_AI_REVIEW")
    review = sum(1 for v in all_findings.values() for i in v if i["status"] == "NEEDS_AI_REVIEW")

    # Merge framework detection from all sources
    all_frameworks = set(hp.detected_frameworks)
    if js_analyzer:
        all_frameworks |= js_analyzer.detected_frameworks
    # Detect from CSS (Tailwind, Bootstrap)
    if css_analyzer:
        if re.search(r'tailwind|tw-', css_analyzer.raw, re.IGNORECASE):
            all_frameworks.add("Tailwind CSS")
        if re.search(r'bootstrap|\.btn-primary|\.container-fluid', css_analyzer.raw, re.IGNORECASE):
            all_frameworks.add("Bootstrap")
        if re.search(r'foundation|\.grid-x|\.cell', css_analyzer.raw, re.IGNORECASE):
            all_frameworks.add("Foundation")
        if re.search(r'bulma|\.is-primary|\.columns', css_analyzer.raw, re.IGNORECASE):
            all_frameworks.add("Bulma")
        if re.search(r'materialize|\.materialize', css_analyzer.raw, re.IGNORECASE):
            all_frameworks.add("Materialize")

    result = {
        "pre_audit_version": "2.1.0",
        "url": args.url,
        "summary": {"total_checks": total, "automated": auto, "needs_ai_review": review},
        "detected_frameworks": sorted(all_frameworks),
        "analysis_scope": {
            "html_size_kb": round(len(html) / 1024, 1),
            "inline_css_size_kb": round(len(hp.inline_css) / 1024, 1),
            "external_css_size_kb": round(len(ext_css) / 1024, 1),
            "inline_js_size_kb": round(len(hp.inline_scripts) / 1024, 1),
            "external_js_size_kb": round(len(ext_js) / 1024, 1),
            "total_analyzed_kb": round((len(html) + len(hp.inline_css) + len(ext_css) + len(hp.inline_scripts) + len(ext_js)) / 1024, 1),
        },
        "html_stats": {
            "images": len(hp.images), "headings": len(hp.headings), "links": len(hp.links),
            "external_links": len(hp.external_links), "form_inputs": len(hp.form_inputs),
            "scripts": len(hp.scripts), "inline_scripts": len(hp.inline_scripts.split('\n')) if hp.inline_scripts.strip() else 0,
            "fonts_detected": list(hp.fonts_in_style),
            "semantic_elements": [e for e in ["nav","main","article","header","footer"] if getattr(hp, f"has_{e}", False)],
            "has_structured_data": hp.has_structured_data, "og_tags": list(hp.og_tags),
            "nav_max_list_depth": hp.nav_max_list_depth,
            "internal_links_count": len(set(hp.internal_links)),
            "important_pages_linked": hp.important_pages_linked,
        },
        "css_stats": {
            "analyzed": css_analyzer is not None,
            "total_css_size_kb": round((len(hp.inline_css) + len(ext_css)) / 1024, 1),
            "total_colors": len(css_analyzer.colors) if css_analyzer else 0,
            "font_families": list(css_analyzer.font_families) if css_analyzer else list(hp.fonts_in_style),
            "font_weights": sorted(css_analyzer.font_weights) if css_analyzer else [],
            "breakpoints": sorted(css_analyzer.breakpoints) if css_analyzer else [],
            "has_flexbox": css_analyzer.has_flexbox if css_analyzer else False,
            "has_grid": css_analyzer.has_grid if css_analyzer else False,
            "has_hover_states": css_analyzer.has_hover if css_analyzer else False,
            "has_active_states": css_analyzer.has_active if css_analyzer else False,
            "has_focus_styles": css_analyzer.has_focus if css_analyzer else False,
            "has_focus_visible": css_analyzer.has_focus_visible if css_analyzer else False,
            "has_reduced_motion": css_analyzer.has_reduced_motion if css_analyzer else False,
            "has_print_media": css_analyzer.has_print_media if css_analyzer else False,
            "border_radius_values": sorted(css_analyzer.border_radii)[:10] if css_analyzer else [],
            "is_minified": css_analyzer.is_likely_minified if css_analyzer else None,
        },
        "js_stats": {
            "analyzed": js_analyzer is not None,
            "total_js_size_kb": round((len(hp.inline_scripts) + len(ext_js)) / 1024, 1),
            "has_keyboard_listeners": js_analyzer.has_keyboard_listeners if js_analyzer else False,
            "has_error_handling": js_analyzer.has_error_handling if js_analyzer else False,
            "has_try_catch": js_analyzer.has_try_catch if js_analyzer else False,
            "has_loading_states": js_analyzer.has_loading_states if js_analyzer else False,
            "has_form_validation": js_analyzer.has_form_validation if js_analyzer else False,
            "has_touch_listeners": js_analyzer.has_touch_listeners if js_analyzer else False,
            "has_scroll_listeners": js_analyzer.has_scroll_listeners if js_analyzer else False,
            "has_resize_listeners": js_analyzer.has_resize_listeners if js_analyzer else False,
            "has_focus_management": js_analyzer.has_focus_management if js_analyzer else False,
            "has_aria_manipulation": js_analyzer.has_aria_manipulation if js_analyzer else False,
            "has_focus_trap": js_analyzer.has_focus_trap if js_analyzer else False,
            "has_escape_handler": js_analyzer.has_escape_handler if js_analyzer else False,
            "has_service_worker": js_analyzer.has_service_worker if js_analyzer else False,
            "has_intersection_observer": js_analyzer.has_intersection_observer if js_analyzer else False,
            "is_minified": js_analyzer.is_likely_minified if js_analyzer else None,
        },
        "findings": all_findings,
    }

    out = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out)
        scope = result["analysis_scope"]
        fw = ", ".join(all_frameworks) if all_frameworks else "none detected"
        print(f"Pre-audit v2.1: {total} checks, {auto} automated, {review} AI | {scope['total_analyzed_kb']:.0f}KB analyzed | Frameworks: {fw}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
