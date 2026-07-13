import fs from "node:fs";
import path from "node:path";
import { projectPath, projectsDir } from "../config.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/files.js";

export const PROJECT_TYPES = new Set(["ai-generator", "auto-clipper"]);
const foldersPath = () => path.join(projectsDir, "folders.json");

function normalizeType(type) {
  return PROJECT_TYPES.has(type) ? type : "ai-generator";
}

function readProjectMeta(projectName) {
  const filePath = path.join(projectPath(projectName), "project.json");
  return fileExists(filePath) ? readJson(filePath) : {};
}

export function detectProjectType(projectName) {
  const base = projectPath(projectName);
  const meta = readProjectMeta(projectName);
  if (PROJECT_TYPES.has(meta.type)) return meta.type;
  if (
    fileExists(path.join(base, "clipper", "source", "source-video.mp4")) ||
    fileExists(path.join(base, "clipper", "generated", "highlight-candidates.json")) ||
    fileExists(path.join(base, "renders", "final-clip.mp4"))
  ) return "auto-clipper";
  return "ai-generator";
}

export function getProjectMeta(projectName) {
  const meta = readProjectMeta(projectName);
  return {
    name: projectName,
    createdAt: meta.createdAt || null,
    status: meta.status || "created",
    type: detectProjectType(projectName),
    folderId: meta.folderId || "",
    clientId: meta.clientId || "",
    campaignId: meta.campaignId || "",
    assignedStaffId: meta.assignedStaffId || "",
    reviewerId: meta.reviewerId || "",
    priority: meta.priority || "normal",
    approvalStatus: meta.approvalStatus || "draft",
    approvalFeedback: meta.approvalFeedback || "",
    reviewSubmittedAt: meta.reviewSubmittedAt || "",
    reviewedAt: meta.reviewedAt || ""
  };
}

export function updateProjectMeta(projectName, patch = {}) {
  const filePath = path.join(projectPath(projectName), "project.json");
  const current = readProjectMeta(projectName);
  const next = {
    ...current,
    name: projectName,
    ...patch,
    type: normalizeType(patch.type || current.type || detectProjectType(projectName)),
    folderId: patch.folderId ?? current.folderId ?? "",
    clientId: patch.clientId ?? current.clientId ?? "",
    campaignId: patch.campaignId ?? current.campaignId ?? "",
    assignedStaffId: patch.assignedStaffId ?? current.assignedStaffId ?? "",
    reviewerId: patch.reviewerId ?? current.reviewerId ?? "",
    priority: patch.priority ?? current.priority ?? "normal",
    approvalStatus: patch.approvalStatus ?? current.approvalStatus ?? "draft",
    approvalFeedback: patch.approvalFeedback ?? current.approvalFeedback ?? "",
    reviewSubmittedAt: patch.reviewSubmittedAt ?? current.reviewSubmittedAt ?? "",
    reviewedAt: patch.reviewedAt ?? current.reviewedAt ?? ""
  };
  writeJson(filePath, next);
  return next;
}

export function readFolders() {
  ensureDir(projectsDir);
  if (!fileExists(foldersPath())) return [];
  const data = readJson(foldersPath());
  return Array.isArray(data.folders) ? data.folders : [];
}

export function writeFolders(folders) {
  writeJson(foldersPath(), { folders });
}

export function createFolder(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Folder name is required.");
  const id = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `folder-${Date.now()}`;
  const folders = readFolders();
  if (folders.some((folder) => folder.id === id)) throw new Error("A folder with this name already exists.");
  const folder = { id, name: cleanName, createdAt: new Date().toISOString() };
  writeFolders([...folders, folder]);
  return folder;
}

export function renameFolder(folderId, name) {
  const folders = readFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) throw new Error("Folder not found.");
  folder.name = String(name || "").trim() || folder.name;
  writeFolders(folders);
  return folder;
}

export function deleteFolder(folderId) {
  const folders = readFolders().filter((folder) => folder.id !== folderId);
  writeFolders(folders);
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const meta = getProjectMeta(entry.name);
    if (meta.folderId === folderId) updateProjectMeta(entry.name, { folderId: "" });
  }
}

export function deleteProject(projectName) {
  const base = path.resolve(projectPath(projectName));
  const root = path.resolve(projectsDir);
  if (!base.startsWith(`${root}${path.sep}`)) throw new Error("Invalid project path.");
  if (!fs.existsSync(base)) throw new Error("Project not found.");
  fs.rmSync(base, { recursive: true, force: true });
}

export function createProject(projectName, {
  type = "ai-generator",
  folderId = "",
  clientId = "",
  campaignId = "",
  assignedStaffId = "",
  reviewerId = "",
  priority = "normal"
} = {}) {
  const base = projectPath(projectName);
  const dirs = [
    "reference",
    "product",
    "character",
    "analysis/frames",
    "generated",
    "clipper/source",
    "clipper/reaction",
    "clipper/analysis",
    "clipper/generated",
    "assets/images",
    "assets/videos",
    "assets/audio",
    "renders"
  ];

  for (const dir of dirs) ensureDir(path.join(base, dir));

  writeJson(path.join(base, "project.json"), {
    name: projectName,
    createdAt: new Date().toISOString(),
    status: "created",
    type: normalizeType(type),
    folderId,
    clientId,
    campaignId,
    assignedStaffId,
    reviewerId,
    priority,
    approvalStatus: "draft",
    approvalFeedback: "",
    reviewSubmittedAt: "",
    reviewedAt: ""
  });

  return base;
}
