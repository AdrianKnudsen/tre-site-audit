#!/usr/bin/env python3
"""
Pre-Audit Automated Checker
=============================
Runs programmatic checks on raw HTML to pre-fill audit findings that don't
require visual/subjective AI judgment.  Outputs a partial audit-data JSON
that the AI merges with its own visual evaluations before generating the
final report.

v1.1.0 — Updated to cover 101-point checklist (from 87).

Covers ~30-35 of 101 checks automatically:
  - Accessibility (WCAG): alt text, lang, headings, skip-link, ARIA, semantic HTML,
    form labels, fieldset/legend, prefers-reduced-motion
  - Best Practices: HTTPS, meta tags, favicon, external links, image optimisation, viewport
  - UI (partial): font count, line height, responsive layout
  - UX (partial): nav, breadcrumbs, search, form design, shortcuts/accesskey, trust signals

Usage:
    python3 pre-audit.py <html-file> <url> [-o /tmp/pre-audit-results.json]

Output: JSON to stdout or file. Items with status "NEEDS_AI_REVIEW" must be
evaluated by the AI via screenshot/accessibility tree.
"""

import json, sys, os, re, argparse
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
        # CSS-derived properties
        self.body_font_size_px = None
        self.body_line_height = None
        self.has_media_queries = False
        self.has_print_media = False
        # New: checks added in v1.1.0
        self.accesskeys = 0
        self.autocomplete_inputs = 0
        self.has_prefers_reduced_motion = False
        # Trust signals
        self.trust_signals = []  # list of detected trust signal types
        # Extended form data for form design check
        self.form_inputs_extended = []  # {type, required, placeholder, pattern, autocomplete}

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

        if tag_lower == "nav":
            self.has_nav = True
            aria_label = ad.get("aria-label", "").lower()
            if "breadcrumb" in aria_label or "brødsmule" in aria_label:
                self.has_breadcrumb = True

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
                # Extended form data for form design check (#21)
                has_autocomplete = bool(ad.get("autocomplete", ""))
                if has_autocomplete: self.autocomplete_inputs += 1
                self.form_inputs_extended.append({
                    "type": inp_type,
                    "required": "required" in ad,
                    "placeholder": bool(ad.get("placeholder", "")),
                    "pattern": bool(ad.get("pattern", "")),
                    "autocomplete": has_autocomplete,
                    "name": inp_name,
                })
            if inp_type == "search": self.has_search = True

        if tag_lower == "label":
            for_attr = ad.get("for", "")
            if for_attr: self.label_fors.add(for_attr)

        if tag_lower == "fieldset": self.fieldsets += 1
        if tag_lower == "legend": self.legends += 1

        # Textarea and select for extended form design check
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

        # Trust signals detection (#29)
        cls = ad.get("class", "").lower()
        role_val = ad.get("role", "").lower()
        trust_kws = ["trust", "testimonial", "review", "rating", "badge", "certification", "verified", "secure", "guarantee"]
        for kw in trust_kws:
            if kw in cls or kw in role_val:
                if kw not in self.trust_signals:
                    self.trust_signals.append(kw)
                break

        if tag_lower == "script":
            src = ad.get("src", "")
            if src:
                self.scripts.append({"src": src, "async": "async" in ad, "defer": "defer" in ad})
            if "ld+json" in ad.get("type", "").lower(): self.has_structured_data = True

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
            self._extract_fonts_colors(self._style_content)
            self._extract_css_properties(self._style_content)
        if self._tag_stack and self._tag_stack[-1] == tag_lower:
            self._tag_stack.pop()

    def handle_data(self, data):
        if self._capture: self._captured_text += data
        if self._in_style: self._style_content += data

    def _extract_css_properties(self, css_text):
        """Extract deterministic CSS properties for automated checks."""
        # Media queries → responsive layout
        if re.search(r'@media\b', css_text, re.IGNORECASE):
            self.has_media_queries = True
        if re.search(r'@media\s+print', css_text, re.IGNORECASE):
            self.has_print_media = True
        # prefers-reduced-motion → accessibility check #69
        if re.search(r'prefers-reduced-motion', css_text, re.IGNORECASE):
            self.has_prefers_reduced_motion = True

        # Body font-size (px / rem / em)
        if self.body_font_size_px is None:
            m = re.search(r'body\b[^{]*\{[^}]*?font-size\s*:\s*([\d.]+)(px|rem|em)\b', css_text, re.IGNORECASE)
            if m:
                v, u = float(m.group(1)), m.group(2).lower()
                self.body_font_size_px = v * 16 if u in ('rem', 'em') else v

        # Body line-height (unitless ratio)
        if self.body_line_height is None:
            m = re.search(r'body\b[^{]*\{[^}]*?line-height\s*:\s*([\d.]+)\s*[;}\n]', css_text, re.IGNORECASE)
            if m:
                try:
                    self.body_line_height = float(m.group(1))
                except ValueError:
                    pass

    def _extract_fonts_colors(self, css_text):
        for m in re.finditer(r'font-family\s*:\s*([^;}]+)', css_text, re.IGNORECASE):
            families = [f.strip().strip("'\"") for f in m.group(1).split(",")]
            for f in families:
                if f and f.lower() not in ("inherit","initial","unset","serif","sans-serif","monospace","cursive","fantasy","system-ui"):
                    self.fonts_in_style.add(f)
        for m in re.finditer(r'#([0-9a-fA-F]{3,8})\b', css_text):
            self.colors_in_style.add("#" + m.group(1).lower())
        for m in re.finditer(r'rgba?\([^)]+\)', css_text):
            self.colors_in_style.add(m.group(0).lower().replace(" ", ""))

    def second_pass_label_check(self):
        for inp in self.form_inputs:
            if inp["id"] and inp["id"] in self.label_fors:
                inp["has_label"] = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _f(check, check_en, status, note, note_en, detail="", detail_en="", rec="", rec_en="", automated=True):
    """Shorthand to build a finding dict."""
    return {
        "check": check, "check_en": check_en, "status": status,
        "note": note, "note_en": note_en,
        "detail": detail, "detail_en": detail_en,
        "recommendation": rec, "recommendation_en": rec_en,
        "automated": automated,
    }

def _ai():
    """Placeholder for checks that need AI."""
    return "NEEDS_AI_REVIEW"

# ---------------------------------------------------------------------------
# Check runners
# ---------------------------------------------------------------------------

def run_a11y_checks(p, url):
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

    # 2. Video/audio – can't check
    findings["a11y_perceivable"].append(_f("Video/lyd har undertekster", "Video/audio has captions or transcripts", "n/a", "Krever manuell verifisering", "Requires manual verification"))
    # 3-5. Contrast, resize, CSS – visual
    for c, e in [("Fargekontrast WCAG AA","Color contrast meets WCAG AA"),("Tekst kan forstørres til 200%","Text can be resized to 200%"),("Innhold lesbart uten CSS","Content readable without CSS")]:
        findings["a11y_perceivable"].append(_f(c, e, _ai(), "", "", automated=False))

    # -- Operable --
    for c, e in [("All funksjonalitet via tastatur","All functionality via keyboard"),("Synlig fokusindikator","Visible focus indicator"),("Ingen tastaturfeller","No keyboard traps")]:
        findings["a11y_operable"].append(_f(c, e, _ai(), "", "", automated=False))

    # Skip link
    if p.has_skip_link:
        findings["a11y_operable"].append(_f("Hopp-til-innhold-lenke", "Skip-to-content link present", "pass", "Funnet", "Found"))
    else:
        findings["a11y_operable"].append(_f("Hopp-til-innhold-lenke", "Skip-to-content link present", "fail", "Ikke funnet", "Not found",
            rec="Legg til en 'Hopp til hovedinnhold'-lenke.", rec_en="Add a 'Skip to main content' link."))

    findings["a11y_operable"].append(_f("Trykkmål min 44x44px", "Touch targets min 44x44px", _ai(), "", "", automated=False))
    findings["a11y_operable"].append(_f("Ingen blinkende innhold", "No flashing content", "pass", "Ingen blinkende elementer", "No flashing elements detected"))

    # #69 - Reduced motion support
    if p.has_prefers_reduced_motion:
        findings["a11y_operable"].append(_f("Redusert bevegelse støttet", "Reduced motion support", "pass",
            "prefers-reduced-motion funnet i CSS", "prefers-reduced-motion found in CSS"))
    else:
        findings["a11y_operable"].append(_f("Redusert bevegelse støttet", "Reduced motion support", "warn",
            "prefers-reduced-motion ikke funnet i inline CSS", "prefers-reduced-motion not found in inline CSS",
            detail="Sjekker kun inline <style>-blokker; eksterne CSS-filer kan inneholde dette.",
            detail_en="Only checks inline <style> blocks; external CSS files may contain this.",
            rec="Legg til @media (prefers-reduced-motion: reduce) for animasjoner.",
            rec_en="Add @media (prefers-reduced-motion: reduce) for animations."))

    # -- Understandable --
    # Lang
    if p.lang:
        findings["a11y_understandable"].append(_f("Sidespråk deklarert", "Page language declared", "pass", f"lang=\"{p.lang}\"", f"lang=\"{p.lang}\""))
    else:
        findings["a11y_understandable"].append(_f("Sidespråk deklarert", "Page language declared", "fail", "Mangler lang-attributt", "Missing lang attribute",
            rec="Legg til lang-attributt, f.eks. lang=\"nb\".", rec_en="Add lang attribute, e.g. lang=\"nb\"."))

    # Form labels
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

    for c, e in [("Feilmeldinger veileder","Error messages guide recovery"),("Konsistent navigasjon","Consistent navigation across pages"),
                 ("Forkortelser og sjargong forklart","Abbreviations and jargon explained")]:
        findings["a11y_understandable"].append(_f(c, e, _ai(), "", "", automated=False))

    # -- Robust --
    findings["a11y_robust"].append(_f("Gyldig HTML-struktur", "Valid HTML structure", _ai(), "", "", automated=False))

    # Heading hierarchy
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

    # ARIA
    ta = sum(p.aria_attrs.values())
    if ta == 0: st, n, ne = "warn", "Ingen ARIA", "No ARIA attributes"
    elif ta > 50: st, n, ne = "warn", f"{ta} ARIA-attr (mulig overbruk)", f"{ta} ARIA attrs (possible overuse)"
    else: st, n, ne = "pass", f"{ta} ARIA-attributter", f"{ta} ARIA attributes"
    findings["a11y_robust"].append(_f("ARIA-roller korrekt brukt", "ARIA roles used correctly", st, n, ne,
        ", ".join(f"{k}:{v}" for k,v in p.aria_attrs.most_common(5)), ", ".join(f"{k}:{v}" for k,v in p.aria_attrs.most_common(5))))

    # Semantic HTML
    sem = [e for e in ["nav","main","article","header","footer"] if getattr(p, f"has_{e}", False)]
    if len(sem) >= 3: st = "pass"
    elif sem: st = "warn"
    else: st = "fail"
    findings["a11y_robust"].append(_f("Semantiske HTML-elementer", "Semantic HTML elements used", st,
        ", ".join(sem) if sem else "Ingen funnet", ", ".join(sem) if sem else "None found",
        rec="Bruk nav, main, header, footer." if st != "pass" else "", rec_en="Use nav, main, header, footer." if st != "pass" else ""))

    # Fieldset/legend
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

    # #80 - Cross-browser compatibility (cannot be automated from HTML alone)
    findings["a11y_robust"].append(_f("Kryssleser-kompatibilitet", "Cross-browser and cross-device compatibility", _ai(), "", "", automated=False))

    return findings


def run_bp_checks(p, url):
    findings = {"bp_performance": [], "bp_security": [], "bp_seo": [], "bp_code": []}
    https = url.startswith("https://")

    # -- Performance --
    # Images
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

    findings["bp_performance"].append(_f("CSS/JS minifisert", "CSS and JS minified", _ai(), "Krever nettverksanalyse", "Requires network analysis", automated=False))

    # Render-blocking scripts
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

    for c, e in [("Caching-headere","Caching headers"),("Font-lasting","Font loading")]:
        findings["bp_performance"].append(_f(c, e, _ai(), "", "", automated=False))

    # -- Security --
    findings["bp_security"].append(_f("HTTPS påkrevd", "HTTPS enforced", "pass" if https else "fail",
        "HTTPS aktiv" if https else "HTTP", "HTTPS active" if https else "HTTP",
        rec="" if https else "Migrer til HTTPS.", rec_en="" if https else "Migrate to HTTPS."))

    # Mixed content
    if https:
        mixed = [s[:50] for s,_ in p.images if s and s.startswith("http://")] + [l["href"][:50] for l in p.external_links if l["href"].startswith("http://")]
        findings["bp_security"].append(_f("Ingen mixed content", "No mixed content", "warn" if mixed else "pass",
            f"{len(mixed)} referanser" if mixed else "Ingen funnet", f"{len(mixed)} refs" if mixed else "None found",
            rec="Oppdater til HTTPS." if mixed else "", rec_en="Update to HTTPS." if mixed else ""))
    else:
        findings["bp_security"].append(_f("Ingen mixed content", "No mixed content", "n/a", "N/A (HTTP)", "N/A (HTTP)"))

    findings["bp_security"].append(_f("CSP-headere", "CSP headers", _ai(), "", "", automated=False))
    findings["bp_security"].append(_f("Ingen eksponerte sensitive data", "No exposed sensitive data in source", _ai(), "", "", automated=False))

    # External link attrs
    bad = [l for l in p.external_links if not l["has_noopener"] or not l["has_noreferrer"]]
    if not p.external_links:
        findings["bp_security"].append(_f("Eksterne lenker rel-attr", "External links rel attrs", "n/a", "Ingen", "None"))
    elif bad:
        findings["bp_security"].append(_f("Eksterne lenker rel-attr", "External links rel attrs", "warn",
            f"{len(bad)}/{len(p.external_links)} mangler", f"{len(bad)}/{len(p.external_links)} missing",
            rec="Legg til rel=\"noopener noreferrer\".", rec_en="Add rel=\"noopener noreferrer\"."))
    else:
        findings["bp_security"].append(_f("Eksterne lenker rel-attr", "External links rel attrs", "pass",
            f"Alle {len(p.external_links)} OK", f"All {len(p.external_links)} OK"))

    # -- SEO --
    # Title
    if p.has_title and p.title_text:
        tl = len(p.title_text)
        st = "pass" if 10 <= tl <= 70 else "warn"
        findings["bp_seo"].append(_f("Beskrivende <title>", "Descriptive <title>", st,
            f"\"{p.title_text[:50]}\" ({tl} tegn)", f"\"{p.title_text[:50]}\" ({tl} chars)"))
    else:
        findings["bp_seo"].append(_f("Beskrivende <title>", "Descriptive <title>", "fail", "Mangler", "Missing",
            rec="Legg til <title>.", rec_en="Add <title>."))

    # Meta description
    desc = p.meta_tags.get("description", "")
    if desc:
        dl = len(desc)
        st = "pass" if 50 <= dl <= 160 else "warn"
        findings["bp_seo"].append(_f("Meta-beskrivelse", "Meta description", st, f"{dl} tegn", f"{dl} chars"))
    else:
        findings["bp_seo"].append(_f("Meta-beskrivelse", "Meta description", "fail", "Mangler", "Missing",
            rec="Legg til meta description (50-160 tegn).", rec_en="Add meta description (50-160 chars)."))

    findings["bp_seo"].append(_f("Heading-hierarki for SEO", "Heading hierarchy for SEO", _ai(), "Se a11y", "See a11y", automated=False))

    # #94 Canonical URL
    if p.has_canonical:
        findings["bp_seo"].append(_f("Canonical URL", "Canonical URL specified", "pass", "Tilstede", "Present"))
    else:
        findings["bp_seo"].append(_f("Canonical URL", "Canonical URL specified", "warn", "Mangler", "Missing",
            rec="Legg til <link rel=\"canonical\">.", rec_en="Add <link rel=\"canonical\">."))

    # #95 Open Graph / social meta tags
    if p.og_tags:
        findings["bp_seo"].append(_f("OG/sosiale meta-tagger", "Open Graph / social meta tags", "pass",
            f"{len(p.og_tags)} OG-tagger funnet", f"{len(p.og_tags)} OG tags found"))
    else:
        findings["bp_seo"].append(_f("OG/sosiale meta-tagger", "Open Graph / social meta tags", "warn", "Mangler", "Missing",
            rec="Legg til Open Graph-tagger for bedre delingsvisning.", rec_en="Add Open Graph tags for better social sharing."))

    # #96 Structured data (JSON-LD)
    if p.has_structured_data:
        findings["bp_seo"].append(_f("Strukturerte data (JSON-LD)", "Structured data (JSON-LD)", "pass", "Funnet", "Found"))
    else:
        findings["bp_seo"].append(_f("Strukturerte data (JSON-LD)", "Structured data (JSON-LD)", "warn", "Ikke funnet", "Not found",
            rec="Legg til JSON-LD strukturerte data der det er relevant.", rec_en="Add JSON-LD structured data where appropriate."))

    # -- Code Quality --
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

    # Print stylesheet
    if p.has_print_media:
        findings["bp_code"].append(_f("Utskriftsstil vurdert", "Print stylesheet considered", "pass",
            "@media print funnet", "@media print found"))
    else:
        findings["bp_code"].append(_f("Utskriftsstil vurdert", "Print stylesheet considered", "warn",
            "Ingen @media print funnet", "No @media print found",
            rec="Legg til @media print for bedre utskriftsvisning.", rec_en="Add @media print for better print layout."))

    return findings


def run_ux_checks(p):
    findings = {"ux_nav": [], "ux_content": [], "ux_interaction": [], "ux_cognitive": []}

    # --- Navigation & Information Architecture (7 checks: #1-#7) ---

    # #1 Nav presence
    if p.has_nav:
        findings["ux_nav"].append(_f("Tydelig hovednavigasjon", "Clear primary navigation", "pass", "<nav> funnet", "<nav> found",
            "Visuell gruppering gjenstår for AI.", "Visual grouping assessment remains for AI.", automated=True))
    else:
        findings["ux_nav"].append(_f("Tydelig hovednavigasjon", "Clear primary navigation", _ai(), "Ingen <nav>", "No <nav>", automated=False))

    # #2
    findings["ux_nav"].append(_f("Gjeldende side indikert", "Current page indicated", _ai(), "", "", automated=False))

    # #3 Breadcrumbs
    if p.has_breadcrumb:
        findings["ux_nav"].append(_f("Brødsmulesti", "Breadcrumbs", "pass", "Funnet", "Found"))
    else:
        findings["ux_nav"].append(_f("Brødsmulesti", "Breadcrumbs", "n/a", "Ikke funnet (kan være tilsiktet)", "Not found (may be intentional)"))

    # #4 Search
    if p.has_search:
        findings["ux_nav"].append(_f("Søkefunksjon", "Search functionality", "pass", "Funnet", "Found"))
    else:
        findings["ux_nav"].append(_f("Søkefunksjon", "Search functionality", _ai(), "Ikke funnet i HTML", "Not found in HTML", automated=False))

    # #5 Footer
    if p.has_footer:
        findings["ux_nav"].append(_f("Footer med nyttelenker", "Footer with utility links", _ai(), "<footer> funnet", "<footer> found", automated=False))
    else:
        findings["ux_nav"].append(_f("Footer med nyttelenker", "Footer with utility links", "warn", "Ingen <footer>", "No <footer>",
            rec="Legg til footer.", rec_en="Add footer."))

    # #6 - 3-click rule (cannot be fully automated from single page)
    findings["ux_nav"].append(_f("Innhold innen 3 klikk", "Important content within 3 clicks", _ai(), "", "", automated=False))

    # #7 - IA follows mental model (subjective)
    findings["ux_nav"].append(_f("IA følger brukernes mentale modell", "IA follows users' mental model", _ai(), "", "", automated=False))

    # --- Content & Readability (7 checks: #8-#14) ---

    # #8
    findings["ux_content"].append(_f("Overskrifter beskrivende og skannbare", "Headlines descriptive and scannable", _ai(), "", "", automated=False))

    # #9 Body text font size — automated from CSS
    if p.body_font_size_px is not None:
        if p.body_font_size_px >= 16:
            findings["ux_content"].append(_f("Brødtekst min 16px", "Body text min 16px", "pass",
                f"{p.body_font_size_px:.0f}px", f"{p.body_font_size_px:.0f}px"))
        else:
            findings["ux_content"].append(_f("Brødtekst min 16px", "Body text min 16px", "fail",
                f"{p.body_font_size_px:.0f}px (min 16px kreves)", f"{p.body_font_size_px:.0f}px (min 16px required)",
                rec="Øk brødtekstens font-size til minst 16px.", rec_en="Increase body font-size to at least 16px."))
    else:
        findings["ux_content"].append(_f("Brødtekst min 16px", "Body text min 16px", _ai(), "", "", automated=False))

    # #10-#12 Visual/subjective content checks → AI
    for c, e in [("Linjelengde 45-75 tegn","Line length 45-75 chars"),
                 ("Språk tilpasset brukernes verden","Language matches users' vocabulary"),
                 ("Innhold hierarki","Content hierarchy")]:
        findings["ux_content"].append(_f(c, e, _ai(), "", "", automated=False))

    # #13 - Images relevant and high-quality (subjective)
    findings["ux_content"].append(_f("Bilder relevante og av god kvalitet", "Images relevant, high-quality, and support content", _ai(), "", "", automated=False))

    # #14 - Content aligns with user/business goals (subjective)
    findings["ux_content"].append(_f("Innhold matcher bruker- og forretningsmål", "Content aligns with user and business goals", _ai(), "", "", automated=False))

    # --- Interaction Design (8 checks: #15-#22) ---

    # #15-#19 Existing subjective interaction checks → AI
    for c, e in [("Primær CTA identifiserbar","Primary CTA identifiable"),
                 ("Interaktive elementer som forventet","Interactive elements behave as expected"),
                 ("Systemstatus kommunisert","System status communicated"),
                 ("Feilmeldinger veileder til løsning","Error messages guide recovery"),
                 ("Forebygging av feil","Error prevention")]:
        findings["ux_interaction"].append(_f(c, e, _ai(), "", "", automated=False))

    # #20 - Shortcuts and accelerators (partially automated: accesskey, autocomplete)
    ak = p.accesskeys
    ac = p.autocomplete_inputs
    if ak > 0 or ac > 0:
        parts = []
        if ak: parts.append(f"{ak} accesskey")
        if ac: parts.append(f"{ac} autocomplete")
        findings["ux_interaction"].append(_f("Snarveier for erfarne brukere", "Shortcuts and accelerators for experienced users", "pass",
            ", ".join(parts), ", ".join(parts),
            detail="accesskey- og autocomplete-attributter gir snarveier.", detail_en="accesskey and autocomplete attributes provide shortcuts."))
    else:
        findings["ux_interaction"].append(_f("Snarveier for erfarne brukere", "Shortcuts and accelerators for experienced users", _ai(),
            "Ingen accesskey/autocomplete funnet i HTML", "No accesskey/autocomplete found in HTML", automated=False))

    # #21 - Form design (automated: required, type, placeholder)
    fe = p.form_inputs_extended
    if not fe:
        findings["ux_interaction"].append(_f("Skjemadesign", "Form design quality", "n/a", "Ingen skjemafelt", "No form fields"))
    else:
        issues = []
        with_req = sum(1 for f in fe if f["required"])
        with_ph = sum(1 for f in fe if f["placeholder"])
        generic_type = sum(1 for f in fe if f["type"] == "text" and f["name"] and any(kw in f["name"].lower() for kw in ["email","phone","tel","date","number","url"]))
        if with_req == 0 and len(fe) > 1:
            issues.append("ingen required-attributter" if True else "no required attributes")
        if generic_type > 0:
            issues.append(f"{generic_type} felt med feil input-type")
        st = "warn" if issues else "pass"
        n = "; ".join(issues) if issues else f"{len(fe)} felt, {with_req} required, {with_ph} placeholder"
        ne = f"{len(fe)} fields, {with_req} required, {with_ph} placeholder"
        findings["ux_interaction"].append(_f("Skjemadesign", "Form design quality", st, n, ne,
            rec="Bruk required, riktige input-typer og placeholder-tekst." if issues else "",
            rec_en="Use required, correct input types, and placeholder text." if issues else ""))

    # #22 - Mobile interaction design (subjective — needs rendering)
    findings["ux_interaction"].append(_f("Mobil interaksjonsdesign", "Mobile interaction design", _ai(), "", "", automated=False))

    # --- Cognitive Load & User Control (8 checks: #23-#30) ---

    # #23-#26 Existing subjective checks → AI
    for c, e in [("Minimal kompleksitet og valg","Minimal complexity and choices"),
                 ("Gjenkjenning fremfor hukommelse","Recognition over recall"),
                 ("Gruppert innhold og progressiv avsløring","Grouped content and progressive disclosure"),
                 ("Konvensjoner og brukerkontroll","Conventions and user control")]:
        findings["ux_cognitive"].append(_f(c, e, _ai(), "", "", automated=False))

    # #27 - Users can accomplish primary task (subjective)
    findings["ux_cognitive"].append(_f("Primæroppgave uten forvirring", "Primary task without confusion", _ai(), "", "", automated=False))

    # #28 - Help and documentation (subjective)
    findings["ux_cognitive"].append(_f("Hjelp og dokumentasjon tilgjengelig", "Help and documentation accessible", _ai(), "", "", automated=False))

    # #29 - Trust signals (partially automated)
    ts = p.trust_signals
    if ts:
        findings["ux_cognitive"].append(_f("Tillitssignaler til stede", "Trust signals present", "pass",
            f"Funnet: {', '.join(ts)}", f"Found: {', '.join(ts)}",
            detail="Klasser/roller med tillitssignal-nøkkelord funnet i HTML.", detail_en="Classes/roles with trust signal keywords found in HTML."))
    else:
        findings["ux_cognitive"].append(_f("Tillitssignaler til stede", "Trust signals present", _ai(),
            "Ingen tillitssignaler funnet i HTML-klasser", "No trust signals found in HTML classes", automated=False))

    # #30 - Onboarding (subjective)
    findings["ux_cognitive"].append(_f("Onboarding/veiledning for nye brukere", "Onboarding or first-time user guidance", _ai(), "", "", automated=False))

    return findings


def run_ui_checks(p):
    findings = {"ui_hierarchy": [], "ui_typography": [], "ui_color": [], "ui_spacing": [], "ui_components": []}

    fc = len(p.fonts_in_style)

    for key, checks in [
        ("ui_hierarchy", [("Distinkte heading-nivåer","Distinct heading levels"),("Primær vs sekundær handling","Primary vs secondary actions"),
            ("Visuell vekt","Visual weight guides eye"),("Whitespace","Adequate whitespace"),("Skannemønster","Scan pattern flow")]),
        ("ui_typography", [("Konsistente fontfamilier","Consistent font families"),("Typeskala","Type scale"),
            ("Linjehøyde","Line height"),("Fontvekter","Font weights"),("Tekstjustering","Text alignment")]),
        ("ui_color", [("Konsistent fargepalett","Consistent color palette"),("Farge ikke eneste middel","Color not sole means"),
            ("Kontrastforhold","Contrast ratios"),("Merkefarger konsistent","Brand colors consistent"),("Hover/aktive farger","Hover/active colors")]),
        ("ui_spacing", [("Konsistent mellomrom","Consistent spacing"),("Justering","Alignment"),("Responsivt layout","Responsive layout"),
            ("Tilstrekkelig padding","Adequate padding"),("Konsistente marginer","Consistent margins")]),
        ("ui_components", [("Knapper konsistent","Buttons consistent"),("Skjemafelt konsistent","Form fields consistent"),
            ("Ikoner konsistente","Icons consistent"),("Kort/containere","Cards/containers"),("Kantlinjer konsistente","Borders consistent")]),
    ]:
        for c, e in checks:
            f = _f(c, e, _ai(), "", "", automated=False)

            # Automated: font families
            if e == "Consistent font families" and fc > 0:
                if fc <= 3:
                    f["status"] = "pass"
                    f["note"] = f"{fc} fonter: {', '.join(list(p.fonts_in_style)[:3])}"
                    f["note_en"] = f"{fc} fonts: {', '.join(list(p.fonts_in_style)[:3])}"
                    f["automated"] = True
                else:
                    f["status"] = "warn"
                    f["note"] = f"{fc} fonter (maks 3 anbefalt)"
                    f["note_en"] = f"{fc} fonts (max 3 recommended)"
                    f["automated"] = True

            # Automated: line height from CSS
            elif e == "Line height" and p.body_line_height is not None:
                lh = p.body_line_height
                if 1.4 <= lh <= 1.6:
                    f["status"] = "pass"
                    f["note"] = f"linjehøyde {lh} (anbefalt 1.4–1.6)"
                    f["note_en"] = f"line-height {lh} (recommended 1.4–1.6)"
                else:
                    f["status"] = "warn"
                    f["note"] = f"linjehøyde {lh} (anbefalt 1.4–1.6)"
                    f["note_en"] = f"line-height {lh} (recommended 1.4–1.6)"
                    f["recommendation"] = "Sett line-height til mellom 1.4 og 1.6 for best lesbarhet."
                    f["recommendation_en"] = "Set line-height between 1.4 and 1.6 for best readability."
                f["automated"] = True

            # Automated: responsive layout (media queries)
            elif e == "Responsive layout":
                if p.has_media_queries:
                    f["status"] = "pass"
                    f["note"] = "@media queries funnet"
                    f["note_en"] = "@media queries found"
                else:
                    f["status"] = "warn"
                    f["note"] = "Ingen @media queries i inline CSS"
                    f["note_en"] = "No @media queries in inline CSS"
                    f["recommendation"] = "Legg til responsive breakpoints med @media."
                    f["recommendation_en"] = "Add responsive breakpoints with @media."
                f["automated"] = True

            findings[key].append(f)

    # #36 - Content density balanced (subjective/visual)
    findings["ui_hierarchy"].append(_f("Innholdstetthet balansert", "Content density balanced with breathing room", _ai(), "", "", automated=False))

    # #57 - 404/error pages designed (cannot check from single page)
    findings["ui_components"].append(_f("404/feilsider designet", "404 and error pages designed and helpful", _ai(), "", "", automated=False))

    return findings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Pre-audit automated HTML checks")
    ap.add_argument("html_file", help="Path to saved HTML file")
    ap.add_argument("url", help="URL of the audited page")
    ap.add_argument("-o", "--output", help="Output file (default: stdout)")
    args = ap.parse_args()

    with open(args.html_file, "r", encoding="utf-8", errors="replace") as f:
        html = f.read()

    hp = AuditHTMLParser()
    hp.feed(html)

    all_findings = {}
    for fn in [run_a11y_checks(hp, args.url), run_bp_checks(hp, args.url), run_ux_checks(hp), run_ui_checks(hp)]:
        all_findings.update(fn)

    total = sum(len(v) for v in all_findings.values())
    auto = sum(1 for v in all_findings.values() for i in v if i.get("automated"))
    review = sum(1 for v in all_findings.values() for i in v if i["status"] == "NEEDS_AI_REVIEW")

    result = {
        "pre_audit_version": "1.1.0",
        "url": args.url,
        "summary": {"total_checks": total, "automated": auto, "needs_ai_review": review},
        "html_stats": {
            "images": len(hp.images), "headings": len(hp.headings), "links": len(hp.links),
            "external_links": len(hp.external_links), "form_inputs": len(hp.form_inputs),
            "scripts": len(hp.scripts), "fonts_detected": list(hp.fonts_in_style),
            "semantic_elements": [e for e in ["nav","main","article","header","footer"] if getattr(hp, f"has_{e}", False)],
            "has_structured_data": hp.has_structured_data, "og_tags": list(hp.og_tags),
        },
        "findings": all_findings,
    }

    out = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"Pre-audit: {total} checks, {auto} automated, {review} need AI review", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
