import fs from "node:fs";
import path from "node:path";

export const rootDir = process.cwd();
export const projectsDir = path.join(rootDir, "projects");

export function loadEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

export function projectPath(projectName) {
  if (!projectName || projectName.includes("..") || /[\\/:*?"<>|]/.test(projectName)) {
    throw new Error("Project name must be a simple folder name.");
  }
  return path.join(projectsDir, projectName);
}
