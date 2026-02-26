/* =====================================================================
   TRE BERGEN - NETTSTEDSREVISJON HOVEDSCRIPT
   Håndterer skjemainnsending, API-kommunikasjon og visning av rapport
   ===================================================================== */

/* =====================================================================
   GLOBAL STATE
   ===================================================================== */
let reportHtml = ""; // Lagrer den genererte HTML-rapporten
let etaInterval = null; // Interval for ETA countdown
let funFactInterval = null; // Interval for rotating fun facts
let step3MessageInterval = null; // Interval for rotating Step 3 messages
let currentStep = 0; // Current active step
let stepStartTime = 0; // Timestamp when current step started
let etaSecondsRemaining = 0; // Total ETA in seconds

// Step durations in seconds
const STEP_DURATIONS = {
  1: 5, // PageSpeed Insights
  2: 8, // HTML fetch
  3: 75, // Claude API analysis (average of 60-90)
  4: 5, // Report generation
};

// Fun facts about web development history (in Norwegian)
const FUN_FACTS = [
  "Visste du at den første nettsiden ble publisert 6. august 1991?",
  "HTML sto opprinnelig for HyperText Markup Language, laget av Tim Berners-Lee",
  "Den første nettleseren het WorldWideWeb og ble senere omdøpt til Nexus",
  "GIF-formatet ble introdusert i 1987, lenge før internett ble populært",
  "CSS ble først foreslått i 1994, men fikk ikke støtte før Internet Explorer 3 i 1996",
  "JavaScript ble laget på bare 10 dager i mai 1995 av Brendan Eich",
  "Den første banneren på nettet var for AT&T og hadde 44% klikkrate i 1994",
  "Google startet i en garasje i 1998 med bare 25 millioner nettsider indeksert",
  "Den første webcam ble brukt til å overvåke en kaffekanne i Cambridge i 1991",
  "Det er estimert at det finnes over 1,9 milliarder nettsider i dag",
  "PNG-formatet ble utviklet i 1996 som et alternativ til GIF på grunn av patentproblemer",
  "Den første emoji ble designet i Japan i 1999 av Shigetaka Kurita",
  "Flash ble lansert i 1996 og dominerte webanimasjon i over 15 år",
  "HTTP/2 protokollen ble publisert i 2015 og gjorde nettet mye raskere",
  "Den første YouTube-videoen 'Me at the zoo' ble lastet opp 23. april 2005",
];

// Step 3 sub-messages (Claude API analysis details)
const STEP3_MESSAGES = [
  "Analyserer UX-kriterier...",
  "Evaluerer tilgjengelighet...",
  "Sjekker beste praksis...",
  "Gjennomgår designprinsipper...",
  "Vurderer brukervennlighet...",
  "Undersøker responsivitet...",
];

let currentFactIndex = 0;
let currentStep3MessageIndex = 0;

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
  submitBtn.disabled = true;

  // Nullstill progresjonsindikatorer
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`step${i}`).className = "progress-step";
  }
  document.getElementById("progressBar").style.width = "0%";

  // Reset step 3 text to default
  document.getElementById("step3Text").textContent =
    "AI analyserer 87 kriterier...";

  // Initialize ETA and fun facts
  initializeLoadingExperience();

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
  document.getElementById("progressBar").style.width = (pcts[step] || 0) + "%";

  // Update current step and calculate new ETA
  currentStep = step;
  stepStartTime = Date.now();
  calculateETA();

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

  // Handle Step 3 special messaging
  if (step === 3) {
    startStep3MessageRotation();
  } else {
    stopStep3MessageRotation();
    // Reset step 3 text to default if we moved past it
    if (step > 3) {
      document.getElementById("step3Text").textContent =
        "AI analyserer 87 kriterier...";
    }
  }
}

/* =====================================================================
   RAPPORTVISNING
   Viser den genererte rapporten i en iframe
   ===================================================================== */
function showReport() {
  // Clean up intervals
  stopLoadingExperience();

  // Skjul lasting og vis rapport
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("reportView").classList.remove("hidden");
  document.getElementById("siteFooter").style.display = "none";

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
  // Clean up intervals
  stopLoadingExperience();

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

/* =====================================================================
   LOADING EXPERIENCE ENHANCEMENTS
   ETA countdown, fun facts, and Step 3 detailed progress
   ===================================================================== */

/**
 * Initialize all loading experience features
 */
function initializeLoadingExperience() {
  // Reset state
  currentStep = 0;
  currentFactIndex = 0;
  currentStep3MessageIndex = 0;

  // Calculate initial ETA (sum of all steps)
  etaSecondsRemaining = Object.values(STEP_DURATIONS).reduce(
    (a, b) => a + b,
    0,
  );
  updateETADisplay();

  // Start ETA countdown (updates every second)
  etaInterval = setInterval(() => {
    if (etaSecondsRemaining > 0) {
      etaSecondsRemaining--;
      updateETADisplay();
    }
  }, 1000);

  // Start fun facts rotation
  showNextFunFact();
  funFactInterval = setInterval(showNextFunFact, 8000); // Rotate every 8 seconds
}

/**
 * Calculate remaining ETA based on current step
 */
function calculateETA() {
  // Calculate time remaining for remaining steps
  etaSecondsRemaining = 0;

  // Add remaining time for current step
  if (currentStep > 0 && currentStep <= 4) {
    etaSecondsRemaining += STEP_DURATIONS[currentStep];
  }

  // Add time for future steps
  for (let i = currentStep + 1; i <= 4; i++) {
    etaSecondsRemaining += STEP_DURATIONS[i];
  }

  updateETADisplay();
}

/**
 * Update the ETA display text
 */
function updateETADisplay() {
  const etaText = document.getElementById("etaText");
  if (etaSecondsRemaining <= 0) {
    etaText.textContent = "Fullører snart...";
  } else {
    etaText.textContent = `Estimert tid: ~${etaSecondsRemaining} sekunder`;
  }
}

/**
 * Show next fun fact with fade transition
 */
function showNextFunFact() {
  const funFactText = document.getElementById("funFactText");

  // Fade out
  funFactText.classList.remove("visible");

  // Wait for fade out, then change text and fade in
  setTimeout(() => {
    // Pick a random fact, but avoid showing the same fact twice in a row
    let newFactIndex;
    do {
      newFactIndex = Math.floor(Math.random() * FUN_FACTS.length);
    } while (newFactIndex === currentFactIndex && FUN_FACTS.length > 1);

    currentFactIndex = newFactIndex;
    funFactText.textContent = FUN_FACTS[currentFactIndex];
    funFactText.classList.add("visible");
  }, 500); // Match the CSS transition duration
}

/**
 * Start rotating Step 3 sub-messages
 */
function startStep3MessageRotation() {
  // Set initial message
  currentStep3MessageIndex = 0;
  updateStep3Message();

  // Rotate messages every 6 seconds
  step3MessageInterval = setInterval(() => {
    currentStep3MessageIndex =
      (currentStep3MessageIndex + 1) % STEP3_MESSAGES.length;
    updateStep3Message();
  }, 6000);
}

/**
 * Update Step 3 message text
 */
function updateStep3Message() {
  const step3Text = document.getElementById("step3Text");
  step3Text.textContent = STEP3_MESSAGES[currentStep3MessageIndex];
}

/**
 * Stop Step 3 message rotation
 */
function stopStep3MessageRotation() {
  if (step3MessageInterval) {
    clearInterval(step3MessageInterval);
    step3MessageInterval = null;
  }
}

/**
 * Clean up all intervals when loading completes
 */
function stopLoadingExperience() {
  if (etaInterval) {
    clearInterval(etaInterval);
    etaInterval = null;
  }

  if (funFactInterval) {
    clearInterval(funFactInterval);
    funFactInterval = null;
  }

  stopStep3MessageRotation();
}
