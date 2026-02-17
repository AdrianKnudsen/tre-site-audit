/**
 * Report Builder — takes PageSpeed + Claude audit data and generates
 * a complete HTML report using the TRE Bergen template
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
  if (score >= 90) return 'Good';
  if (score >= 50) return 'Needs Improvement';
  return 'Poor';
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
    const statusLabel = (f.status || 'N/A').toUpperCase();
    const noteNo = escapeHtml(f.note_no || f.note || '');
    const noteEn = escapeHtml(f.note_en || f.note || '');
    const detailsNo = f.details_no || f.details || '';
    const detailsEn = f.details_en || f.details || '';
    const recNo = f.recommendation_no || f.recommendation || '';
    const recEn = f.recommendation_en || f.recommendation || '';
    const checkName = escapeHtml(f.check || '');

    let detailHtml = '';
    if (detailsNo || recNo) {
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

    return `<tr class="finding-row" onclick="toggleDetail(this)">
  <td><span class="expand-icon"></span> ${checkName}</td>
  <td><span class="status ${statusClass}">${statusLabel}</span></td>
  <td class="notes" data-no="${noteNo}" data-en="${noteEn}">${noteNo}</td>
</tr>
${detailHtml}`;
  }).join('\n');
}

// ===== Generate stacked bars HTML =====

function generateStackedBars(domains) {
  const bars = Object.entries(domains).map(([name, data]) => {
    const total = data.pass + data.warn + data.fail + data.na;
    if (total === 0) return '';
    const passPct = Math.round(data.pass / total * 100);
    const warnPct = Math.round(data.warn / total * 100);
    const failPct = Math.round(data.fail / total * 100);
    const naPct = 100 - passPct - warnPct - failPct;

    return `<p class="stacked-bar-row-label">${escapeHtml(name)}</p>
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

// ===== Generate failing audits rows =====

function generateFailingAuditRows(audits) {
  if (!audits || audits.length === 0) {
    return `<tr><td colspan="3" style="text-align:center; color:var(--color-gray-600); padding:1.5rem;" data-no="Ingen feilende kontroller funnet" data-en="No failing audits found">Ingen feilende kontroller funnet</td></tr>`;
  }

  return audits.map(a => {
    const impactClass = a.impact === 'high' ? 'fail' : a.impact === 'medium' ? 'warn' : 'pass';
    const impactLabel = a.impact === 'high' ? 'HIGH' : a.impact === 'medium' ? 'MEDIUM' : 'LOW';
    return `<tr>
  <td class="check-name">${escapeHtml(a.title)}</td>
  <td><span class="status ${impactClass}">${impactLabel}</span></td>
  <td class="notes">${escapeHtml(a.displayValue || a.description).substring(0, 150)}</td>
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
    return `<li>
  <div class="fix-title" data-no="${titleNo}" data-en="${titleEn}">${titleNo}</div>
  <div class="fix-description" data-no="${descNo}" data-en="${descEn}">${descNo}</div>
  <div class="fix-severity"><span class="status ${severityClass}">${severity.toUpperCase()}</span> ${escapeHtml(f.domain || '')}</div>
</li>`;
  }).join('\n');
}

// ===== Main report builder =====

function buildReport(pageSpeedData, claudeData, url) {
  const templatePath = path.join(__dirname, '..', 'templates', 'report-template.html');
  let html = fs.readFileSync(templatePath, 'utf8');

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

  // ===== Desktop Lighthouse gauges =====
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

  // ===== Mobile Lighthouse gauges =====
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
  html = html.replace('<!-- {{FAILING_AUDITS_ROWS}} -->', generateFailingAuditRows(pageSpeedData.desktop.failingAudits));

  // ===== UX Finding rows =====
  const ux = claudeData.ux || {};
  html = html.replace('<!-- {{UX_NAV_ROWS}}', '').replace(/Use this pattern[\s\S]*?-->/, '');
  // Re-read template approach: inject rows into tbody
  html = injectRows(html, 'Navigasjon og informasjonsarkitektur', generateFindingRows(ux.navigation));
  html = html.replace('<!-- {{UX_CONTENT_ROWS}} -->', generateFindingRows(ux.content));
  html = html.replace('<!-- {{UX_INTERACTION_ROWS}} -->', generateFindingRows(ux.interaction));
  html = html.replace('<!-- {{UX_COGNITIVE_ROWS}} -->', generateFindingRows(ux.cognitiveLoad));

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

  // ===== Priority fixes =====
  html = html.replace('<!-- {{PRIORITY_FIXES_ITEMS}} -->', generatePriorityFixes(claudeData.priorityFixes));

  // ===== Customer summary =====
  const csNo = claudeData.customerSummary?.no || '';
  const csEn = claudeData.customerSummary?.en || '';
  const summaryHtml = `<div data-no="${escapeHtml(csNo)}" data-en="${escapeHtml(csEn)}">${csNo.split('\n\n').map(p => `<p>${escapeHtml(p)}</p>`).join('\n')}</div>`;
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

export { buildReport };
