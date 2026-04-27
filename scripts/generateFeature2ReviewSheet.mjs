import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT_PATH = "docs/clinical/feature2_review_sheet.csv";

const columns = [
  "review_id",
  "target_risk_bucket",
  "patient_age_band",
  "medication_count_target",
  "primary_review_focus",
  "assigned_reviewer",
  "tool_risk_level",
  "reviewer_risk_level",
  "risk_agreement",
  "major_contra_capture",
  "beers_correctness",
  "duplicate_class_correctness",
  "dashboard_completeness",
  "reviewer_notes",
];

const starterRows = [
  ["F2-CHART-001", "low", "18-44", "1-4", "Baseline score/grade sanity"],
  ["F2-CHART-002", "low", "45-64", "3-6", "Low-risk opportunity quality"],
  ["F2-CHART-003", "medium", "45-64", "5-8", "Moderate interaction weighting"],
  ["F2-CHART-004", "medium", "65-74", "6-10", "Elderly Beers flag precision"],
  ["F2-CHART-005", "medium", "75-84", "6-10", "Polypharmacy deduction calibration"],
  ["F2-CHART-006", "high", "65-74", "8-12", "Major interaction capture"],
  ["F2-CHART-007", "high", "75-84", "10-14", "Duplicate-class risk correctness"],
  ["F2-CHART-008", "high", "85+", "8-12", "Beers plus interaction compounding"],
  ["F2-CHART-009", "critical", "65-74", "8-14", "Contraindicated/major sensitivity"],
  ["F2-CHART-010", "critical", "75-84", "10-16", "End-to-end dashboard completeness"],
];

const distributionTargets = {
  low: 25,
  medium: 35,
  high: 30,
  critical: 10,
};

const defaultsByBucket = {
  low: { ageBand: "45-64", medTarget: "2-5", focus: "Low-risk baseline consistency" },
  medium: { ageBand: "65-74", medTarget: "5-9", focus: "Balanced deduction calibration" },
  high: { ageBand: "75-84", medTarget: "8-12", focus: "High-risk capture and triage quality" },
  critical: { ageBand: "75-84", medTarget: "10-16", focus: "Critical risk sensitivity and prioritization" },
};

function parseOutputPath(argv) {
  const outArgIndex = argv.findIndex((item) => item === "--out");
  if (outArgIndex === -1) {
    return DEFAULT_OUTPUT_PATH;
  }

  const output = argv[outArgIndex + 1];
  if (!output) {
    throw new Error("Expected a value after --out");
  }

  return output;
}

function countBuckets(rows) {
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };

  for (const row of rows) {
    const bucket = row[1];
    if (bucket in counts) {
      counts[bucket] += 1;
    }
  }

  return counts;
}

function buildRows() {
  const rows = starterRows.map((row) => [
    ...row,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);

  const currentCounts = countBuckets(rows);

  for (let index = 11; index <= 100; index += 1) {
    const reviewId = `F2-CHART-${String(index).padStart(3, "0")}`;

    const bucket = ["low", "medium", "high", "critical"].find(
      (candidate) => currentCounts[candidate] < distributionTargets[candidate],
    );

    if (!bucket) {
      throw new Error("Unable to assign risk bucket while building review rows.");
    }

    currentCounts[bucket] += 1;
    const defaults = defaultsByBucket[bucket];

    rows.push([
      reviewId,
      bucket,
      defaults.ageBand,
      defaults.medTarget,
      defaults.focus,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }

  return rows;
}

function csvEscape(value) {
  const serialized = String(value ?? "");
  if (serialized.includes(",") || serialized.includes("\"") || serialized.includes("\n")) {
    return `"${serialized.replaceAll("\"", "\"\"")}"`;
  }

  return serialized;
}

function renderCsv(rows) {
  const headerLine = columns.join(",");
  const bodyLines = rows.map((row) => row.map(csvEscape).join(","));
  return [headerLine, ...bodyLines].join("\n") + "\n";
}

function main() {
  const outputPath = parseOutputPath(process.argv.slice(2));
  const absoluteOutputPath = path.resolve(process.cwd(), outputPath);

  const rows = buildRows();
  const csvContent = renderCsv(rows);

  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  fs.writeFileSync(absoluteOutputPath, csvContent, "utf8");

  const counts = countBuckets(rows);
  console.log("Generated Feature 2 review sheet:");
  console.log(`- Output: ${absoluteOutputPath}`);
  console.log("- Risk bucket distribution:");
  console.log(`  - low: ${counts.low}`);
  console.log(`  - medium: ${counts.medium}`);
  console.log(`  - high: ${counts.high}`);
  console.log(`  - critical: ${counts.critical}`);
}

main();
