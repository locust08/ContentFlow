# Management Pages Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the management workspace into clear top-level pages so ContentFlow AI feels like a proper FYP information system instead of one mixed dashboard.

**Architecture:** Keep the existing backend and data model unchanged. Restructure `public/index.html` into page sections controlled by `state.activeView`, and extend `public/app.js` rendering so clients, campaigns, team, approvals, media, analytics, jobs, and settings each have their own page.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript frontend, Node/Express backend, Supabase-backed API records, Vercel deployment.

## Global Constraints

- Do not break existing AI Generator and Auto Clipper project-only screens.
- Keep the sidebar project list always visible.
- Keep client users away from internal production controls.
- Use existing API endpoints only for this pass.
- Preserve Digital Bee light visual identity.

---

### Task 1: Navigation and Page Shell

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: `state.activeView`, `showView(viewName)`, existing sidebar `data-nav-view` handler.
- Produces: dedicated management view names: `dashboard`, `projects`, `clients`, `campaigns`, `team`, `media-library`, `approvals`, `analytics`, `production-jobs`, `settings`.

- [ ] Replace mixed sidebar links with management page links.
- [ ] Add `management-page` sections in HTML.
- [ ] Update `showView()` to show exactly one management page when no project workflow is open.
- [ ] Update hero title/subtitle/CTA copy for each page.

### Task 2: Management Data Renderers

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `state.projects`, `state.organization`, `state.mediaItems`, `state.productionJobs`, helper functions `clientName()`, `campaignName()`, `staffName()`, `typeLabel()`.
- Produces: `renderProjectsPage()`, `renderClientsPage()`, `renderCampaignsPage()`, `renderTeamPage()`.

- [ ] Render project table/cards on Projects page.
- [ ] Render client list on Clients page.
- [ ] Render campaign list on Campaigns page.
- [ ] Render staff/editor/client role list on Team page.
- [ ] Call the new renderers during `refreshProjects()`.

### Task 3: Preserve Existing Workflows and Verify

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: existing workflow visibility controls.
- Produces: stable page-specific UX without mixed management sections.

- [ ] Confirm AI Generator project opens only AI sections.
- [ ] Confirm Auto Clipper project opens only Clipper section.
- [ ] Confirm Dashboard shows only overview metrics.
- [ ] Confirm management pages are separate.
- [ ] Run `node --check public/app.js`.
- [ ] Run `node --check src/server.js`.
- [ ] Run `node --test test/access.test.js test/productionJobs.test.js`.
- [ ] Smoke test localhost.
