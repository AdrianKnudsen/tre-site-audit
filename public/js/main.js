/* =====================================================================
   TRE BERGEN - NETTSTEDSREVISJON HOVEDSCRIPT
   Håndterer skjemainnsending, API-kommunikasjon og visning av rapport
   ===================================================================== */

/* =====================================================================
   GLOBAL STATE
   ===================================================================== */
let reportHtml = ""; // Lagrer den genererte HTML-rapporten

/* =====================================================================
   HOVEDFUNKSJON: START REVISJON
   Starter revisjonsprosessen når brukeren sender inn skjemaet
   ===================================================================== */
async function startAudit(e) {
  e.preventDefault();

  // Hent verdier fra skjemaet
  const url = document.getElementById("urlInput").value.trim();
  const apiKey = document.getElementById("apiKeyInput").value.trim();
  const errorBanner = document.getElementById("errorBanner");
  const submitBtn = document.getElementById("submitBtn");

  // Skjul eventuelle tidligere feilmeldinger
  errorBanner.classList.remove("visible");

  // Valider input
  if (!url || !apiKey) {
    errorBanner.textContent = "Fyll inn både URL og API-nøkkel.";
    errorBanner.classList.add("visible");
    return;
  }

  // Bytt til lasting-visning
  document.getElementById("landing").classList.add("hidden");
  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("siteFooter").style.display = "none";
  submitBtn.disabled = true;

  // Nullstill progresjonsindikatorer
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`step${i}`).className = "progress-step";
  }
  document.getElementById("progressBar").style.width = "0%";

  try {
    // Send POST-request til backend API
    const response = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, apiKey }),
    });

    // Les server-sent events (SSE) stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Les stream kontinuerlig
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Dekod og parse data
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Behold ufullstendig linje i buffer

      // Prosesser hver fullstendige linje
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.substring(6));

        // Håndter ulike event-typer
        if (data.type === "progress") {
          updateProgress(data.step);
        } else if (data.type === "complete") {
          reportHtml = data.report;
          showReport();
        } else if (data.type === "error") {
          showError(data.message_no || data.message_en || "Ukjent feil");
        }
      }
    }
  } catch (err) {
    // Håndter nettverksfeil
    showError(`Nettverksfeil: ${err.message}`);
  }
}

/* =====================================================================
   PROGRESJONSHÅNDTERING
   Oppdaterer progresjonslinje og steg-indikatorer
   ===================================================================== */
function updateProgress(step) {
  // Definer prosentandel for hvert steg
  const pcts = { 1: 15, 2: 30, 3: 70, 4: 90 };
  document.getElementById("progressBar").style.width =
    (pcts[step] || 0) + "%";

  // Oppdater visuelle tilstander for alle steg
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step${i}`);
    if (i < step) {
      // Fullførte steg
      el.className = "progress-step done";
      el.querySelector(".step-icon").innerHTML = "✓";
    } else if (i === step) {
      // Aktivt steg
      el.className = "progress-step active";
    }
  }
}

/* =====================================================================
   RAPPORTVISNING
   Viser den genererte rapporten i en iframe
   ===================================================================== */
function showReport() {
  // Skjul lasting og vis rapport
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("reportView").classList.remove("hidden");

  // Last rapporten inn i iframe
  const iframe = document.getElementById("reportFrame");
  iframe.srcdoc = reportHtml;

  // Auto-tilpass iframe-høyde til innhold
  iframe.onload = () => {
    try {
      const height = iframe.contentDocument.body.scrollHeight;
      iframe.style.height = height + 50 + "px";
    } catch (e) {
      // Fallback hvis ikke tilgang til iframe-innhold
      iframe.style.height = "5000px";
    }
  };
}

/* =====================================================================
   FEILHÅNDTERING
   Viser feilmeldinger til brukeren
   ===================================================================== */
function showError(message) {
  // Skjul lasting og vis landing igjen
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("landing").classList.remove("hidden");
  document.getElementById("siteFooter").style.display = "";
  document.getElementById("submitBtn").disabled = false;

  // Vis feilmelding
  const errorBanner = document.getElementById("errorBanner");
  errorBanner.textContent = message;
  errorBanner.classList.add("visible");
}

/* =====================================================================
   NAVIGASJON
   Gå tilbake til skjemaet fra rapportvisningen
   ===================================================================== */
function goBack() {
  // Skjul rapport og vis landing
  document.getElementById("reportView").classList.add("hidden");
  document.getElementById("landing").classList.remove("hidden");
  document.getElementById("siteFooter").style.display = "";
  document.getElementById("submitBtn").disabled = false;

  // Tøm lagret rapport
  reportHtml = "";
}

/* =====================================================================
   NEDLASTING
   Last ned rapporten som HTML-fil
   ===================================================================== */
function downloadReport() {
  if (!reportHtml) return;

  // Opprett blob og download-link
  const blob = new Blob([reportHtml], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);

  // Generer filnavn basert på URL-input
  const urlInput = document.getElementById("urlInput").value;
  const domain = urlInput
    .replace(/https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+$/, "");
  a.download = `audit-${domain}.html`;

  // Trigger nedlasting og rydd opp
  a.click();
  URL.revokeObjectURL(a.href);
}

/* =====================================================================
   UTSKRIFT
   Skriv ut rapporten via iframe
   ===================================================================== */
function printReport() {
  const iframe = document.getElementById("reportFrame");
  if (iframe.contentWindow) {
    iframe.contentWindow.print();
  }
}
