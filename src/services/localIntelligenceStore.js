import fs from "node:fs";
import path from "node:path";

const emptyCampaign = () => ({ brief: {}, sources: [], reports: [], activeReportId: "" });
const clone = (value) => JSON.parse(JSON.stringify(value));

export function createLocalIntelligenceStore(filePath) {
  if (!filePath) throw new Error("Intelligence store path is required.");

  function read() {
    if (!fs.existsSync(filePath)) return { campaigns: {} };
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { campaigns: data?.campaigns && typeof data.campaigns === "object" ? data.campaigns : {} };
  }

  function write(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  }

  function updateCampaign(campaignId, change) {
    if (!campaignId) throw new Error("Campaign id is required.");
    const data = read();
    const current = { ...emptyCampaign(), ...(data.campaigns[campaignId] || {}) };
    const next = change(clone(current));
    data.campaigns[campaignId] = next;
    write(data);
    return clone(next);
  }

  function getCampaign(campaignId) {
    const campaign = { ...emptyCampaign(), ...(read().campaigns[campaignId] || {}) };
    return {
      ...clone(campaign),
      activeReport: clone(campaign.reports.find((report) => report.id === campaign.activeReportId) || null)
    };
  }

  return {
    listCampaigns() {
      return Object.entries(read().campaigns).map(([campaignId]) => ({ campaignId, ...getCampaign(campaignId) }));
    },
    getCampaign,
    saveBrief(campaignId, brief) {
      return updateCampaign(campaignId, (campaign) => ({
        ...campaign,
        brief: clone(brief || {})
      })).brief;
    },
    addSource(campaignId, source) {
      if (!source?.id) throw new Error("Research source id is required.");
      const stored = { ...clone(source), campaignId, createdAt: source.createdAt || new Date().toISOString() };
      updateCampaign(campaignId, (campaign) => ({
        ...campaign,
        sources: [...campaign.sources.filter((item) => item.id !== stored.id), stored]
      }));
      return stored;
    },
    deleteSource(campaignId, sourceId) {
      return updateCampaign(campaignId, (campaign) => ({
        ...campaign,
        sources: campaign.sources.filter((source) => source.id !== sourceId)
      }));
    },
    saveReport(campaignId, report) {
      if (!report?.id) throw new Error("Market report id is required.");
      const stored = {
        ...clone(report),
        campaignId,
        status: report.status || "draft",
        createdAt: report.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      updateCampaign(campaignId, (campaign) => ({
        ...campaign,
        reports: [...campaign.reports.filter((item) => item.id !== stored.id), stored],
        activeReportId: stored.id
      }));
      return stored;
    },
    updateReport(campaignId, reportId, patch) {
      let updated = null;
      updateCampaign(campaignId, (campaign) => ({
        ...campaign,
        reports: campaign.reports.map((report) => {
          if (report.id !== reportId) return report;
          updated = { ...report, ...clone(patch || {}), id: report.id, campaignId, updatedAt: new Date().toISOString() };
          return updated;
        })
      }));
      if (!updated) throw new Error("Market report not found.");
      return updated;
    },
    approveReport(campaignId, reportId, actorId) {
      if (!actorId) throw new Error("Approving user is required.");
      return this.updateReport(campaignId, reportId, {
        status: "approved",
        approvedBy: actorId,
        approvedAt: new Date().toISOString()
      });
    }
  };
}
