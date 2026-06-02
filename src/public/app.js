// State Management
const state = {
  medications: new Set(),
};

// Preset lists
const presetMedNames = {
  warfarin: "Warfarin",
  ibuprofen: "Ibuprofen",
  aspirin: "Aspirin",
  lisinopril: "Lisinopril",
  metformin: "Metformin",
  diazepam: "Diazepam",
  zolpidem: "Zolpidem",
  amoxicillin: "Amoxicillin",
  acetaminophen: "Acetaminophen"
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // Add some default medications to start
  addMedication("warfarin");
  addMedication("ibuprofen");
  
  // Try to parse the current domain to update the endpoints
  const host = window.location.origin;
  const endpointEl = document.getElementById("mcp-endpoint-url");
  if (endpointEl && host) {
    const cleanUrl = `${host}/mcp`;
    endpointEl.textContent = cleanUrl;
    
    // Update highlights in cursor tab too
    const cursorHighlight = document.querySelector(".highlight-url");
    if (cursorHighlight) {
      cursorHighlight.textContent = cleanUrl;
    }
  }
});

// Medication Management
function addMedication(medKey) {
  if (!medKey) return;
  const normalized = medKey.toLowerCase().trim();
  if (state.medications.has(normalized)) return;
  
  state.medications.add(normalized);
  renderChips();
}

function removeMedication(medKey) {
  state.medications.delete(medKey.toLowerCase());
  renderChips();
}

function renderChips() {
  const container = document.getElementById("medication-chips-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  if (state.medications.size === 0) {
    container.innerHTML = `<span style="color: var(--text-muted); font-size: 0.9rem; padding: 0.25rem 0.5rem;">No medications added yet</span>`;
    return;
  }
  
  state.medications.forEach(med => {
    const displayName = presetMedNames[med] || (med.charAt(0).toUpperCase() + med.slice(1));
    const chip = document.createElement("div");
    chip.className = "med-chip";
    chip.innerHTML = `
      <span>${displayName}</span>
      <button type="button" onclick="removeMedication('${med}')">&times;</button>
    `;
    container.appendChild(chip);
  });
}

function addMedicationFromSelector() {
  const selector = document.getElementById("preset-med-selector");
  if (!selector) return;
  
  const value = selector.value;
  if (value) {
    addMedication(value);
    selector.value = ""; // Reset
  }
}

// Copy utilities
function copyMcpUrl() {
  const endpointEl = document.getElementById("mcp-endpoint-url");
  if (!endpointEl) return;
  
  navigator.clipboard.writeText(endpointEl.textContent).then(() => {
    const btn = document.querySelector(".quick-status .copy-small-btn");
    const originalSvg = btn.innerHTML;
    btn.innerHTML = `<span style="color:var(--success);font-weight:bold;font-size:0.8rem;">Copied!</span>`;
    setTimeout(() => {
      btn.innerHTML = originalSvg;
    }, 2000);
  });
}

function copyCode(btnElement) {
  const pre = btnElement.previousElementSibling;
  const code = pre.querySelector("code").textContent;
  
  navigator.clipboard.writeText(code).then(() => {
    const originalText = btnElement.textContent;
    btnElement.textContent = "Copied!";
    btnElement.style.background = "var(--success)";
    btnElement.style.color = "var(--text-inverse)";
    btnElement.style.borderColor = "var(--success)";
    
    setTimeout(() => {
      btnElement.textContent = originalText;
      btnElement.style.background = "";
      btnElement.style.color = "";
      btnElement.style.borderColor = "";
    }, 2000);
  });
}

// Tab Switching
function switchResultTab(event, tabId) {
  // Deactivate all tabs
  const tabLinks = document.querySelectorAll(".tab-link");
  const tabContents = document.querySelectorAll(".tab-content");
  
  tabLinks.forEach(link => link.classList.remove("active"));
  tabContents.forEach(content => content.classList.remove("active"));
  
  // Activate selected tab
  event.currentTarget.classList.add("active");
  document.getElementById(`tab-${tabId}`).classList.add("active");
}

function switchIntTab(event, tabId) {
  // Deactivate all integration tabs
  const tabLinks = document.querySelectorAll(".int-tab-link");
  const tabContents = document.querySelectorAll(".integration-tab-content");
  
  tabLinks.forEach(link => link.classList.remove("active"));
  tabContents.forEach(content => content.classList.remove("active"));
  
  // Activate selected
  event.currentTarget.classList.add("active");
  document.getElementById(`int-${tabId}`).classList.add("active");
}

// Local Clinical Decision Logic Engine
function runSimulation(event) {
  event.preventDefault();
  
  const meds = Array.from(state.medications);
  if (meds.length === 0) {
    alert("Please add at least one medication to perform analysis.");
    return;
  }
  
  const age = parseInt(document.getElementById("patient-age").value) || 65;
  const eGFR = document.getElementById("patient-egfr").value;
  
  const condCkd = document.getElementById("cond-ckd").checked;
  const condT2d = document.getElementById("cond-t2d").checked;
  const condAfib = document.getElementById("cond-afib").checked;
  
  const allergyPenicillin = document.getElementById("allergy-penicillin").checked;
  const allergySulfa = document.getElementById("allergy-sulfa").checked;
  
  const patientConditions = [];
  if (condCkd) patientConditions.push("Chronic Kidney Disease");
  if (condT2d) patientConditions.push("Type 2 Diabetes");
  if (condAfib) patientConditions.push("Atrial Fibrillation");
  
  const patientAllergies = [];
  if (allergyPenicillin) patientAllergies.push("Penicillin");
  if (allergySulfa) patientAllergies.push("Sulfa");

  // Output containers
  const interactions = [];
  const beers = [];
  const contraindications = [];
  const alternatives = [];
  
  let score = 100;
  
  // 1. Drug-Drug Interactions
  const medSet = new Set(meds);
  
  if (medSet.has("warfarin") && medSet.has("ibuprofen")) {
    interactions.push({
      title: "Warfarin + Ibuprofen",
      severity: "High (Contraindicated)",
      type: "danger",
      desc: "Synergistic risk of major bleeding and gastric ulceration. NSAIDs inhibit platelet aggregation and cause gastric mucosal damage, severely multiplying warfarin bleeding risk.",
      source: "FDA Label Alert / RxNorm Class Interaction"
    });
    score -= 25;
  }
  
  if (medSet.has("warfarin") && medSet.has("aspirin")) {
    interactions.push({
      title: "Warfarin + Aspirin",
      severity: "High (Major)",
      type: "danger",
      desc: "Concomitant use of systemic anticoagulants and antiplatelet agents increases the risk of serious bleeding events significantly. Requires close monitoring of INR.",
      source: "OpenFDA Label Section 5.1"
    });
    score -= 15;
  }
  
  if (medSet.has("aspirin") && medSet.has("ibuprofen")) {
    interactions.push({
      title: "Aspirin + Ibuprofen",
      severity: "Moderate",
      type: "warning",
      desc: "Ibuprofen may interfere with the cardioprotective antiplatelet effect of low-dose aspirin. Additionally, combined use increases overall gastrointestinal bleeding risk.",
      source: "FDA Drug Safety Communication"
    });
    score -= 8;
  }
  
  if (medSet.has("metformin") && medSet.has("lisinopril")) {
    interactions.push({
      title: "Metformin + Lisinopril",
      severity: "Moderate",
      type: "warning",
      desc: "ACE Inhibitors (Lisinopril) may increase sensitivity to insulin and potentiate the hypoglycemic effect of Metformin. Monitor blood glucose closely.",
      source: "DailyMed Interaction Database"
    });
    score -= 8;
  }
  
  if (medSet.has("lisinopril") && medSet.has("aspirin")) {
    interactions.push({
      title: "Lisinopril + Aspirin",
      severity: "Moderate",
      type: "warning",
      desc: "Concomitant administration of NSAIDs/Aspirin with ACE inhibitors may decrease glomerular filtration and attenuate the antihypertensive effect of Lisinopril.",
      source: "RxNorm Class Reference"
    });
    score -= 8;
  }
  
  // 2. Geriatric Risks (Beers Criteria for Age >= 65)
  if (age >= 65) {
    if (medSet.has("diazepam")) {
      beers.push({
        title: "Diazepam (Benzodiazepine)",
        severity: "High Risk",
        type: "danger",
        desc: "Potent long-acting benzodiazepine. Older adults have increased sensitivity, slower metabolism, and highly elevated risk of cognitive impairment, delirium, falls, fractures, and motor vehicle crashes.",
        source: "AGS Beers Criteria 2023 Update"
      });
      score -= 10;
    }
    
    if (medSet.has("zolpidem")) {
      beers.push({
        title: "Zolpidem (Non-benzodiazepine Receptor Agonist)",
        severity: "High Risk",
        type: "danger",
        desc: "Z-drug sedative. Mimics benzodiazepine adverse effect profile in older adults. Associated with falls, delirium, and minimal improvement in sleep latency.",
        source: "AGS Beers Criteria 2023 Update"
      });
      score -= 10;
    }
  }
  
  // 3. Contraindications (Meds vs Allergies/Conditions/Renal)
  if (medSet.has("ibuprofen")) {
    if (condCkd || eGFR === "severe" || eGFR === "moderate") {
      contraindications.push({
        title: "Ibuprofen in Renal Impairment",
        severity: "Contraindicated",
        type: "danger",
        desc: "NSAIDs inhibit renal prostaglandins, leading to acute kidney injury, worsening chronic kidney disease, fluid retention, and severe hyperkalemia.",
        source: "DailyMed Label Contraindications"
      });
      score -= 25;
      
      alternatives.push({
        title: "Alternative for Ibuprofen (CKD)",
        severity: "Preferred Analgesic",
        type: "success",
        desc: "Consider <strong>Acetaminophen</strong> (Tylenol) as a first-line alternative for mild-to-moderate pain. It does not inhibit renal prostaglandins or cause acute kidney injury.",
        source: "Clinical Guideline Recommendation"
      });
    } else if (medSet.has("warfarin")) {
      alternatives.push({
        title: "Alternative for Ibuprofen (Anticoagulated)",
        severity: "Preferred Analgesic",
        type: "success",
        desc: "Consider <strong>Acetaminophen</strong> instead of Ibuprofen to avoid dangerous synergistic bleeding risk. Limit acetaminophen dose to &lt; 2g daily if on long-term warfarin.",
        source: "Anticoagulation Forum Best Practices"
      });
    }
  }
  
  if (medSet.has("metformin") && eGFR === "severe") {
    contraindications.push({
      title: "Metformin in Severe Renal Impairment",
      severity: "Contraindicated (eGFR < 30)",
      type: "danger",
      desc: "Metformin is renally cleared. Accumulation in patients with eGFR &lt; 30 mL/min significantly increases the risk of fatal Metformin-Associated Lactic Acidosis (MALA).",
      source: "FDA Boxed Warning"
    });
    score -= 25;
    
    alternatives.push({
      title: "Alternative for Metformin (Severe CKD)",
      severity: "Preferred Antidiabetic",
      type: "success",
      desc: "Discontinue Metformin. Consider DPP-4 Inhibitors (e.g. <strong>Linagliptin</strong>, which does not require renal dose adjustment) or insulin, depending on HbA1c targets.",
      source: "ADA Guidelines for Renal Diabetes Care"
    });
  }
  
  if (medSet.has("amoxicillin") && allergyPenicillin) {
    contraindications.push({
      title: "Amoxicillin in Penicillin Allergy",
      severity: "Contraindicated (Allergy)",
      type: "danger",
      desc: "Cross-reactivity in patients with confirmed IgE-mediated penicillin allergy is nearly 100% for aminopenicillins, presenting severe risk of anaphylaxis.",
      source: "FDA Warnings & Precautions"
    });
    score -= 25;
    
    alternatives.push({
      title: "Alternative for Amoxicillin (Penicillin-Allergic)",
      severity: "Preferred Antibiotic",
      type: "success",
      desc: "Consider Macrolides (e.g. <strong>Azithromycin</strong>) or Lincosamides (e.g. <strong>Clindamycin</strong>) to treat the target infection, completely bypassing penicillin beta-lactam structures.",
      source: "Infectious Disease Society (IDSA) Guidelines"
    });
  }
  
  if ((medSet.has("diazepam") || medSet.has("zolpidem")) && age >= 65) {
    alternatives.push({
      title: "Alternatives for Benzodiazepines/Sedatives",
      severity: "Preferred Cognitive/Anxiolytic",
      type: "success",
      desc: "For anxiety, consider SSRIs/SNRIs or <strong>Buspirone</strong>. For insomnia, prioritize non-pharmacological <strong>CBT-I</strong> (Cognitive Behavioral Therapy for Insomnia) or melatonin receptor agonists (Ramelteon).",
      source: "Beers Deprescribing Opportunity Guide"
    });
  }
  
  // Boundary score check
  score = Math.max(10, score);
  
  // Update the UI
  document.getElementById("results-placeholder").classList.add("hidden");
  const content = document.getElementById("results-content");
  content.classList.remove("hidden");
  
  // Animate and set score
  const scoreValEl = document.getElementById("score-value");
  scoreValEl.textContent = score;
  
  // Set ring stroke-dashoffset: 314.15 * (1 - score / 100)
  const ringFill = document.getElementById("score-ring-fill");
  const dashoffset = 314.15 * (1 - score / 100);
  ringFill.style.strokeDashoffset = dashoffset;
  
  // Update badge color
  const badge = document.getElementById("risk-badge");
  const summaryText = document.getElementById("risk-summary-text");
  
  badge.className = "badge";
  if (score >= 80) {
    badge.textContent = "Low Risk";
    badge.classList.add("low");
    ringFill.style.stroke = "#10b981"; // success
    summaryText.textContent = "The regimen is safety-validated. Ensure regular clinical reviews.";
  } else if (score >= 50) {
    badge.textContent = "Moderate Risk";
    badge.classList.add("moderate");
    ringFill.style.stroke = "#f59e0b"; // warning
    summaryText.textContent = `A safety score of ${score}/100 indicates moderate risks. Monitor for side effects and drug-drug interactions.`;
  } else {
    badge.textContent = "High Risk";
    badge.classList.add("high");
    ringFill.style.stroke = "#ef4444"; // danger
    summaryText.textContent = `A safety score of ${score}/100 is highly critical. Review contraindications and evaluate alternatives immediately.`;
  }
  
  // Render lists
  renderList("interactions-list", interactions, "No drug-drug interactions detected for this combination.");
  renderList("beers-list", beers, "No geriatric (Beers Criteria) risks flagged for this patient profile.");
  renderList("contraindications-list", contraindications, "No patient-specific contraindications or allergy warnings found.");
  renderList("alternatives-list", alternatives, "No replacement alternatives necessary for the current safe regimen.");
}

function renderList(elementId, items, emptyText) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  el.innerHTML = "";
  
  if (items.length === 0) {
    el.innerHTML = `
      <div class="no-alerts">
        <div class="no-alerts-icon">✅</div>
        <p>${emptyText}</p>
      </div>
    `;
    return;
  }
  
  items.forEach(item => {
    const card = document.createElement("div");
    card.className = `alert-item ${item.type}-border`;
    card.innerHTML = `
      <div class="alert-item-header">
        <span class="alert-item-title">${item.title}</span>
        <span class="tag tag-${item.type === 'danger' ? 'danger' : 'warning'}">${item.severity}</span>
      </div>
      <p class="alert-item-desc">${item.desc}</p>
      <div class="alert-item-footer">Source: ${item.source}</div>
    `;
    el.appendChild(card);
  });
}
