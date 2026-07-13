import path from "node:path";
import { projectsDir } from "../config.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/files.js";

const orgPath = () => path.join(projectsDir, "organization.json");

const defaultOrganization = {
  clients: [
    { id: "digital-bee", name: "Digital Bee", industry: "AI marketing", contact: "Internal team", createdAt: "2026-05-25T00:00:00.000Z" }
  ],
  campaigns: [
    { id: "demo-campaign", clientId: "digital-bee", name: "Demo Content Production", objective: "Showcase AI UGC and clipping workflow", status: "active", createdAt: "2026-05-25T00:00:00.000Z" }
  ],
  staff: [
    { id: "admin", name: "Admin", role: "admin", email: "admin@digitalbee.ai" },
    { id: "editor", name: "Editor", role: "staff-editor", email: "editor@digitalbee.ai" },
    { id: "reviewer", name: "Reviewer", role: "manager-client", email: "reviewer@digitalbee.ai", clientId: "digital-bee" }
  ]
};

function slugify(text, fallback) {
  return String(text || fallback || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || `${fallback || "item"}-${Date.now()}`;
}

export function readOrganization() {
  ensureDir(projectsDir);
  if (!fileExists(orgPath())) {
    writeJson(orgPath(), defaultOrganization);
    return defaultOrganization;
  }
  const data = readJson(orgPath());
  return {
    clients: Array.isArray(data.clients) ? data.clients : [],
    campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
    staff: Array.isArray(data.staff) ? data.staff : []
  };
}

function writeOrganization(data) {
  writeJson(orgPath(), data);
  return data;
}

export function createClient({ name, industry = "", contact = "" }) {
  const data = readOrganization();
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Client name is required.");
  const id = slugify(cleanName, "client");
  if (data.clients.some((client) => client.id === id)) throw new Error("Client already exists.");
  const client = { id, name: cleanName, industry, contact, createdAt: new Date().toISOString() };
  writeOrganization({ ...data, clients: [...data.clients, client] });
  return client;
}

export function createCampaign({ clientId, name, objective = "", status = "active" }) {
  const data = readOrganization();
  if (!data.clients.some((client) => client.id === clientId)) throw new Error("Select a valid client.");
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Campaign name is required.");
  const id = slugify(`${clientId}-${cleanName}`, "campaign");
  if (data.campaigns.some((campaign) => campaign.id === id)) throw new Error("Campaign already exists.");
  const campaign = { id, clientId, name: cleanName, objective, status, createdAt: new Date().toISOString() };
  writeOrganization({ ...data, campaigns: [...data.campaigns, campaign] });
  return campaign;
}
