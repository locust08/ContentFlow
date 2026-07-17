const PROJECT_SUMMARY_SELECT = `
  SELECT
    p.*,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND a.kind = 'reference-video') AS reference_count,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND a.kind = 'product-image') AS product_count,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND a.kind = 'character-reference') AS character_count,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND a.kind = 'reaction-character') AS reaction_count,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND a.kind = 'clipper-source') AS clipper_source_count,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND (a.media_type = 'image' OR a.media_type LIKE 'image/%')) AS image_count,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND (a.media_type = 'video' OR a.media_type LIKE 'video/%')) AS video_count,
    (SELECT COUNT(*) FROM cf_assets a WHERE a.project_name = p.name AND (a.media_type = 'audio' OR a.media_type LIKE 'audio/%')) AS audio_count,
    (SELECT COUNT(*) FROM cf_render_jobs r WHERE r.project_name = p.name) AS render_count,
    (SELECT COUNT(*) FROM cf_render_jobs r WHERE r.project_name = p.name AND (r.render_type = 'clip' OR r.output_path LIKE 'clips/%' OR r.output_path = 'final-clip.mp4')) AS clip_render_count,
    (SELECT COUNT(*) FROM cf_render_jobs r WHERE r.project_name = p.name AND (r.output_path = 'final.mp4' OR r.output_path LIKE '%ugc%')) AS ugc_count,
    (SELECT COUNT(*) FROM cf_clip_candidates c WHERE c.project_name = p.name) AS clip_candidate_count,
    (SELECT COUNT(*) FROM cf_clip_candidates c WHERE c.project_name = p.name AND c.selected = 1) AS clip_selection_count,
    (SELECT COUNT(*) FROM cf_ugc_scripts s WHERE s.project_name = p.name) AS script_count,
    (SELECT COUNT(DISTINCT s.market_report_id) FROM cf_ugc_scripts s WHERE s.project_name = p.name) AS market_report_count,
    COALESCE((SELECT s.status FROM cf_ugc_scripts s WHERE s.project_name = p.name ORDER BY s.updated_at DESC LIMIT 1), '') AS script_status
  FROM cf_projects p
`;

function jsonObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function jsonValue(value, fallback) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapProject(row) {
  return row ? {
    name: row.name,
    type: row.type || "ai-generator",
    folderId: row.folder_id || "",
    clientId: row.client_id || "",
    campaignId: row.campaign_id || "",
    assignedStaffId: row.assigned_staff_id || "",
    reviewerId: row.reviewer_id || "",
    priority: row.priority || "normal",
    approvalStatus: row.approval_status || "draft",
    approvalFeedback: row.approval_feedback || "",
    reviewSubmittedAt: "",
    reviewedAt: "",
    hasReference: count(row.reference_count) > 0,
    hasProduct: count(row.product_count) > 0,
    hasCharacter: count(row.character_count) > 0,
    frameCount: 0,
    imageCount: count(row.image_count),
    videoCount: count(row.video_count),
    audioCount: count(row.audio_count),
    renderCount: count(row.render_count),
    hasStyleAnalysis: false,
    hasReferenceBlueprint: false,
    hasUgcVideo: count(row.ugc_count) > 0,
    hasGeneratedTranscript: false,
    hasSubtitlePlan: false,
    hasGeneratedPlan: false,
    hasMarketReport: count(row.market_report_count) > 0,
    hasUgcScript: count(row.script_count) > 0,
    scriptStatus: row.script_status || "",
    hasClipperSource: count(row.clipper_source_count) > 0,
    hasClipperTranscript: false,
    hasClipperHighlights: count(row.clip_candidate_count) > 0,
    hasClipperSelection: count(row.clip_selection_count) > 0,
    hasClipperReaction: count(row.reaction_count) > 0,
    hasClipperRender: count(row.clip_render_count) > 0,
    assets: [],
    clipCandidates: []
  } : null;
}

function mapJob(row) {
  return row ? {
    id: row.id,
    projectName: row.project_name || "",
    jobType: row.job_type,
    status: row.status,
    payload: jsonObject(row.payload),
    requestedBy: row.requested_by || "",
    outputUrl: row.output_url || "",
    result: jsonObject(row.result),
    error: row.error || "",
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  } : null;
}

function mapAsset(row) {
  return row ? {
    id: row.id,
    projectName: row.project_name || "",
    kind: row.kind,
    name: row.name,
    mediaType: row.media_type || "",
    localPath: row.local_path || "",
    objectKey: row.object_key || "",
    url: row.url || "",
    sizeBytes: count(row.size_bytes),
    checksum: row.checksum || "",
    status: row.status || "ready",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function mapClipCandidate(row) {
  if (!row) return null;
  return {
    id: String(row.id || "").includes(":") ? String(row.id).split(":").at(-1) : row.id,
    title: row.title || "Highlight",
    start: count(row.start_seconds),
    end: count(row.end_seconds),
    score: count(row.score),
    reason: row.reason || "",
    selected: count(row.selected) === 1
  };
}

function mapMedia(row) {
  return {
    id: row.id,
    name: row.output_path,
    project: row.project_name,
    projectType: row.type || row.mode || "ai-generator",
    clientId: row.client_id || "",
    campaignId: row.campaign_id || "",
    assignedStaffId: row.assigned_staff_id || "",
    reviewerId: row.reviewer_id || "",
    approvalStatus: row.approval_status || "draft",
    approvalFeedback: row.approval_feedback || "",
    status: row.status || "completed",
    renderType: row.render_type || "",
    url: row.output_url || "",
    createdAt: row.created_at
  };
}

function projectAccess(user) {
  if (user?.role === "admin") return { clause: "", bindings: [] };
  if (!user) return { clause: "1 = 0", bindings: [] };
  if (user.role === "staff-editor") {
    return { clause: "p.assigned_staff_id = ?", bindings: [user.id || "__none__"] };
  }
  if (user.role === "manager-client") {
    return {
      clause: "(p.client_id = ? OR p.reviewer_id = ?)",
      bindings: [user.clientId || "__none__", user.id || "__none__"]
    };
  }
  return { clause: "1 = 0", bindings: [] };
}

function statement(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings);
}

async function all(db, sql, bindings = []) {
  const result = await statement(db, sql, bindings).all();
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

function identifier(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function required(value, message) {
  if (!String(value || "").trim()) throw new Error(message);
}

function batchRow(results, index) {
  const result = results?.[index];
  if (!result || result.success === false) {
    throw new Error(result?.error || `D1 batch statement ${index} failed`);
  }
  return Array.isArray(result.results) ? result.results[0] || null : null;
}

export function createD1Repository(env) {
  const db = env?.DB || env;
  if (!db || typeof db.prepare !== "function") {
    throw new Error("Cloudflare D1 binding env.DB is required.");
  }

  const repository = {
    async findUser({ authUserId = "", email = "" } = {}) {
      if (!authUserId && !email) return null;
      const where = authUserId ? "auth_user_id = ?" : "auth_user_id IS NULL AND lower(email) = lower(?)";
      const identity = authUserId || email;
      const row = await statement(db, `
        SELECT id, auth_user_id, name, role, email, client_id
        FROM cf_users
        WHERE ${where}
        LIMIT 1
      `, [identity]).first();
      return row ? {
        id: row.id,
        authUserId: row.auth_user_id || authUserId,
        name: row.name,
        role: row.role || "staff-editor",
        email: row.email || email,
        clientId: row.client_id || ""
      } : null;
    },

    async listProjects(user = null) {
      const access = projectAccess(user);
      const where = access.clause ? `WHERE ${access.clause}` : "";
      const rows = await all(db, `${PROJECT_SUMMARY_SELECT} ${where} ORDER BY p.created_at DESC, p.name ASC`, access.bindings);
      return rows.map(mapProject);
    },

    async getProject(name, user = null) {
      if (!name) return null;
      const access = projectAccess(user);
      const filters = ["p.name = ?"];
      if (access.clause) filters.push(access.clause);
      const row = await statement(
        db,
        `${PROJECT_SUMMARY_SELECT} WHERE ${filters.join(" AND ")} LIMIT 1`,
        [name, ...access.bindings]
      ).first();
      return mapProject(row);
    },

    async createJob(job = {}) {
      required(job.projectName, "Project name is required.");
      required(job.jobType, "Production job type is required.");
      const id = job.id || identifier("job");
      const now = new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_production_jobs (
          id, project_name, job_type, status, payload, requested_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [
        id,
        job.projectName,
        job.jobType,
        job.status || "queued",
        JSON.stringify(jsonObject(job.payload)),
        job.requestedBy || null,
        job.createdAt || now,
        now
      ]).first();
      return mapJob(row);
    },

    async listJobs({ projectName = "", status = "", limit = 50, user = null } = {}) {
      const filters = [];
      const bindings = [];
      if (projectName) {
        filters.push("j.project_name = ?");
        bindings.push(projectName);
      }
      if (status) {
        filters.push("j.status = ?");
        bindings.push(status);
      }
      const access = projectAccess(user);
      if (access.clause) {
        filters.push(access.clause);
        bindings.push(...access.bindings);
      }
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      bindings.push(safeLimit);
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = await all(db, `
        SELECT j.* FROM cf_production_jobs j
        JOIN cf_projects p ON p.name = j.project_name
        ${where}
        ORDER BY j.created_at DESC
        LIMIT ?
      `, bindings);
      return rows.map(mapJob);
    },

    async updateJob(id, patch = {}, leaseToken = patch.leaseToken || "") {
      required(id, "Production job id is required.");
      required(leaseToken, "Production job lease token is required.");

      const status = patch.status || "processing";
      const assignments = ["status = ?"];
      const bindings = [status];
      if (Object.hasOwn(patch, "outputUrl")) {
        assignments.push("output_url = ?");
        bindings.push(patch.outputUrl || null);
      }
      if (Object.hasOwn(patch, "result")) {
        assignments.push("result = ?");
        bindings.push(JSON.stringify(jsonObject(patch.result)));
      }
      if (Object.hasOwn(patch, "error")) {
        assignments.push("error = ?");
        bindings.push(patch.error || null);
      }
      const now = new Date().toISOString();
      if (status === "completed" || status === "failed") {
        assignments.push("completed_at = COALESCE(completed_at, ?)");
        bindings.push(now);
        assignments.push("lease_expires_at = NULL");
      } else if (status === "processing") {
        assignments.push("lease_expires_at = ?");
        bindings.push(new Date(Date.now() + 15 * 60 * 1000).toISOString());
      }
      assignments.push("updated_at = ?");
      bindings.push(now, id, leaseToken);

      const row = await statement(db, `
        UPDATE cf_production_jobs
        SET ${assignments.join(", ")}
        WHERE id = ? AND lease_token = ? AND status = 'processing'
        RETURNING *
      `, bindings).first();
      return mapJob(row);
    },

    async claimNextJob(leaseToken, workerId = "production-worker") {
      required(leaseToken, "Production job lease token is required.");
      const now = new Date().toISOString();
      const leaseExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const row = await statement(db, `
        UPDATE cf_production_jobs
        SET status = 'processing', lease_token = ?, claimed_by = ?, lease_expires_at = ?,
            attempt_count = attempt_count + 1, started_at = ?, updated_at = ?
        WHERE id = (
          SELECT id FROM cf_production_jobs
          WHERE status = 'queued' OR (status = 'processing' AND lease_expires_at < ?)
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        )
        AND (status = 'queued' OR (status = 'processing' AND lease_expires_at < ?))
        RETURNING *
      `, [leaseToken, workerId, leaseExpiresAt, now, now, now, now]).first();
      return mapJob(row);
    },

    async claimJob({ workerId = "production-worker" } = {}) {
      const leaseToken = `${String(workerId || "production-worker")}:${identifier("lease")}`;
      const job = await repository.claimNextJob(leaseToken, workerId);
      return job ? { ...job, leaseToken } : null;
    },

    async updateClaimedJob(id, patch = {}) {
      return repository.updateJob(id, patch, patch.leaseToken || "");
    },

    async renewJobLease(id, leaseToken) {
      return repository.updateJob(id, { status: "processing" }, leaseToken);
    },

    async createAsset(asset = {}) {
      required(asset.projectName, "Asset project name is required.");
      required(asset.kind, "Asset kind is required.");
      required(asset.name, "Asset name is required.");
      const id = asset.id || identifier("asset");
      const now = new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_assets (
          id, project_name, kind, name, media_type, local_path, object_key, url,
          size_bytes, checksum, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (project_name, local_path, object_key)
          WHERE local_path IS NOT NULL AND object_key IS NOT NULL
        DO UPDATE SET updated_at = excluded.updated_at
        RETURNING *
      `, [
        id,
        asset.projectName,
        asset.kind,
        asset.name,
        asset.mediaType || null,
        asset.localPath || null,
        asset.objectKey || null,
        asset.url || null,
        count(asset.sizeBytes),
        asset.checksum || null,
        asset.status || "ready",
        asset.createdAt || now,
        now
      ]).first();
      return mapAsset(row);
    },

    async getAsset(id) {
      if (!id) return null;
      const row = await statement(db, "SELECT * FROM cf_assets WHERE id = ? LIMIT 1", [id]).first();
      return mapAsset(row);
    },

    async createRender(render = {}) {
      required(render.projectName, "Render project name is required.");
      required(render.outputPath, "Render output path is required.");
      const id = render.id || identifier("render");
      const createdAt = render.createdAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_render_jobs (
          id, project_name, mode, status, output_path, object_key, output_url,
          render_type, highlight_id, reaction_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [
        id, render.projectName, render.mode || "worker", render.status || "completed",
        render.outputPath, render.objectKey || null, render.outputUrl || null,
        render.renderType || "final", render.highlightId || null, render.reactionId || null, createdAt
      ]).first();
      return row ? {
        id: row.id,
        projectName: row.project_name,
        mode: row.mode,
        status: row.status,
        outputPath: row.output_path,
        objectKey: row.object_key || "",
        outputUrl: row.output_url || "",
        renderType: row.render_type || "",
        highlightId: row.highlight_id || "",
        reactionId: row.reaction_id || "",
        createdAt: row.created_at
      } : null;
    },

    async ensureRender(render = {}) {
      required(render.assetId, "Render asset id is required.");
      required(render.projectName, "Render project name is required.");
      required(render.outputPath, "Render output path is required.");
      const id = `render:${render.assetId}`;
      const createdAt = render.createdAt || new Date().toISOString();
      const insert = statement(db, `
        INSERT INTO cf_render_jobs (
          id, project_name, mode, status, output_path, object_key, output_url,
          render_type, highlight_id, reaction_id, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM cf_render_jobs
          WHERE project_name = ? AND output_path = ? AND object_key = ?
        )
        ON CONFLICT (id) DO UPDATE SET
          status = excluded.status, output_path = excluded.output_path,
          object_key = excluded.object_key, output_url = excluded.output_url,
          render_type = excluded.render_type, highlight_id = excluded.highlight_id,
          reaction_id = excluded.reaction_id
        RETURNING *
      `, [
        id, render.projectName, render.mode || "worker", render.status || "completed",
        render.outputPath, render.objectKey || null, render.outputUrl || null,
        render.renderType || "final", render.highlightId || null, render.reactionId || null, createdAt,
        render.projectName, render.outputPath, render.objectKey || null
      ]);
      const lookup = statement(db, `
        SELECT * FROM cf_render_jobs
        WHERE id = ? OR (project_name = ? AND output_path = ? AND object_key = ?)
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `, [id, render.projectName, render.outputPath, render.objectKey || null, id]);
      const results = await db.batch([insert, lookup]);
      const row = batchRow(results, 0) || batchRow(results, 1);
      return row ? {
        id: row.id,
        projectName: row.project_name,
        mode: row.mode,
        status: row.status,
        outputPath: row.output_path,
        objectKey: row.object_key || "",
        outputUrl: row.output_url || "",
        renderType: row.render_type || "",
        highlightId: row.highlight_id || "",
        reactionId: row.reaction_id || "",
        createdAt: row.created_at
      } : null;
    },

    async replaceClipCandidates(projectName, candidates = []) {
      required(projectName, "Clipper project name is required.");
      const statements = [statement(db, "DELETE FROM cf_clip_candidates WHERE project_name = ? RETURNING id", [projectName])];
      for (const candidate of candidates) {
        const publicId = candidate.id || identifier("highlight");
        statements.push(statement(db, `
          INSERT INTO cf_clip_candidates (
            id, project_name, title, start_seconds, end_seconds, score, reason, selected, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
          RETURNING *
        `, [
          `${projectName}:${publicId}`, projectName, candidate.title || "Highlight",
          count(candidate.start ?? candidate.startSeconds), count(candidate.end ?? candidate.endSeconds),
          count(candidate.score), candidate.reason || candidate.hook || "", new Date().toISOString()
        ]));
      }
      const results = await db.batch(statements);
      return candidates.map((_candidate, index) => mapClipCandidate(batchRow(results, index + 1)));
    },

    async setSelectedHighlight(projectName, highlightId) {
      required(projectName, "Clipper project name is required.");
      required(highlightId, "Highlight id is required.");
      await statement(db, "UPDATE cf_clip_candidates SET selected = 0 WHERE project_name = ? RETURNING id", [projectName]).first();
      const row = await statement(db, `
        UPDATE cf_clip_candidates SET selected = 1
        WHERE project_name = ? AND (id = ? OR id = ?)
        RETURNING *
      `, [projectName, highlightId, `${projectName}:${highlightId}`]).first();
      return mapClipCandidate(row);
    },

    async listFolders(user = null) {
      const access = projectAccess(user);
      const rows = access.clause
        ? await all(db, `
          SELECT DISTINCT f.id, f.name, f.created_by, f.created_at, f.updated_at
          FROM cf_folders f
          JOIN cf_projects p ON p.folder_id = f.id
          WHERE ${access.clause}
          ORDER BY f.name ASC
        `, access.bindings)
        : await all(db, "SELECT id, name, created_by, created_at, updated_at FROM cf_folders ORDER BY name ASC");
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdBy: row.created_by || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },

    async createFolder(folder = {}) {
      required(folder.name, "Folder name is required.");
      const id = folder.id || identifier("folder");
      const now = folder.createdAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_folders (id, name, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        RETURNING *
      `, [id, folder.name, folder.createdBy || null, now, now]).first();
      return row ? { id: row.id, name: row.name, createdBy: row.created_by || "", createdAt: row.created_at, updatedAt: row.updated_at } : null;
    },

    async updateFolder(id, patch = {}) {
      required(id, "Folder id is required.");
      required(patch.name, "Folder name is required.");
      const row = await statement(db, `
        UPDATE cf_folders SET name = ?, updated_at = ? WHERE id = ? RETURNING *
      `, [patch.name, patch.updatedAt || new Date().toISOString(), id]).first();
      return row ? { id: row.id, name: row.name, createdBy: row.created_by || "", createdAt: row.created_at, updatedAt: row.updated_at } : null;
    },

    async deleteFolder(id) {
      const row = await statement(db, "DELETE FROM cf_folders WHERE id = ? RETURNING id", [id]).first();
      return Boolean(row);
    },

    async createClient(client = {}) {
      required(client.name, "Client name is required.");
      const id = client.id || identifier("client");
      const now = client.createdAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_clients (id, name, industry, contact, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [id, client.name, client.industry || null, client.contact || null, now, now]).first();
      return row ? { id: row.id, name: row.name, industry: row.industry || "", contact: row.contact || "", createdAt: row.created_at } : null;
    },

    async createCampaign(campaign = {}) {
      required(campaign.name, "Campaign name is required.");
      const id = campaign.id || identifier("campaign");
      const now = campaign.createdAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_campaigns (id, client_id, name, objective, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [id, campaign.clientId || null, campaign.name, campaign.objective || null, campaign.status || "active", now, now]).first();
      return row ? { id: row.id, clientId: row.client_id || "", name: row.name, objective: row.objective || "", status: row.status || "active", createdAt: row.created_at } : null;
    },

    async createProject(project = {}) {
      required(project.name, "Project name is required.");
      const now = project.createdAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_projects (
          name, type, folder_id, client_id, campaign_id, assigned_staff_id, reviewer_id,
          priority, approval_status, approval_feedback, local_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [
        project.name, project.type || "ai-generator", project.folderId || null, project.clientId || null,
        project.campaignId || null, project.assignedStaffId || null, project.reviewerId || null,
        project.priority || "normal", project.approvalStatus || "draft", project.approvalFeedback || null,
        project.localPath || null, now, now
      ]).first();
      return mapProject(row);
    },

    async updateProject(name, patch = {}) {
      required(name, "Project name is required.");
      const fields = new Map([
        ["type", "type"], ["folderId", "folder_id"], ["clientId", "client_id"],
        ["campaignId", "campaign_id"], ["assignedStaffId", "assigned_staff_id"],
        ["reviewerId", "reviewer_id"], ["priority", "priority"],
        ["approvalStatus", "approval_status"], ["approvalFeedback", "approval_feedback"]
      ]);
      const assignments = [];
      const bindings = [];
      for (const [key, column] of fields) {
        if (!Object.hasOwn(patch, key)) continue;
        assignments.push(`${column} = ?`);
        bindings.push(patch[key] || null);
      }
      assignments.push("updated_at = ?");
      bindings.push(patch.updatedAt || new Date().toISOString(), name);
      const row = await statement(db, `UPDATE cf_projects SET ${assignments.join(", ")} WHERE name = ? RETURNING *`, bindings).first();
      return mapProject(row);
    },

    async deleteProject(name) {
      const row = await statement(db, "DELETE FROM cf_projects WHERE name = ? RETURNING name", [name]).first();
      return Boolean(row);
    },

    async recordApproval(event = {}) {
      const id = event.id || identifier("approval");
      const row = await statement(db, `
        INSERT INTO cf_approval_events (id, project_name, status, feedback, actor_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [id, event.projectName, event.status, event.feedback || null, event.actorId || null, event.createdAt || new Date().toISOString()]).first();
      return row;
    },

    async campaignIntelligence(campaignId, user = null) {
      if (!campaignId) return { campaignBrief: null, researchSources: [], marketReport: null };
      const client = user?.role === "manager-client";
      const brief = await statement(db, `
        SELECT * FROM cf_campaign_briefs WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT 1
      `, [campaignId]).first();
      if (!brief) return { campaignBrief: null, researchSources: [], marketReport: null };
      const report = await statement(db, `
        SELECT * FROM cf_market_reports
        WHERE campaign_id = ? AND brief_id = ? ${client ? "AND status = 'approved'" : ""}
        ORDER BY updated_at DESC LIMIT 1
      `, [campaignId, brief.id]).first();
      const sourceRows = client ? [] : await all(db, "SELECT * FROM cf_research_sources WHERE brief_id = ? ORDER BY created_at ASC", [brief.id]);
      const campaignBrief = {
        id: brief.id,
        campaignId: brief.campaign_id,
        title: brief.title,
        productName: brief.product_name || "",
        objective: brief.objective || "",
        targetAudience: brief.target_audience || "",
        brief: jsonObject(brief.brief),
        status: brief.status || "draft",
        createdBy: client ? "" : brief.created_by || "",
        createdAt: brief.created_at,
        updatedAt: brief.updated_at
      };
      return {
        campaignBrief,
        researchSources: sourceRows.map((row) => ({
          id: row.id,
          briefId: row.brief_id,
          sourceType: row.source_type,
          type: row.source_type,
          name: row.name,
          content: row.content || "",
          passages: jsonValue(row.passages, []),
          metadata: jsonObject(row.metadata),
          createdBy: row.created_by || "",
          createdAt: row.created_at
        })),
        marketReport: report ? {
          id: report.id,
          briefId: report.brief_id,
          campaignId: report.campaign_id,
          status: report.status,
          source: report.source || "fallback",
          report: jsonObject(report.report),
          scriptwriterInput: jsonObject(report.scriptwriter_input),
          createdBy: client ? "" : report.created_by || "",
          createdAt: report.created_at,
          updatedAt: report.updated_at
        } : null
      };
    },

    async listIntelligence(user = null) {
      const organization = await repository.listOrganization(user);
      return {
        campaigns: await Promise.all(organization.campaigns.map(async (campaign) => ({
          ...campaign,
          intelligence: await repository.campaignIntelligence(campaign.id, user)
        })))
      };
    },

    async upsertCampaignBrief(brief = {}) {
      const now = brief.updatedAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_campaign_briefs (
          id, campaign_id, title, product_name, objective, target_audience, brief,
          status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          campaign_id = excluded.campaign_id, title = excluded.title, product_name = excluded.product_name,
          objective = excluded.objective, target_audience = excluded.target_audience, brief = excluded.brief,
          status = excluded.status, updated_at = excluded.updated_at
        RETURNING *
      `, [
        brief.id || identifier("brief"), brief.campaignId, brief.title, brief.productName || null,
        brief.objective || null, brief.targetAudience || null, JSON.stringify(jsonObject(brief.brief)),
        brief.status || "draft", brief.createdBy || null, brief.createdAt || now, now
      ]).first();
      return row ? (await repository.campaignIntelligence(row.campaign_id, { role: "admin" })).campaignBrief : null;
    },

    async createResearchSource(source = {}) {
      const row = await statement(db, `
        INSERT INTO cf_research_sources (
          id, brief_id, source_type, name, content, passages, metadata, local_path, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [
        source.id || identifier("source"), source.briefId, source.sourceType || "text", source.name,
        source.content || "", JSON.stringify(jsonValue(source.passages, [])), JSON.stringify(jsonObject(source.metadata)),
        source.localPath || null, source.createdBy || null, source.createdAt || new Date().toISOString()
      ]).first();
      return row ? {
        id: row.id, briefId: row.brief_id, sourceType: row.source_type, type: row.source_type,
        name: row.name, content: row.content || "", passages: jsonValue(row.passages, []),
        metadata: jsonObject(row.metadata), createdBy: row.created_by || "", createdAt: row.created_at
      } : null;
    },

    async deleteResearchSource(id, briefId) {
      required(briefId, "Research source brief id is required.");
      return Boolean(await statement(db, "DELETE FROM cf_research_sources WHERE id = ? AND brief_id = ? RETURNING id", [id, briefId]).first());
    },

    async upsertMarketReport(report = {}) {
      const now = report.updatedAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_market_reports (
          id, brief_id, campaign_id, status, source, report, scriptwriter_input, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          brief_id = excluded.brief_id, campaign_id = excluded.campaign_id, status = excluded.status,
          source = excluded.source, report = excluded.report, scriptwriter_input = excluded.scriptwriter_input,
          updated_at = excluded.updated_at
        RETURNING *
      `, [
        report.id || identifier("report"), report.briefId, report.campaignId, report.status || "draft",
        report.source || "fallback", JSON.stringify(jsonObject(report.report)),
        JSON.stringify(jsonObject(report.scriptwriterInput || report.scriptwriter_input)), report.createdBy || null,
        report.createdAt || now, now
      ]).first();
      return row ? {
        id: row.id, briefId: row.brief_id, campaignId: row.campaign_id, status: row.status,
        source: row.source, report: jsonObject(row.report), scriptwriterInput: jsonObject(row.scriptwriter_input),
        createdBy: row.created_by || "", createdAt: row.created_at, updatedAt: row.updated_at
      } : null;
    },

    async reconcileMarketReport(report = {}) {
      const now = report.updatedAt || new Date().toISOString();
      const prepared = statement(db, `
        INSERT INTO cf_market_reports (
          id, brief_id, campaign_id, status, source, report, scriptwriter_input, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          brief_id = excluded.brief_id, campaign_id = excluded.campaign_id, status = excluded.status,
          source = excluded.source, report = excluded.report, scriptwriter_input = excluded.scriptwriter_input,
          updated_at = excluded.updated_at
        RETURNING *
      `, [
        report.id || identifier("report"), report.briefId, report.campaignId, report.status || "draft",
        report.source || "fallback", JSON.stringify(jsonObject(report.report)),
        JSON.stringify(jsonObject(report.scriptwriterInput || report.scriptwriter_input)), report.createdBy || null,
        report.createdAt || now, now
      ]);
      const row = batchRow(await db.batch([prepared]), 0);
      return row ? {
        id: row.id, briefId: row.brief_id, campaignId: row.campaign_id, status: row.status,
        source: row.source, report: jsonObject(row.report), scriptwriterInput: jsonObject(row.scriptwriter_input),
        createdBy: row.created_by || "", createdAt: row.created_at, updatedAt: row.updated_at
      } : null;
    },

    async projectScriptBundle(projectName, user = null) {
      const client = user?.role === "manager-client";
      const script = await statement(db, `
        SELECT * FROM cf_ugc_scripts WHERE project_name = ? ${client ? "AND status = 'approved'" : ""}
        ORDER BY updated_at DESC LIMIT 1
      `, [projectName]).first();
      if (!script) return { ugcScript: null, scriptAnalysis: null, scriptVersions: [], scriptReviewEvents: [] };
      const versions = await all(db, "SELECT * FROM cf_ugc_script_versions WHERE script_id = ? ORDER BY version_number DESC", [script.id]);
      const events = await all(db, "SELECT * FROM cf_script_review_events WHERE script_id = ? ORDER BY created_at DESC", [script.id]);
      const mappedVersions = versions.map((row) => ({
        id: row.id, scriptId: row.script_id, versionNumber: count(row.version_number),
        content: jsonObject(row.content), changeNote: row.change_note || "", createdBy: row.created_by || "", createdAt: row.created_at
      }));
      const current = mappedVersions.find((version) => version.versionNumber === count(script.current_version_number)) || mappedVersions[0] || null;
      const metadata = {
        id: script.id,
        projectName: script.project_name,
        campaignId: script.campaign_id || "",
        marketReportId: script.market_report_id || "",
        title: script.title,
        status: script.status,
        selectedHookId: script.selected_hook_id || "",
        selectedHookIndex: script.selected_hook_index ?? null,
        currentVersionNumber: count(script.current_version_number),
        versionId: current?.id || "",
        versionNumber: current?.versionNumber || 0,
        createdAt: script.created_at,
        updatedAt: script.updated_at
      };
      return {
        ugcScript: current ? { ...current.content, ...metadata } : metadata,
        scriptAnalysis: client ? null : current?.content?.scriptAnalysis || current?.content?.analysis || null,
        scriptVersions: client ? [] : mappedVersions,
        scriptReviewEvents: events.map((row) => ({
          id: row.id, scriptId: row.script_id, versionId: row.version_id, fromStatus: row.from_status || "",
          toStatus: row.to_status, feedback: client ? "" : row.feedback || "", actorId: client ? "" : row.actor_id || "",
          overrideReason: client ? "" : row.override_reason || "", createdAt: row.created_at
        }))
      };
    },

    async upsertUgcScript(script = {}) {
      const now = script.updatedAt || new Date().toISOString();
      const row = await statement(db, `
        INSERT INTO cf_ugc_scripts (
          id, market_report_id, campaign_id, project_name, title, status, selected_hook_id,
          selected_hook_index, current_version_number, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          market_report_id = excluded.market_report_id, campaign_id = excluded.campaign_id,
          project_name = excluded.project_name, title = excluded.title, status = excluded.status,
          selected_hook_id = excluded.selected_hook_id, selected_hook_index = excluded.selected_hook_index,
          current_version_number = excluded.current_version_number, updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
        RETURNING *
      `, [
        script.id || identifier("script"), script.marketReportId || null, script.campaignId || null,
        script.projectName, script.title || `${script.projectName} UGC Script`, script.status || "draft",
        script.selectedHookId || null, script.selectedHookIndex ?? null, count(script.currentVersionNumber),
        script.createdBy || script.updatedBy || null, script.updatedBy || script.createdBy || null,
        script.createdAt || now, now
      ]).first();
      return row ? {
        id: row.id, marketReportId: row.market_report_id || "", campaignId: row.campaign_id || "",
        projectName: row.project_name, title: row.title, status: row.status,
        selectedHookId: row.selected_hook_id || "", selectedHookIndex: row.selected_hook_index ?? null,
        currentVersionNumber: count(row.current_version_number), createdBy: row.created_by || "",
        updatedBy: row.updated_by || "", createdAt: row.created_at, updatedAt: row.updated_at
      } : null;
    },

    async createScriptVersion(version = {}) {
      const row = await statement(db, `
        INSERT INTO cf_ugc_script_versions (
          id, script_id, version_number, content, change_note, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET id = excluded.id
        RETURNING *
      `, [
        version.id || identifier("version"), version.scriptId, count(version.versionNumber),
        JSON.stringify(jsonObject(version.content)), version.changeNote || null,
        version.createdBy || null, version.createdAt || new Date().toISOString()
      ]).first();
      return row ? {
        id: row.id, scriptId: row.script_id, versionNumber: count(row.version_number),
        content: jsonObject(row.content), changeNote: row.change_note || "",
        createdBy: row.created_by || "", createdAt: row.created_at
      } : null;
    },

    async reconcileUgcScript(script = {}, version = {}) {
      const now = script.updatedAt || new Date().toISOString();
      const scriptStatement = statement(db, `
        INSERT INTO cf_ugc_scripts (
          id, market_report_id, campaign_id, project_name, title, status, selected_hook_id,
          selected_hook_index, current_version_number, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          market_report_id = excluded.market_report_id, campaign_id = excluded.campaign_id,
          project_name = excluded.project_name, title = excluded.title, status = excluded.status,
          selected_hook_id = excluded.selected_hook_id, selected_hook_index = excluded.selected_hook_index,
          current_version_number = excluded.current_version_number, updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
        RETURNING *
      `, [
        script.id || identifier("script"), script.marketReportId || null, script.campaignId || null,
        script.projectName, script.title || `${script.projectName} UGC Script`, script.status || "draft",
        script.selectedHookId || null, script.selectedHookIndex ?? null, count(script.currentVersionNumber),
        script.createdBy || script.updatedBy || null, script.updatedBy || script.createdBy || null,
        script.createdAt || now, now
      ]);
      const versionStatement = statement(db, `
        INSERT INTO cf_ugc_script_versions (
          id, script_id, version_number, content, change_note, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET id = excluded.id
        RETURNING *
      `, [
        version.id || identifier("version"), version.scriptId, count(version.versionNumber),
        JSON.stringify(jsonObject(version.content)), version.changeNote || null,
        version.createdBy || null, version.createdAt || new Date().toISOString()
      ]);
      const results = await db.batch([scriptStatement, versionStatement]);
      const scriptRow = batchRow(results, 0);
      const versionRow = batchRow(results, 1);
      return {
        script: scriptRow ? {
          id: scriptRow.id, marketReportId: scriptRow.market_report_id || "", campaignId: scriptRow.campaign_id || "",
          projectName: scriptRow.project_name, title: scriptRow.title, status: scriptRow.status,
          selectedHookId: scriptRow.selected_hook_id || "", selectedHookIndex: scriptRow.selected_hook_index ?? null,
          currentVersionNumber: count(scriptRow.current_version_number), createdBy: scriptRow.created_by || "",
          updatedBy: scriptRow.updated_by || "", createdAt: scriptRow.created_at, updatedAt: scriptRow.updated_at
        } : null,
        version: versionRow ? {
          id: versionRow.id, scriptId: versionRow.script_id, versionNumber: count(versionRow.version_number),
          content: jsonObject(versionRow.content), changeNote: versionRow.change_note || "",
          createdBy: versionRow.created_by || "", createdAt: versionRow.created_at
        } : null
      };
    },

    async recordScriptReview(event = {}) {
      const row = await statement(db, `
        INSERT INTO cf_script_review_events (
          id, script_id, version_id, from_status, to_status, feedback, actor_id, override_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `, [
        event.id || identifier("review"), event.scriptId, event.versionId, event.fromStatus || null,
        event.toStatus, event.feedback || null, event.actorId || null, event.overrideReason || null,
        event.createdAt || new Date().toISOString()
      ]).first();
      return row ? {
        id: row.id, scriptId: row.script_id, versionId: row.version_id, fromStatus: row.from_status || "",
        toStatus: row.to_status, feedback: row.feedback || "", actorId: row.actor_id || "",
        overrideReason: row.override_reason || "", createdAt: row.created_at
      } : null;
    },

    async listOrganization(user = null) {
      const [clients, campaigns, staff] = await Promise.all([
        all(db, "SELECT id, name, industry, contact, created_at FROM cf_clients ORDER BY name ASC"),
        all(db, "SELECT id, client_id, name, objective, status, created_at FROM cf_campaigns ORDER BY created_at DESC"),
        all(db, "SELECT id, name, role, email, client_id FROM cf_users ORDER BY name ASC")
      ]);
      let result = {
        clients: clients.map((row) => ({
          id: row.id,
          name: row.name,
          industry: row.industry || "",
          contact: row.contact || "",
          createdAt: row.created_at
        })),
        campaigns: campaigns.map((row) => ({
          id: row.id,
          clientId: row.client_id || "",
          name: row.name,
          objective: row.objective || "",
          status: row.status || "active",
          createdAt: row.created_at
        })),
        staff: staff.map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role || "staff-editor",
          email: row.email || "",
          clientId: row.client_id || ""
        }))
      };
      if (user && user.role !== "admin") {
        const projects = await repository.listProjects(user);
        const clientIds = new Set(projects.map((project) => project.clientId).filter(Boolean));
        const campaignIds = new Set(projects.map((project) => project.campaignId).filter(Boolean));
        result = {
          clients: result.clients.filter((client) => clientIds.has(client.id)),
          campaigns: result.campaigns.filter((campaign) => campaignIds.has(campaign.id)),
          staff: result.staff.filter((person) => person.id === user.id)
        };
      }
      return result;
    },

    async listMedia(user = null) {
      const access = projectAccess(user);
      const where = access.clause ? `WHERE ${access.clause}` : "";
      const rows = await all(db, `
        SELECT
          r.id, r.project_name, r.mode, r.output_path, r.output_url, r.render_type,
          r.status, r.created_at, p.type, p.client_id, p.campaign_id,
          p.assigned_staff_id, p.reviewer_id, p.approval_status, p.approval_feedback
        FROM cf_render_jobs r
        JOIN cf_projects p ON p.name = r.project_name
        ${where}
        ORDER BY r.created_at DESC
      `, access.bindings);
      return rows.map(mapMedia);
    },

    async listActivity({ user = null, limit = 20 } = {}) {
      const projects = await repository.listProjects(user);
      const names = projects.map((project) => project.name);
      if (!names.length && user?.role !== "admin") return [];
      const bindings = [];
      let where = "";
      if (user?.role !== "admin") {
        where = `WHERE project_name IN (${names.map(() => "?").join(", ")})`;
        bindings.push(...names);
      }
      bindings.push(Math.max(1, Math.min(Number(limit) || 20, 100)));
      const rows = await all(db, `SELECT id, event_type, project_name, metadata, created_at FROM cf_analytics_events ${where} ORDER BY created_at DESC LIMIT ?`, bindings);
      return rows.map((row) => ({ id: row.id, type: row.event_type, project: row.project_name || "", metadata: jsonObject(row.metadata), createdAt: row.created_at }));
    },

    async analytics(user = null) {
      const projects = await repository.listProjects(user);
      const media = await repository.listMedia(user);
      const jobs = await repository.listJobs({ user, limit: 200 });
      return {
        totalProjects: projects.length,
        aiGeneratorProjects: projects.filter((project) => project.type === "ai-generator").length,
        autoClipperProjects: projects.filter((project) => project.type === "auto-clipper").length,
        totalRenders: media.length,
        approvals: {
          approved: projects.filter((project) => project.approvalStatus === "approved").length,
          changesRequested: projects.filter((project) => project.approvalStatus === "changes-requested").length,
          pending: projects.filter((project) => !["approved", "changes-requested"].includes(project.approvalStatus)).length
        },
        productionJobs: {
          queued: jobs.filter((job) => job.status === "queued").length,
          processing: jobs.filter((job) => job.status === "processing").length,
          completed: jobs.filter((job) => job.status === "completed").length,
          failed: jobs.filter((job) => job.status === "failed").length
        }
      };
    },

    async getProjectData(name, user = null) {
      const summary = await repository.getProject(name, user);
      if (!summary) return null;
      const [assets, clips, renders, jobs, organization, intelligence, scriptBundle] = await Promise.all([
        all(db, "SELECT * FROM cf_assets WHERE project_name = ? ORDER BY created_at DESC", [name]),
        all(db, "SELECT * FROM cf_clip_candidates WHERE project_name = ? ORDER BY score DESC, created_at ASC", [name]),
        all(db, "SELECT * FROM cf_render_jobs WHERE project_name = ? ORDER BY created_at DESC", [name]),
        repository.listJobs({ projectName: name, user }),
        repository.listOrganization(user),
        summary.campaignId ? repository.campaignIntelligence(summary.campaignId, user) : Promise.resolve({ campaignBrief: null, researchSources: [], marketReport: null }),
        repository.projectScriptBundle(name, user)
      ]);
      const mappedAssets = assets.map(mapAsset);
      const clipCandidates = clips.map(mapClipCandidate);
      const imageAssets = mappedAssets.filter((asset) => asset.mediaType === "image" || asset.mediaType.startsWith("image/"));
      const videoAssets = mappedAssets.filter((asset) => asset.mediaType === "video" || asset.mediaType.startsWith("video/"));
      const audioAssets = mappedAssets.filter((asset) => asset.mediaType === "audio" || asset.mediaType.startsWith("audio/"));
      const reactions = mappedAssets.filter((asset) => asset.kind === "reaction-character").map((asset) => ({
        ...asset,
        type: asset.mediaType === "video" || asset.mediaType.startsWith("video/") ? "video" : "image"
      }));
      const renderItems = renders.map((row) => ({
        id: row.id,
        name: row.output_path,
        mode: row.mode,
        status: row.status,
        url: row.output_url || "",
        renderType: row.render_type || "",
        createdAt: row.created_at
      }));
      const analysisJob = jobs.find((job) => job.jobType === "analyze-ugc-script" && job.status === "completed");
      return {
        summary: { ...summary, assets: mappedAssets, clipCandidates },
        folders: await repository.listFolders(user),
        organization,
        products: mappedAssets.filter((asset) => asset.kind === "product-image"),
        characters: mappedAssets.filter((asset) => asset.kind === "character-reference"),
        frames: [],
        images: imageAssets,
        videos: videoAssets.filter((asset) => !["reference-video", "clipper-source"].includes(asset.kind) && asset.url),
        audio: audioAssets,
        renders: renderItems,
        clipper: {
          sourceUrl: mappedAssets.find((asset) => asset.kind === "clipper-source")?.url || null,
          reactions
        },
        referenceUrl: mappedAssets.find((asset) => asset.kind === "reference-video")?.url || null,
        scriptVersions: scriptBundle.scriptVersions || [],
        scriptReviewEvents: scriptBundle.scriptReviewEvents || [],
        productionJobs: jobs,
        files: {
          clipperHighlights: clipCandidates.length ? { candidates: clipCandidates } : null,
          clipperSelection: clipCandidates.find((candidate) => candidate.selected) || null,
          marketReport: intelligence.marketReport || null,
          scriptAnalysis: scriptBundle.scriptAnalysis || analysisJob?.result || null,
          ugcScript: scriptBundle.ugcScript || null
        }
      };
    }
  };

  return repository;
}

export const createRepository = createD1Repository;

export default createD1Repository;
