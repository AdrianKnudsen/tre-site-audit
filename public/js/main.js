/* =====================================================================
   TRE BERGEN - WEBSITE AUDIT MAIN SCRIPT
   Handles form submission, API communication, and report rendering
   ===================================================================== */

/* =====================================================================
   GLOBAL STATE
   ===================================================================== */
let reportHtml = ""; // Stores the generated HTML report
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

// Fun facts about web development history
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
   MAIN FUNCTION: START AUDIT
   Starts the audit process when the user submits the form
   ===================================================================== */
async function startAudit(e) {
  e.preventDefault();

  // Get values from the form
  const url = document.getElementById("urlInput").value.trim();
  const apiKey = document.getElementById("apiKeyInput").value.trim();
  const errorBanner = document.getElementById("errorBanner");
  const submitBtn = document.getElementById("submitBtn");

  // Hide any previous error messages
  errorBanner.classList.remove("visible");

  // Validate input
  if (!url || !apiKey) {
    errorBanner.textContent = "Fyll inn både URL og API-nøkkel.";
    errorBanner.classList.add("visible");
    return;
  }

  // Switch to loading view
  document.getElementById("landing").classList.add("hidden");
  document.getElementById("loading").classList.remove("hidden");
  submitBtn.disabled = true;

  // Reset progress indicators
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
    // Send POST request to backend API
    const response = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, apiKey }),
    });

    // Les server-sent events (SSE) stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Read stream continuously
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode and parse data
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line in buffer

      // Process each complete line
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.substring(6));

        // Handle different event types
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
    // Handle network errors
    showError(`Nettverksfeil: ${err.message}`);
  }
}

/* =====================================================================
   PROGRESS HANDLING
   Updates the progress bar and step indicators
   ===================================================================== */
function updateProgress(step) {
  // Definer prosentandel for hvert steg
  const pcts = { 1: 15, 2: 30, 3: 70, 4: 90 };
  document.getElementById("progressBar").style.width = (pcts[step] || 0) + "%";

  // Update current step and calculate new ETA
  currentStep = step;
  stepStartTime = Date.now();
  calculateETA();

  // Update visual states for all steps
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step${i}`);
    if (i < step) {
      // Completed steps
      el.className = "progress-step done";
      el.querySelector(".step-icon").innerHTML = "✓";
    } else if (i === step) {
      // Active step
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
        "AI is analyzing 87 criteria...";
    }
  }
}

/* =====================================================================
   REPORT VIEW
   Displays the generated report in an iframe
   ===================================================================== */
function showReport() {
  // Clean up intervals
  stopLoadingExperience();

  // Hide loading and show report
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("reportView").classList.remove("hidden");
  document.getElementById("siteFooter").style.display = "none";

  // Load the report into iframe
  const iframe = document.getElementById("reportFrame");
  iframe.srcdoc = reportHtml;

  // Auto-adjust iframe height to content
  iframe.onload = () => {
    try {
      const height = iframe.contentDocument.body.scrollHeight;
      iframe.style.height = height + 50 + "px";
    } catch (e) {
      // Fallback if no access to iframe content
      iframe.style.height = "5000px";
    }
  };
}

/* =====================================================================
   ERROR HANDLING
   Displays error messages to the user
   ===================================================================== */
function showError(message) {
  // Clean up intervals
  stopLoadingExperience();

  // Hide loading and show landing again
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("landing").classList.remove("hidden");
  document.getElementById("siteFooter").style.display = "";
  document.getElementById("submitBtn").disabled = false;

  // Show error message
  const errorBanner = document.getElementById("errorBanner");
  errorBanner.textContent = message;
  errorBanner.classList.add("visible");
}

/* =====================================================================
   NAVIGATION
   Go back to the form from the report view
   ===================================================================== */
function goBack() {
  // Hide report and show landing
  document.getElementById("reportView").classList.add("hidden");
  document.getElementById("landing").classList.remove("hidden");
  document.getElementById("siteFooter").style.display = "";
  document.getElementById("submitBtn").disabled = false;

  // Clear stored report
  reportHtml = "";
}

/* =====================================================================
   DOWNLOAD
   Download the report as an HTML file
   ===================================================================== */
function downloadReport() {
  if (!reportHtml) return;

  // Create blob and download link
  const blob = new Blob([reportHtml], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);

  // Generate filename based on URL input
  const urlInput = document.getElementById("urlInput").value;
  const domain = urlInput
    .replace(/https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+$/, "");
  a.download = `audit-${domain}.html`;

  // Trigger download and clean up
  a.click();
  URL.revokeObjectURL(a.href);
}

/* =====================================================================
   PRINT
   Print the report via iframe
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
    etaText.textContent = "Fullfører snart...";
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
