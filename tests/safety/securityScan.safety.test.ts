import { promises as fs } from "node:fs";
import path from "node:path";

const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".json",
  ".md",
  ".yml",
  ".yaml",
]);
const SCAN_FOLDERS = ["src", "tests", "docs"];
const SCAN_FILES = [
  "README.md",
  "GET_STARTED.md",
  "package.json",
  ".env.example",
];
const SKIP_FOLDERS = new Set(["node_modules", "dist", ".git", "coverage"]);

const SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "OpenAI style key", regex: /sk-[A-Za-z0-9]{20,}/g },
  { label: "Google API key", regex: /AIza[0-9A-Za-z_-]{20,}/g },
  { label: "GitHub token", regex: /(ghp|github_pat)_[A-Za-z0-9_]{30,}/g },
  { label: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{20,}/g },
  {
    label: "Private key block",
    regex: /-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/g,
  },
];

async function collectFilesRecursively(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_FOLDERS.has(entry.name)) {
        continue;
      }

      files.push(...(await collectFilesRecursively(fullPath)));
      continue;
    }

    if (ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("Phase 4 security scan", () => {
  it("contains no hardcoded secrets in repository files", async () => {
    const files = new Set<string>();

    for (const folder of SCAN_FOLDERS) {
      const folderPath = path.join(WORKSPACE_ROOT, folder);
      const exists = await fs
        .access(folderPath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        continue;
      }

      const discovered = await collectFilesRecursively(folderPath);
      discovered.forEach((filePath) => files.add(filePath));
    }

    for (const fileName of SCAN_FILES) {
      const fullPath = path.join(WORKSPACE_ROOT, fileName);
      const exists = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        files.add(fullPath);
      }
    }

    const findings: string[] = [];

    for (const filePath of files) {
      const relativePath = path
        .relative(WORKSPACE_ROOT, filePath)
        .replace(/\\/g, "/");
      const content = await fs.readFile(filePath, "utf8");

      for (const pattern of SECRET_PATTERNS) {
        const matches = content.match(pattern.regex) ?? [];
        for (const match of matches) {
          findings.push(
            `${relativePath}: ${pattern.label} (${match.slice(0, 24)}...)`,
          );
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
