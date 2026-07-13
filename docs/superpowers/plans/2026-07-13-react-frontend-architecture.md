# React Frontend Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file dashboard frontend with a professional modular React app while preserving the current Node/Supabase/Remotion backend.

**Architecture:** Add a Vite React frontend under `src/frontend`, build it into `public` for the existing Express/Vercel static routes, and keep API calls compatible with the current `/api/*` endpoints. Preserve the mobile staff route as a separate legacy module for now.

**Tech Stack:** React 19, Vite, vanilla CSS modules grouped by design tokens/layout/components/pages, existing Node HTTP API, existing Supabase-backed records.

## Global Constraints

- Keep backend APIs untouched.
- Keep heavy production actions routed through existing hosted/local worker behavior.
- Keep Digital Bee color identity.
- Do not remove `/mobile.html` or mobile staff functionality in this pass.
- Build output must work with existing `src/server.js` static serving and `vercel.json` routes.

---

### Task 1: Build Foundation

**Files:**
- Modify: `package.json`
- Create: `src/frontend/vite.config.js`
- Create: `src/frontend/index.html`
- Create: `src/frontend/main.jsx`

**Interfaces:**
- Produces: `npm run build:frontend`, Vite output in `public`.

- [ ] Add Vite dependency and scripts.
- [ ] Create React entrypoint.
- [ ] Configure Vite to output to `public` without deleting mobile files.

### Task 2: API and State Layer

**Files:**
- Create: `src/frontend/api/client.js`
- Create: `src/frontend/state/useContentFlow.js`

**Interfaces:**
- Produces: `api(path, options)`, `useContentFlow()` app state hook.

- [ ] Wrap fetch API with JSON/error handling.
- [ ] Load auth config, projects, organization, media, supabase status, analytics.
- [ ] Add login/logout, project selection, and refresh functions.

### Task 3: Layout and Pages

**Files:**
- Create: `src/frontend/App.jsx`
- Create: `src/frontend/layout/AppShell.jsx`
- Create: `src/frontend/layout/Sidebar.jsx`
- Create: `src/frontend/layout/Topbar.jsx`
- Create: `src/frontend/pages/*.jsx`
- Create: `src/frontend/components/*.jsx`

**Interfaces:**
- Consumes: `useContentFlow()`.
- Produces: role-aware routed page rendering.

- [ ] Build app shell with sidebar and topbar.
- [ ] Build management pages: dashboard, projects, clients, campaigns, team, media, approvals, analytics, jobs, settings.
- [ ] Build project pages: AI Generator and Auto Clipper.
- [ ] Keep client users restricted to media/analytics/approvals.

### Task 4: Design System

**Files:**
- Create: `src/frontend/styles/tokens.css`
- Create: `src/frontend/styles/layout.css`
- Create: `src/frontend/styles/components.css`
- Create: `src/frontend/styles/pages.css`

**Interfaces:**
- Produces: professional Digital Bee UI system.

- [ ] Add tokens, page shell, cards, buttons, badges, forms, tables, media previews.
- [ ] Use consistent spacing and type hierarchy.
- [ ] Keep mobile responsive layouts.

### Task 5: Verification and Deployment

**Files:**
- Modify: generated `public/index.html`
- Create: generated `public/assets/*`

**Interfaces:**
- Consumes: Vite build and existing tests.

- [ ] Run `npm run build:frontend`.
- [ ] Run `node --check src/server.js`.
- [ ] Run `node --test test/access.test.js test/productionJobs.test.js`.
- [ ] Smoke test localhost and live route.
- [ ] Commit, push, and deploy.
