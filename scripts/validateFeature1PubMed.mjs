import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PUBMED_BASE_URL =
  (process.env.PUBMED_API_URL ??
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? "5000");
const DOC_PATH = resolve("docs", "FEATURE_WORKING_VALIDATION_AND_LOG.md");

const DRUG_PAIRS = [
  ["warfarin", "ibuprofen"],
  ["warfarin", "aspirin"],
  ["warfarin", "amiodarone"],
  ["warfarin", "fluconazole"],
  ["warfarin", "metronidazole"],
  ["warfarin", "trimethoprim"],
  ["warfarin", "simvastatin"],
  ["warfarin", "clopidogrel"],
  ["warfarin", "naproxen"],
  ["warfarin", "sertraline"],
  ["clopidogrel", "omeprazole"],
  ["clopidogrel", "esomeprazole"],
  ["simvastatin", "clarithromycin"],
  ["simvastatin", "itraconazole"],
  ["simvastatin", "amiodarone"],
  ["atorvastatin", "clarithromycin"],
  ["digoxin", "amiodarone"],
  ["digoxin", "verapamil"],
  ["digoxin", "diltiazem"],
  ["digoxin", "furosemide"],
  ["lisinopril", "spironolactone"],
  ["lisinopril", "losartan"],
  ["losartan", "spironolactone"],
  ["enalapril", "potassium chloride"],
  ["metformin", "cimetidine"],
  ["metformin", "contrast media"],
  ["insulin", "propranolol"],
  ["insulin", "prednisone"],
  ["sertraline", "linezolid"],
  ["fluoxetine", "tramadol"],
  ["paroxetine", "tamoxifen"],
  ["citalopram", "omeprazole"],
  ["amitriptyline", "fluoxetine"],
  ["venlafaxine", "tramadol"],
  ["lithium", "ibuprofen"],
  ["lithium", "lisinopril"],
  ["lithium", "hydrochlorothiazide"],
  ["carbamazepine", "clarithromycin"],
  ["carbamazepine", "phenytoin"],
  ["phenytoin", "valproate"],
  ["levothyroxine", "calcium carbonate"],
  ["levothyroxine", "ferrous sulfate"],
  ["sildenafil", "nitroglycerin"],
  ["tadalafil", "nitroglycerin"],
  ["theophylline", "ciprofloxacin"],
  ["methotrexate", "trimethoprim"],
  ["methotrexate", "ibuprofen"],
  ["allopurinol", "azathioprine"],
  ["valproate", "lamotrigine"],
  ["codeine", "fluoxetine"],
];

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function runSearch(drugA, drugB) {
  const term = `${drugA} AND ${drugB} AND (interaction OR adverse OR toxicity OR bleeding)`;
  const url = new URL(`${PUBMED_BASE_URL}/esearch.fcgi`);
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("term", term);
  url.searchParams.set("retmode", "json");
  url.searchParams.set("retmax", "5");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("tool", "mediguard-mcp-feature1-validator");

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const started = Date.now();
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - started;

    if (!response.ok) {
      return {
        drugA,
        drugB,
        ok: false,
        status: response.status,
        elapsedMs,
        idCount: 0,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const payload = await response.json();
    const idList = Array.isArray(payload?.esearchresult?.idlist)
      ? payload.esearchresult.idlist
      : [];

    return {
      drugA,
      drugB,
      ok: true,
      status: response.status,
      elapsedMs,
      idCount: idList.length,
    };
  } catch (error) {
    return {
      drugA,
      drugB,
      ok: false,
      status: "ERR",
      elapsedMs: Date.now() - started,
      idCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const results = [];

  for (const [drugA, drugB] of DRUG_PAIRS) {
    const result = await runSearch(drugA, drugB);
    results.push(result);
  }

  const total = results.length;
  const successful = results.filter((result) => result.ok);
  const successCount = successful.length;
  const withHits = successful.filter((result) => result.idCount > 0).length;
  const under500 = successful.filter((result) => result.elapsedMs < 500).length;
  const latencies = results.map((result) => result.elapsedMs);
  const avgMs =
    latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
  const p95Ms = percentile(latencies, 0.95);
  const failures = results.filter((result) => !result.ok).slice(0, 10);

  const summary = {
    timestamp: new Date().toISOString(),
    total,
    successCount,
    withHits,
    under500,
    avgMs,
    p95Ms,
    failures,
  };

  const existingLog = await readFile(DOC_PATH, "utf8");
  const hasRunHistoryHeading = existingLog.includes(
    "## Automated validation run history",
  );

  const logEntry = [
    "",
    hasRunHistoryHeading ? "" : "## Automated validation run history",
    hasRunHistoryHeading ? "" : "",
    `### ${summary.timestamp}`,
    `- Command: npm run validate:feature1`,
    `- Pair count: ${summary.total}`,
    `- Success count: ${summary.successCount}/${summary.total}`,
    `- Non-empty hit count: ${summary.withHits}/${summary.total}`,
    `- Under 500ms: ${summary.under500}/${summary.total}`,
    `- Average latency: ${summary.avgMs}ms`,
    `- P95 latency: ${summary.p95Ms}ms`,
    failures.length > 0
      ? `- Failures: ${failures
          .map(
            (failure) =>
              `${failure.drugA} + ${failure.drugB} (${failure.status}; ${failure.error ?? "unknown"})`,
          )
          .join("; ")}`
      : "- Failures: none",
    "",
  ].join("\n");

  await appendFile(DOC_PATH, logEntry, "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nValidation summary appended to ${DOC_PATH}`);
}

main().catch((error) => {
  console.error("Feature 1 validation script failed", error);
  process.exitCode = 1;
});
