/**
 * Report Builder — assembles the final HTML report from audit data.
 *
 * Combines three data sources:
 *   1. pageSpeedData — PageSpeed Insights scores and metrics (desktop + mobile)
 *   2. claudeData    — merged pre-audit + Claude findings (101 checks)
 *   3. report-template.html — base HTML structure with {{PLACEHOLDER}} tokens
 *
 * Key responsibilities:
 *   - Calculates domain scores (UX, UI, Accessibility, Best Practices)
 *   - Generates SVG ring gauges, stacked bars, metric progress bars
 *   - Translates PageSpeed Insights audit IDs to Norwegian titles and descriptions
 *   - Renders all 101 finding rows (expandable, with Norwegian + English toggle)
 *   - Embeds brand fonts as base64 data URIs → report is fully self-contained
 *   - Escapes all user-controlled content to prevent XSS in the report HTML
 *
 * Exports:
 *   buildReport(pageSpeedData, claudeData, url) → HTML string
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Helper functions =====

function gaugeClass(score) {
  if (score >= 90) return 'good';
  if (score >= 50) return 'needs-improvement';
  return 'poor';
}

function ratingText(score) {
  if (score >= 90) return '<span data-no="Bra" data-en="Good">Bra</span>';
  if (score >= 50) return '<span data-no="Trenger forbedring" data-en="Needs Improvement">Trenger forbedring</span>';
  return '<span data-no="Svak" data-en="Poor">Svak</span>';
}

function dashOffset(score) {
  return (204.2 - (score / 100 * 204.2)).toFixed(1);
}

function needleDeg(score) {
  return (-90 + (score / 100 * 180)).toFixed(1);
}

function ringOffset(score) {
  return (263.9 - (score / 100 * 263.9)).toFixed(1);
}

function metricBarClass(metricId, value) {
  const thresholds = {
    fcp: { good: 1800, poor: 3000 },
    lcp: { good: 2500, poor: 4000 },
    tbt: { good: 200, poor: 600 },
    cls: { good: 0.1, poor: 0.25 },
    si: { good: 3400, poor: 5800 },
  };
  const t = thresholds[metricId];
  if (!t) return 'good';
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

function metricBarPct(metricId, value) {
  // Bar width as % of "poor" threshold (capped at 100)
  const poorThresholds = { fcp: 3000, lcp: 4000, tbt: 600, cls: 0.25, si: 5800 };
  const poor = poorThresholds[metricId] || 1;
  return Math.min(100, Math.round((value / poor) * 100));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Domain score calculation =====

function calculateDomainScores(domainFindings) {
  let pass = 0, warn = 0, fail = 0, na = 0;
  for (const subcategory of Object.values(domainFindings)) {
    if (!Array.isArray(subcategory)) continue;
    for (const finding of subcategory) {
      switch (finding.status) {
        case 'pass': pass++; break;
        case 'warn': warn++; break;
        case 'fail': fail++; break;
        default: na++; break;
      }
    }
  }
  const applicable = pass + warn + fail;
  const score = applicable > 0 ? Math.round((pass / applicable) * 100) : 0;
  return { pass, warn, fail, na, score, applicable };
}

// ===== Generate finding rows HTML =====

function generateFindingRows(findings) {
  if (!Array.isArray(findings)) return '';
  return findings.map(f => {
    const statusClass = f.status || 'na';
    const statusLabels = { pass: ['BESTÅTT', 'PASS'], warn: ['ADVARSEL', 'WARN'], fail: ['FEIL', 'FAIL'], na: ['I/A', 'N/A'] };
    const [statusLabelNo, statusLabelEn] = statusLabels[statusClass] || ['I/A', 'N/A'];
    const noteNo = escapeHtml(f.note_no || f.note || '');
    const noteEn = escapeHtml(f.note_en || f.note || '');
    const detailsNo = f.details_no || f.details || '';
    const detailsEn = f.details_en || f.details || '';
    const recNo = f.recommendation_no || f.recommendation || '';
    const recEn = f.recommendation_en || f.recommendation || '';
    const checkNameNo = escapeHtml(f.check_no || f.check || '');
    const checkNameEn = escapeHtml(f.check_en || f.check || '');

    const hasDetail = !!(detailsNo || recNo);
    let detailHtml = '';
    if (hasDetail) {
      detailHtml = `<tr class="finding-detail">
  <td colspan="3">
    <div class="detail-label" data-no="Detaljer:" data-en="Details:">Detaljer:</div>
    <p data-no="${escapeHtml(detailsNo)}" data-en="${escapeHtml(detailsEn)}">${escapeHtml(detailsNo)}</p>
    ${recNo ? `<div class="detail-recommendation">
      <div class="detail-label" data-no="Anbefaling:" data-en="Recommendation:">Anbefaling:</div>
      <p data-no="${escapeHtml(recNo)}" data-en="${escapeHtml(recEn)}">${escapeHtml(recNo)}</p>
    </div>` : ''}
  </td>
</tr>`;
    }

    const expandClass = hasDetail ? 'expand-icon' : 'expand-icon no-expand';
    const rowClass = hasDetail ? 'finding-row' : 'finding-row no-expand-row';
    const onclickAttr = hasDetail ? ' onclick="toggleDetail(this)"' : '';
    return `<tr class="${rowClass}"${onclickAttr}>
  <td><span class="${expandClass}"></span> <span data-no="${checkNameNo}" data-en="${checkNameEn}">${checkNameNo}</span></td>
  <td><span class="status ${statusClass}" data-no="${statusLabelNo}" data-en="${statusLabelEn}">${statusLabelNo}</span></td>
  <td class="notes" data-no="${noteNo}" data-en="${noteEn}">${noteNo}</td>
</tr>
${detailHtml}`;
  }).join('\n');
}

// ===== Generate stacked bars HTML =====

const DOMAIN_LABEL_TRANSLATIONS = {
  'Tilgjengelighet': 'Accessibility',
  'Beste praksis': 'Best Practices',
};

function generateStackedBars(domains) {
  const bars = Object.entries(domains).map(([name, data]) => {
    const total = data.pass + data.warn + data.fail + data.na;
    if (total === 0) return '';
    const passPct = Math.round(data.pass / total * 100);
    const warnPct = Math.round(data.warn / total * 100);
    const failPct = Math.round(data.fail / total * 100);
    const naPct = 100 - passPct - warnPct - failPct;
    const enName = DOMAIN_LABEL_TRANSLATIONS[name];
    const labelHtml = enName
      ? `<p class="stacked-bar-row-label" data-no="${escapeHtml(name)}" data-en="${escapeHtml(enName)}">${escapeHtml(name)}</p>`
      : `<p class="stacked-bar-row-label">${escapeHtml(name)}</p>`;

    return `${labelHtml}
<div class="stacked-bar">
  ${passPct > 0 ? `<div class="bar-segment bar-pass" style="width:${passPct}%">${data.pass}</div>` : ''}
  ${warnPct > 0 ? `<div class="bar-segment bar-warn" style="width:${warnPct}%">${data.warn}</div>` : ''}
  ${failPct > 0 ? `<div class="bar-segment bar-fail" style="width:${failPct}%">${data.fail}</div>` : ''}
  ${naPct > 0 ? `<div class="bar-segment bar-na" style="width:${naPct}%">${data.na}</div>` : ''}
</div>`;
  });

  return bars.join('\n');
}

// ===== Generate metric bars HTML =====

function generateMetricBars(metrics) {
  const labels = {
    fcp: 'FCP (First Contentful Paint)',
    lcp: 'LCP (Largest Contentful Paint)',
    tbt: 'TBT (Total Blocking Time)',
    cls: 'CLS (Cumulative Layout Shift)',
    si: 'SI (Speed Index)',
  };

  return Object.entries(labels).map(([id, label]) => {
    const m = metrics[id];
    if (!m) return '';
    const barClass = metricBarClass(id, m.value);
    const barPct = metricBarPct(id, m.value);
    return `<div class="metric-bar-row">
  <div class="metric-bar-label">${label}</div>
  <div class="metric-bar-track">
    <div class="metric-bar-fill ${barClass}" style="width:${barPct}%">${m.displayValue}</div>
  </div>
</div>`;
  }).join('\n');
}

// ===== PageSpeed Insights audit ID translations =====

const LH_DESCRIPTIONS_NO = {
  'render-blocking-resources': 'Ressurser blokkerer siden fra å lastes raskt. Vurder å utsette eller inline disse.',
  'unused-css-rules': 'CSS som ikke brukes på siden lastes ned unødvendig og senker ytelsen.',
  'unused-javascript': 'JavaScript som ikke brukes på siden lastes ned unødvendig og senker ytelsen.',
  'uses-responsive-images': 'Bilder er større enn nødvendig for skjermstørrelsen. Bruk responsive bilder.',
  'offscreen-images': 'Bilder utenfor skjermen lastes inn unødvendig tidlig. Bruk lazy loading.',
  'uses-optimized-images': 'Bildene kan komprimeres ytterligere uten synlig kvalitetstap.',
  'uses-webp-images': 'Moderne bildeformater som WebP og AVIF gir bedre komprimering enn JPEG/PNG.',
  'uses-text-compression': 'Tekst-ressurser bør komprimeres med gzip eller brotli for raskere overføring.',
  'server-response-time': 'Serveren bruker for lang tid på å svare. Vurder optimalisering av server eller CDN.',
  'bootup-time': 'JavaScript-kjøringen tar for lang tid og blokkerer siden.',
  'mainthread-work-breakdown': 'Nettleseren bruker for mye tid på å behandle siden.',
  'dom-size': 'Siden har for mange HTML-elementer, noe som gjør den tregere å behandle.',
  'total-byte-weight': 'Den totale størrelsen på alle ressurser er for stor. Komprimer eller fjern unødvendige ressurser.',
  'uses-long-cache-ttl': 'Ressurser mangler god hurtigbufferpolicy, noe som gjør gjentatte besøk tregere.',
  'unminified-css': 'CSS-filer er ikke minifisert. Fjern unødvendige mellomrom og kommentarer.',
  'unminified-javascript': 'JavaScript-filer er ikke minifisert. Fjern unødvendige mellomrom og kommentarer.',
  'image-alt': 'Bilder mangler alternativ tekst, noe som gjør siden utilgjengelig for skjermlesere.',
  'button-name': 'Knapper mangler et tilgjengelig navn som skjermlesere kan lese opp.',
  'color-contrast': 'Tekstfargen har ikke tilstrekkelig kontrast mot bakgrunnen for god lesbarhet.',
  'heading-order': 'Overskriftsnivåene er ikke i logisk rekkefølge, noe som forvirrer skjermlesere.',
  'html-has-lang': 'HTML-elementet mangler et lang-attributt som angir sidens språk.',
  'label': 'Skjemafelt mangler tilknyttede etiketter, noe som gjør dem utilgjengelige.',
  'link-name': 'Lenker mangler et tilgjengelig navn som beskriver destinasjonen.',
  'meta-description': 'Siden mangler en metabeskrivelse som vises i søkeresultater.',
  'document-title': 'Siden mangler en tittel som vises i nettleserfanen og søkeresultater.',
  'is-crawlable': 'Siden er blokkert fra å bli indeksert av søkemotorer.',
  'link-text': 'Lenker har ikke beskrivende tekst — unngå "klikk her" og "les mer".',
  'font-display': 'Skrifter er ikke konfigurert for å vise tekst mens de lastes inn.',
  'uses-passive-event-listeners': 'Hendelseslyttere blokkerer rulling og gjør siden treig å scrolle.',
  'layout-shift-elements': 'Elementer forskyver seg under innlasting og forstyrrer brukeropplevelsen.',
  'image-delivery': 'Optimalisering av bildehåndtering kan forbedre opplevd lastetid og LCP.',
  'cache-ttl': 'Lang hurtigbufferlevetid kan fremskynde gjentatte besøk på siden.',
  'bf-cache': 'Siden er ikke optimalisert for tilbake/fremover-navigasjon og drar ikke nytte av hurtigbufferen.',
  'prioritize-lcp-image': 'LCP-bildet bør forhåndsinnlastes for å forbedre lastetiden for primærinnholdet.',
  'long-tasks': 'Lange JavaScript-oppgaver blokkerer siden og gjør den treig å bruke.',
  'preload-fonts': 'Forhåndsinnlasting av skrifttyper forhindrer usynlig tekst under lasting.',
  'third-party-cookies': 'Tredjeparts informasjonskapsler kan påvirke personvern og ytelse negativt.',
  'paste-preventing-inputs': 'Inndatafelt bør ikke hindre innliming av tekst — dette er frustrerende for brukere.',
  'network-requests': 'Mange nettverksforespørsler øker lastetiden. Vurder å slå sammen eller fjerne unødvendige forespørsler.',
  'network-server-latency': 'Høy serverlatens forsinker all kommunikasjon mellom nettleser og server.',
  'meta-viewport': 'Visningsporten er konfigurert til å blokkere zooming, noe som gjør siden vanskelig å lese for svaksynte.',
  'viewport': 'Siden mangler en meta viewport-tag, noe som gjør at den vises feil på mobil.',
  'tap-targets': 'Berøringsmål er for nærme hverandre og vanskelige å trykke nøyaktig på mobil.',
  'redirects': 'Siden har unødige omdirigeringer som forsinker lastingen unødvendig.',
  'uses-rel-preconnect': 'Tidlig tilkobling til nødvendige servere kan redusere lastetiden merkbart.',
  'uses-rel-preload': 'Nøkkelressurser bør forhåndsinnlastes for å unngå forsinkelser i kritisk innhold.',
  'uses-http2': 'Siden bruker ikke HTTP/2, som gir raskere parallell lasting av ressurser.',
  'efficiently-encoded-images': 'Bildene kan komprimeres bedre uten synlig kvalitetstap.',
  'critical-request-chains': 'Kjeding av kritiske forespørsler forsinker visningen av siden.',
  'canonical': 'Siden mangler en canonical-URL, noe som kan skade rangering i søkemotorer ved duplikatinnhold.',
  'hreflang': 'Siden mangler hreflang-tagger for å angi riktig språk og region for internasjonale brukere.',
  'robots-txt': 'robots.txt-filen er ugyldig eller feilkonfigurert, noe som kan påvirke søkemotorindeksering.',
  'structured-data': 'Strukturerte data er ugyldige, noe som kan begrense rike søkeresultater i Google.',
  'bypass': 'Siden mangler hopp-til-innhold-lenke, noe som gjør tastaturnavigasjon tungvint.',
  'duplicate-id-active': 'Aktive interaktive elementer har duplikat-ID, noe som kan forvirre hjelpeteknologi.',
  'duplicate-id-aria': 'ARIA-ID-er er ikke unike, noe som kan forvirre skjermlesere.',
  'aria-allowed-attr': 'ARIA-attributter samsvarer ikke med rollen til elementet.',
  'aria-required-attr': 'ARIA-roller mangler nødvendige attributter for å fungere korrekt.',
  'aria-roles': 'ARIA-rolleverdier er ugyldige og kan misforstås av hjelpeteknologi.',
  'aria-valid-attr': 'ARIA-attributter er ikke gyldige og kan skape problemer for skjermlesere.',
  'aria-valid-attr-value': 'ARIA-attributter har ugyldige verdier som kan forvirre hjelpeteknologi.',
  'legacy-javascript': 'Siden sender utdatert JavaScript til moderne nettlesere — unødvendig og tregt.',
  'js-libraries': 'Siden bruker utdaterte JavaScript-biblioteker med kjente sikkerhetsproblemer.',
  'lcp-lazy-loaded': 'Hovedbildet lastes med lazy loading, noe som forsinker den opplevde lastingen av siden.',
  'layout-shift-elements': 'Elementer forskyver seg under innlasting og forstyrrer brukeropplevelsen.',
  'inspector-issues': 'Nettleseren rapporterte problemer under lasting som kan påvirke funksjonalitet og rangering.',
  'image-aspect-ratio': 'Bilder vises i feil sideforhold, noe som gir et uprofesjonelt og forvrengt utseende.',
  'image-size-responsive': 'Bilder er ikke riktig størrelse for skjermen de vises på.',
  'valid-lang': 'Sidens lang-attributter er ikke gyldige, noe som kan forvirre skjermlesere.',
  'third-party-summary': 'Tredjepartskode fra eksterne tjenester forsinker lastingen og kan påvirke personvernet.',
  'third-party-facades': 'Noen tredjepartsressurser bør erstattes med en lettvekts fasade for raskere innlasting.',
  'no-document-write': 'Bruk av document.write() blokkerer parsing av siden og bremser lastingen.',
  'non-composited-animations': 'Animasjoner som ikke er kompositerte kan skape hakkete rulling og dårlig ytelse.',
  'total-tasks-time': 'Nettleseren bruker for lang tid på oppgaver, noe som gjør siden treg å bruke.',
  'connection-rtt': 'Høy nettverksforsinkelse gjør alle forespørsler mellom nettleser og server tregere.',
  'resource-summary': 'Antall og størrelse på ressurser er høyere enn anbefalt for god ytelse.',
  'no-unload-listeners': 'Siden bruker "unload"-lyttere som hindrer nettleseren fra å bufre siden effektivt.',
  'offscreen-content-hidden': 'Innhold utenfor skjermen er ikke skjult for hjelpeteknologi, noe som skaper støy for skjermlesere.',
};

const LH_TITLES_NO = {
  'render-blocking-resources': 'Fjern ressurser som blokkerer rendering',
  'unused-css-rules': 'Fjern ubrukt CSS',
  'unused-javascript': 'Fjern ubrukt JavaScript',
  'uses-responsive-images': 'Bruk responsive bilder',
  'offscreen-images': 'Utsett lasting av bilder utenfor skjermen',
  'uses-optimized-images': 'Optimaliser bilder',
  'uses-webp-images': 'Bruk neste generasjons bildeformater',
  'efficiently-encoded-images': 'Kodingseffektivitet for bilder',
  'uses-text-compression': 'Aktiver tekstkomprimering',
  'uses-rel-preconnect': 'Forhåndstilkoble til nødvendige opprinnelser',
  'server-response-time': 'Reduser serverresponstid (TTFB)',
  'redirects': 'Unngå unødige omdirigeringer',
  'uses-rel-preload': 'Forhåndsinnlast nøkkelforespørsler',
  'uses-http2': 'Bruk HTTP/2',
  'bootup-time': 'Reduser JavaScript-utføringstid',
  'mainthread-work-breakdown': 'Minimer hovedtrådsarbeid',
  'dom-size': 'Unngå et for stort DOM',
  'critical-request-chains': 'Unngå å kjede kritiske forespørsler',
  'total-byte-weight': 'Unngå for store nettverksbelastninger',
  'uses-long-cache-ttl': 'Bruk effektiv hurtigbufferpolicy',
  'unminified-css': 'Minifiser CSS',
  'unminified-javascript': 'Minifiser JavaScript',
  'image-alt': 'Bilder mangler alt-tekst',
  'button-name': 'Knapper mangler tilgjengelig navn',
  'color-contrast': 'Bakgrunns- og forgrunnsfarger mangler tilstrekkelig kontrast',
  'document-title': 'Dokument mangler <title>-element',
  'frame-title': 'Rammer mangler tittel',
  'heading-order': 'Overskriftsrekkefølge er ikke logisk',
  'html-has-lang': '<html>-element mangler lang-attributt',
  'label': 'Skjemaelementer mangler tilknyttede etiketter',
  'link-name': 'Lenker mangler tilgjengelig navn',
  'meta-description': 'Dokument mangler metabeskrivelse',
  'meta-viewport': 'Visningsport deaktiverer brukerskalering',
  'tap-targets': 'Berøringsmål er for nærme hverandre',
  'font-display': 'Teksten forblir ikke synlig under skriftinnlasting',
  'image-delivery': 'Forbedre bildehåndtering',
  'cache-ttl': 'Bruk effektiv hurtigbufferpolicy',
  'bf-cache': 'Siden er ikke tilbake/fremover-hurtigbuffer-kompatibel',
  'prioritize-lcp-image': 'Forhåndsinnlast LCP-bildet',
  'long-tasks': 'Lange oppgaver blokkerer siden',
  'preload-fonts': 'Forhåndsinnlast skrifttyper',
  'third-party-cookies': 'Tredjeparts informasjonskapsler',
  'paste-preventing-inputs': 'Inndatafelt hindrer innliming av tekst',
  'network-requests': 'Reduser antall nettverksforespørsler',
  'network-server-latency': 'Reduser serverlatens',
  'total-tasks-time': 'Reduser total prosesseringstid',
  'connection-rtt': 'Reduser nettverksforsinkelse',
  'image-aspect-ratio': 'Bilder vises ikke med korrekt sideforhold',
  'image-size-responsive': 'Bilder er ikke riktig størrelse',
  'inspector-issues': 'Nettleserproblemer ble logget i DevTools',
  'layout-shift-elements': 'Store layoutforskyvninger ble oppdaget',
  'lcp-lazy-loaded': 'LCP-bildet lastes med lazy loading',
  'legacy-javascript': 'Unngå eldre JavaScript',
  'no-document-write': 'Ikke bruk document.write()',
  'non-composited-animations': 'Unngå ikke-kompositerte animasjoner',
  'resource-summary': 'Hold ressurstellere og -størrelser lave',
  'uses-passive-event-listeners': 'Bruk passive hendelseslyttere for bedre rulleytelse',
  'valid-lang': 'Lang-attributter er ikke gyldige',
  'viewport': 'Mangler meta viewport-tag',
  'canonical': 'Dokument mangler canonical-URL',
  'is-crawlable': 'Siden kan ikke indekseres',
  'link-text': 'Lenker mangler beskrivende tekst',
  'robots-txt': 'robots.txt er ikke gyldig',
  'third-party-summary': 'Reduser innvirkning av tredjepartskode',
  'third-party-facades': 'Noen tredjepartsressurser kan lastes med fasade',
  'duplicate-id-active': 'Aktive interaktive elementer har duplikat-ID',
  'duplicate-id-aria': 'ARIA-ID-er er ikke unike',
  'aria-allowed-attr': 'ARIA-attributter passer ikke til rollen',
  'aria-required-attr': 'ARIA-roller mangler nødvendige attributter',
  'aria-roles': 'ARIA-rolleverdier er ugyldige',
  'aria-valid-attr': 'ARIA-attributter er ugyldige',
  'aria-valid-attr-value': 'ARIA-attributter har ugyldige verdier',
  'bypass': 'Mangler hopp-til-hovedinnhold-lenke',
  'structured-data': 'Strukturerte data er ugyldig',
  'hreflang': 'Dokument mangler hreflang-tagger',
  'js-libraries': 'Utdaterte JavaScript-biblioteker',
  'no-unload-listeners': 'Unngå bruk av "unload"-lyttere',
  'offscreen-content-hidden': 'Innhold utenfor skjermen er ikke skjult for hjelpeteknologi',
};

// ===== Generate failing audits rows =====

function generateFailingAuditRows(audits, extraTranslations = {}) {
  if (!audits || audits.length === 0) {
    return `<tr><td colspan="3" style="text-align:center; color:var(--color-gray-600); padding:1.5rem;" data-no="Ingen feilende kontroller funnet" data-en="No failing audits found">Ingen feilende kontroller funnet</td></tr>`;
  }

  return audits.map(a => {
    const impactClass = a.impact === 'high' ? 'fail' : a.impact === 'medium' ? 'warn' : 'pass';
    const impactNo = a.impact === 'high' ? 'HØY' : a.impact === 'medium' ? 'MIDDELS' : 'LAV';
    const impactEn = a.impact === 'high' ? 'HIGH' : a.impact === 'medium' ? 'MEDIUM' : 'LOW';
    const extra = extraTranslations[a.id] || {};
    const titleNo = escapeHtml(LH_TITLES_NO[a.id] || extra.title || a.title);
    const titleEn = escapeHtml(a.title);
    const cleanDesc = (desc) => (desc || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    const descEn = escapeHtml(cleanDesc(a.description).substring(0, 200));
    const descNo = escapeHtml((LH_DESCRIPTIONS_NO[a.id] || extra.description || cleanDesc(a.description)).substring(0, 200));
    return `<tr>
  <td class="check-name" data-no="${titleNo}" data-en="${titleEn}">${titleNo}</td>
  <td><span class="status ${impactClass}" data-no="${impactNo}" data-en="${impactEn}">${impactNo}</span></td>
  <td class="notes" data-no="${descNo}" data-en="${descEn}">${descNo}</td>
</tr>`;
  }).join('\n');
}

// ===== Generate priority fixes HTML =====

function generatePriorityFixes(fixes) {
  if (!Array.isArray(fixes) || fixes.length === 0) return '';
  return fixes.map(f => {
    const titleNo = escapeHtml(f.title_no || f.title || '');
    const titleEn = escapeHtml(f.title_en || f.title || '');
    const descNo = escapeHtml(f.description_no || f.description || '');
    const descEn = escapeHtml(f.description_en || f.description || '');
    const severity = f.severity || 'medium';
    const severityClass = severity === 'high' ? 'fail' : severity === 'medium' ? 'warn' : 'pass';
    const severityNo = severity === 'high' ? 'HØY' : severity === 'medium' ? 'MIDDELS' : 'LAV';
    const severityEn = severity.toUpperCase();
    return `<li>
  <div class="fix-title" data-no="${titleNo}" data-en="${titleEn}">${titleNo}</div>
  <div class="fix-description" data-no="${descNo}" data-en="${descEn}">${descNo}</div>
  <div class="fix-severity"><span class="status ${severityClass}" data-no="${severityNo}" data-en="${severityEn}">${severityNo}</span> ${escapeHtml(f.domain || '')}</div>
</li>`;
  }).join('\n');
}

// ===== Main report builder =====

function buildReport(pageSpeedData, claudeData, url, extraTranslations = {}, options = {}) {
  const templatePath = path.join(__dirname, '..', 'templates', 'report-template.html');
  const reportCssPath = path.join(__dirname, '..', 'public', 'css', 'report.css');
  const fontCssPath = path.join(__dirname, '..', 'public', 'fonts', 'stylesheet.css');
  const logoSvgPath = path.join(__dirname, '..', 'public', 'images', 'TreLogo.svg');

  let html = fs.readFileSync(templatePath, 'utf8');
  let reportCss = fs.readFileSync(reportCssPath, 'utf8');
  let fontCss = fs.readFileSync(fontCssPath, 'utf8');
  const logoSvg = fs.readFileSync(logoSvgPath, 'utf8');

  // Strip ALL @font-face blocks from both CSS files — we build one clean embedded block below
  const stripFontFaces = css => css.replace(/@font-face\s*\{[^}]+\}/g, '');
  fontCss = stripFontFaces(fontCss);
  reportCss = stripFontFaces(reportCss);

  // Build one self-contained @font-face covering all weights (100–900) with embedded data URIs
  const fontDir = path.join(__dirname, '..', 'public', 'fonts');
  const fontFormats = [
    { file: 'brockmann-medium-webfont.woff2', mime: 'font/woff2', format: 'woff2' },
    { file: 'brockmann-medium-webfont.woff', mime: 'font/woff', format: 'woff' },
    { file: 'brockmann-medium-webfont.ttf', mime: 'font/truetype', format: 'truetype' },
  ];
  const fontSrcs = fontFormats
    .filter(({ file }) => fs.existsSync(path.join(fontDir, file)))
    .map(({ file, mime, format }) => {
      const dataUri = `data:${mime};base64,${fs.readFileSync(path.join(fontDir, file)).toString('base64')}`;
      return `url('${dataUri}') format('${format}')`;
    });

  const embeddedFontFace = fontSrcs.length > 0 ? `@font-face {
  font-family: 'brockmannmedium';
  src: ${fontSrcs.join(',\n       ')};
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}` : '';

  // Inject embedded font + CSS into template
  html = html.replace('{{REPORT_CSS}}', embeddedFontFace + '\n' + fontCss + '\n' + reportCss);

  // Embed logo as data URI
  const logoDataUri = 'data:image/svg+xml;base64,' + Buffer.from(logoSvg).toString('base64');
  html = html.replace('TRE_LOGO_URL', logoDataUri);

  const date = new Date().toLocaleDateString('no-NO', { year: 'numeric', month: 'long', day: 'numeric' });

  // Calculate domain scores
  const uxScores = calculateDomainScores(claudeData.ux || {});
  const uiScores = calculateDomainScores(claudeData.ui || {});
  const a11yScores = calculateDomainScores(claudeData.accessibility || {});
  const bpScores = calculateDomainScores(claudeData.bestPractices || {});

  const ds = pageSpeedData.desktop.scores;
  const ms = pageSpeedData.mobile.scores;

  // ===== Replace basic placeholders =====
  html = html.replace(/\{\{URL\}\}/g, escapeHtml(url));
  html = html.replace(/\{\{DATE\}\}/g, date);

  // ===== PSI notice (shown when PageSpeed data is unavailable) =====
  const psiNotice = options.psiSkipped
    ? `<div style="background:var(--color-gray-100);border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem;border-left:4px solid var(--color-warn);color:var(--color-gray-700);font-size:0.95rem;">
        <strong data-no="PageSpeed ikke tilgjengelig" data-en="PageSpeed not available">PageSpeed ikke tilgjengelig</strong>
        <span data-no=" — Google PageSpeed Insights kan ikke analysere localhost-URLer. Kjør revisjonen mot en offentlig URL for å få PageSpeed-data." data-en=" — Google PageSpeed Insights cannot analyse localhost URLs. Run the audit against a public URL to get PageSpeed data."> — Google PageSpeed Insights kan ikke analysere localhost-URLer. Kjør revisjonen mot en offentlig URL for å få PageSpeed-data.</span>
      </div>`
    : '';
  html = html.replace('<!-- {{PSI_NOTICE}} -->', psiNotice);

  // Executive summary
  const summaryNo = claudeData.executiveSummary?.no || 'Revisjon fullført.';
  const summaryEn = claudeData.executiveSummary?.en || 'Audit completed.';
  html = html.replace('{{EXECUTIVE_SUMMARY_TEXT}}',
    `<span data-no="${escapeHtml(summaryNo)}" data-en="${escapeHtml(summaryEn)}">${escapeHtml(summaryNo)}</span>`);

  // ===== Domain score cards =====
  html = html.replace('{{UX_SCORE}}', uxScores.score);
  html = html.replace('{{UX_RING_OFFSET}}', ringOffset(uxScores.score));
  html = html.replace('{{UX_PASS}}', uxScores.pass);
  html = html.replace('{{UX_WARN}}', uxScores.warn);
  html = html.replace('{{UX_FAIL}}', uxScores.fail);

  html = html.replace('{{UI_SCORE}}', uiScores.score);
  html = html.replace('{{UI_RING_OFFSET}}', ringOffset(uiScores.score));
  html = html.replace('{{UI_PASS}}', uiScores.pass);
  html = html.replace('{{UI_WARN}}', uiScores.warn);
  html = html.replace('{{UI_FAIL}}', uiScores.fail);

  html = html.replace('{{A11Y_SCORE}}', a11yScores.score);
  html = html.replace('{{A11Y_RING_OFFSET}}', ringOffset(a11yScores.score));
  html = html.replace('{{A11Y_PASS}}', a11yScores.pass);
  html = html.replace('{{A11Y_WARN}}', a11yScores.warn);
  html = html.replace('{{A11Y_FAIL}}', a11yScores.fail);

  html = html.replace('{{BP_SCORE}}', bpScores.score);
  html = html.replace('{{BP_RING_OFFSET}}', ringOffset(bpScores.score));
  html = html.replace('{{BP_PASS}}', bpScores.pass);
  html = html.replace('{{BP_WARN}}', bpScores.warn);
  html = html.replace('{{BP_FAIL}}', bpScores.fail);

  // ===== Stacked bars =====
  const stackedBarsHtml = generateStackedBars({
    'UX': uxScores,
    'UI': uiScores,
    'Tilgjengelighet': a11yScores,
    'Beste praksis': bpScores,
  });
  html = html.replace('<!-- {{STACKED_BARS}} -->', stackedBarsHtml);

  // ===== Desktop PageSpeed Insights scores =====
  html = html.replace('{{PERF_SCORE}}', ds.performance);
  html = html.replace('{{PERF_GAUGE_CLASS}}', gaugeClass(ds.performance));
  html = html.replace('{{PERF_DASH_OFFSET}}', dashOffset(ds.performance));
  html = html.replace('{{PERF_NEEDLE_DEG}}', needleDeg(ds.performance));
  html = html.replace('{{PERF_RATING}}', ratingText(ds.performance));

  html = html.replace('{{A11Y_LH_SCORE}}', ds.accessibility);
  html = html.replace('{{A11Y_LH_GAUGE_CLASS}}', gaugeClass(ds.accessibility));
  html = html.replace('{{A11Y_LH_DASH_OFFSET}}', dashOffset(ds.accessibility));
  html = html.replace('{{A11Y_LH_NEEDLE_DEG}}', needleDeg(ds.accessibility));
  html = html.replace('{{A11Y_LH_RATING}}', ratingText(ds.accessibility));

  html = html.replace('{{BP_LH_SCORE}}', ds.bestPractices);
  html = html.replace('{{BP_LH_GAUGE_CLASS}}', gaugeClass(ds.bestPractices));
  html = html.replace('{{BP_LH_DASH_OFFSET}}', dashOffset(ds.bestPractices));
  html = html.replace('{{BP_LH_NEEDLE_DEG}}', needleDeg(ds.bestPractices));
  html = html.replace('{{BP_LH_RATING}}', ratingText(ds.bestPractices));

  html = html.replace('{{SEO_SCORE}}', ds.seo);
  html = html.replace('{{SEO_GAUGE_CLASS}}', gaugeClass(ds.seo));
  html = html.replace('{{SEO_DASH_OFFSET}}', dashOffset(ds.seo));
  html = html.replace('{{SEO_NEEDLE_DEG}}', needleDeg(ds.seo));
  html = html.replace('{{SEO_RATING}}', ratingText(ds.seo));

  // ===== Mobile PageSpeed Insights scores =====
  html = html.replace('{{M_PERF_SCORE}}', ms.performance);
  html = html.replace('{{M_PERF_GAUGE_CLASS}}', gaugeClass(ms.performance));
  html = html.replace('{{M_PERF_DASH_OFFSET}}', dashOffset(ms.performance));
  html = html.replace('{{M_PERF_NEEDLE_DEG}}', needleDeg(ms.performance));
  html = html.replace('{{M_PERF_RATING}}', ratingText(ms.performance));

  html = html.replace('{{M_A11Y_LH_SCORE}}', ms.accessibility);
  html = html.replace('{{M_A11Y_LH_GAUGE_CLASS}}', gaugeClass(ms.accessibility));
  html = html.replace('{{M_A11Y_LH_DASH_OFFSET}}', dashOffset(ms.accessibility));
  html = html.replace('{{M_A11Y_LH_NEEDLE_DEG}}', needleDeg(ms.accessibility));
  html = html.replace('{{M_A11Y_LH_RATING}}', ratingText(ms.accessibility));

  html = html.replace('{{M_BP_LH_SCORE}}', ms.bestPractices);
  html = html.replace('{{M_BP_LH_GAUGE_CLASS}}', gaugeClass(ms.bestPractices));
  html = html.replace('{{M_BP_LH_DASH_OFFSET}}', dashOffset(ms.bestPractices));
  html = html.replace('{{M_BP_LH_NEEDLE_DEG}}', needleDeg(ms.bestPractices));
  html = html.replace('{{M_BP_LH_RATING}}', ratingText(ms.bestPractices));

  html = html.replace('{{M_SEO_SCORE}}', ms.seo);
  html = html.replace('{{M_SEO_GAUGE_CLASS}}', gaugeClass(ms.seo));
  html = html.replace('{{M_SEO_DASH_OFFSET}}', dashOffset(ms.seo));
  html = html.replace('{{M_SEO_NEEDLE_DEG}}', needleDeg(ms.seo));
  html = html.replace('{{M_SEO_RATING}}', ratingText(ms.seo));

  // ===== Metric bars =====
  html = html.replace('<!-- {{METRIC_BARS}} -->', generateMetricBars(pageSpeedData.desktop.metrics));

  // ===== Failing audits =====
  html = html.replace(/<!-- \{\{FAILING_AUDITS_ROWS\}\}[\s\S]*?-->/, generateFailingAuditRows(pageSpeedData.desktop.failingAudits, extraTranslations));

  // ===== UX Finding rows =====
  const ux = claudeData.ux || {};
  html = html.replace('<!-- {{UX_NAV_ROWS}}', '').replace(/Use this pattern[\s\S]*?-->/, '');
  // Re-read template approach: inject rows into tbody
  html = injectRows(html, 'Navigasjon og informasjonsarkitektur', generateFindingRows(ux.navigation));
  html = html.replace('<!-- {{UX_CONTENT_ROWS}} -->', generateFindingRows(ux.content));
  html = html.replace('<!-- {{UX_INTERACTION_ROWS}} -->', generateFindingRows(ux.interaction));
  html = html.replace('<!-- {{UX_COGNITIVE_ROWS}} -->', generateFindingRows(ux.cognitiveLoad));
  html = html.replace('<!-- {{UX_TRUST_ROWS}} -->', generateFindingRows(ux.trust));

  // ===== UI Finding rows =====
  const ui = claudeData.ui || {};
  html = html.replace('<!-- {{UI_HIERARCHY_ROWS}} -->', generateFindingRows(ui.hierarchy));
  html = html.replace('<!-- {{UI_TYPOGRAPHY_ROWS}} -->', generateFindingRows(ui.typography));
  html = html.replace('<!-- {{UI_COLOR_ROWS}} -->', generateFindingRows(ui.color));
  html = html.replace('<!-- {{UI_SPACING_ROWS}} -->', generateFindingRows(ui.spacing));
  html = html.replace('<!-- {{UI_COMPONENTS_ROWS}} -->', generateFindingRows(ui.components));

  // ===== Accessibility Finding rows =====
  const a11y = claudeData.accessibility || {};
  html = html.replace('<!-- {{A11Y_PERCEIVABLE_ROWS}} -->', generateFindingRows(a11y.perceivable));
  html = html.replace('<!-- {{A11Y_OPERABLE_ROWS}} -->', generateFindingRows(a11y.operable));
  html = html.replace('<!-- {{A11Y_UNDERSTANDABLE_ROWS}} -->', generateFindingRows(a11y.understandable));
  html = html.replace('<!-- {{A11Y_ROBUST_ROWS}} -->', generateFindingRows(a11y.robust));

  // ===== Best Practices Finding rows =====
  const bp = claudeData.bestPractices || {};
  html = html.replace('<!-- {{BP_PERFORMANCE_ROWS}} -->', generateFindingRows(bp.performance));
  html = html.replace('<!-- {{BP_SECURITY_ROWS}} -->', generateFindingRows(bp.security));
  html = html.replace('<!-- {{BP_SEO_ROWS}} -->', generateFindingRows(bp.seo));
  html = html.replace('<!-- {{BP_CODE_ROWS}} -->', generateFindingRows(bp.codeQuality));
  html = html.replace('<!-- {{BP_PRIVACY_ROWS}} -->', generateFindingRows(bp.privacy));

  // ===== Priority fixes =====
  html = html.replace('<!-- {{PRIORITY_FIXES_ITEMS}} -->', generatePriorityFixes(claudeData.priorityFixes));

  // ===== Customer summary =====
  const csNo = claudeData.customerSummary?.no || '';
  const csEn = claudeData.customerSummary?.en || '';
  const csNoHtml = csNo.split('\n\n').filter(p => p.trim()).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
  const csEnHtml = csEn.split('\n\n').filter(p => p.trim()).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
  // Store rendered HTML in data attributes so language toggle preserves paragraph formatting
  const summaryHtml = `<div data-no="${escapeHtml(csNoHtml)}" data-en="${escapeHtml(csEnHtml)}">${csNoHtml}</div>`;
  html = html.replace(/<!-- \{\{CUSTOMER_SUMMARY\}\}[\s\S]*?-->/, summaryHtml);

  return html;
}

// Helper: inject finding rows after a specific h3 heading's tbody
function injectRows(html, headingText, rowsHtml) {
  // Find the first tbody after the heading that contains the UX_NAV comment area
  const navSectionRegex = new RegExp(
    `(${escapeRegex(headingText)}[\\s\\S]*?<tbody>)[\\s\\S]*?(</tbody>)`,
    ''
  );
  const match = html.match(navSectionRegex);
  if (match) {
    html = html.replace(match[0], match[1] + '\n' + rowsHtml + '\n' + match[2]);
  }
  return html;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { buildReport, LH_TITLES_NO, LH_DESCRIPTIONS_NO };
