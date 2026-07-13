import { useEffect, useState } from "react";
import { Clapperboard, Sparkles, X } from "lucide-react";

export function CreateProjectModal({ open, initialType = "ai-generator", app, onClose, onCreate }) {
  const [form, setForm] = useState({ name: "", type: initialType, clientId: "", campaignId: "", assignedStaffId: "", reviewerId: "", folderId: "", priority: "normal" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setForm((current) => ({ ...current, type: initialType || "ai-generator" }));
  }, [initialType, open]);

  if (!open) return null;

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({ ...form, name: form.name.trim() });
      setForm({ name: "", type: initialType, clientId: "", campaignId: "", assignedStaffId: "", reviewerId: "", folderId: "", priority: "normal" });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const clients = app.organization?.clients || [];
  const campaigns = (app.organization?.campaigns || []).filter((campaign) => !form.clientId || campaign.clientId === form.clientId);
  const staff = app.organization?.staff || [];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
        <header className="modal__header"><div><p className="eyebrow">New workspace</p><h2 id="create-project-title">Create project</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
        <form className="modal__body" onSubmit={submit}>
          <div className="type-choice" role="radiogroup" aria-label="Project type">
            <button className={form.type === "ai-generator" ? "selected" : ""} type="button" role="radio" aria-checked={form.type === "ai-generator"} onClick={() => update("type", "ai-generator")}><Sparkles size={20} /><span><strong>AI Generator</strong><small>Replicate winning UGC flow</small></span></button>
            <button className={form.type === "auto-clipper" ? "selected" : ""} type="button" role="radio" aria-checked={form.type === "auto-clipper"} onClick={() => update("type", "auto-clipper")}><Clapperboard size={20} /><span><strong>Auto Clipper</strong><small>Create social-ready highlights</small></span></button>
          </div>
          <label>Project name<input autoFocus value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Campaign or content name" /></label>
          <div className="form-columns">
            <label>Client<select value={form.clientId} onChange={(event) => update("clientId", event.target.value)}><option value="">No client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label>Campaign<select value={form.campaignId} onChange={(event) => update("campaignId", event.target.value)}><option value="">No campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
            <label>Assigned editor<select value={form.assignedStaffId} onChange={(event) => update("assignedStaffId", event.target.value)}><option value="">Unassigned</option>{staff.filter((person) => person.role !== "manager-client").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label>Reviewer<select value={form.reviewerId} onChange={(event) => update("reviewerId", event.target.value)}><option value="">No reviewer</option>{staff.filter((person) => person.role !== "staff-editor").map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label>Folder<select value={form.folderId} onChange={(event) => update("folderId", event.target.value)}><option value="">All projects</option>{(app.folders || []).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
            <label>Priority<select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
          </div>
          <footer className="modal__footer"><button className="btn btn--secondary" type="button" onClick={onClose}>Cancel</button><button className="btn btn--primary" type="submit" disabled={!form.name.trim() || submitting}>{submitting ? "Creating..." : "Create project"}</button></footer>
        </form>
      </section>
    </div>
  );
}
