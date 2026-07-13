# Digital Bee UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Digital Bee light SaaS dashboard direction to ContentFlow AI without changing backend behavior.

**Architecture:** This is a frontend skin and information hierarchy pass. Existing HTML IDs and JS event hooks remain stable; CSS tokens and component styles carry most of the redesign.

**Tech Stack:** Plain HTML, CSS, JavaScript, Node test runner.

## Global Constraints

- Keep Digital Bee identity: yellow, black/white, subtle purple AI accents.
- Keep existing role-gated workflows and API behavior.
- Do not commit `.env`, local media, or generated project assets.
- Cards use restrained radii and clean spacing.

---

### Task 1: Update Design Tokens And Shell

**Files:**
- Modify: `public/styles.css`

**Steps:**
- [ ] Replace dark/lavender token set with Digital Bee light tokens.
- [ ] Restyle body, app shell, sidebar, hero, buttons, cards, and status pills.
- [ ] Preserve existing selectors so JavaScript keeps working.
- [ ] Verify responsive layout does not overlap.

### Task 2: Improve Dashboard Component Hierarchy

**Files:**
- Modify: `public/styles.css`
- Modify only if needed: `public/app.js`

**Steps:**
- [ ] Style metrics as clean top cards.
- [ ] Style project cards, analytics cards, media preview, worker queue, and workflow steps.
- [ ] Keep dashboard/client/staff separation unchanged.

### Task 3: Verify And Commit

**Files:**
- Test: `public/app.js`
- Test: `src/server.js`
- Test: `test/access.test.js`
- Test: `test/productionJobs.test.js`

**Steps:**
- [ ] Run `node --check public/app.js`.
- [ ] Run `node --test test/access.test.js test/productionJobs.test.js`.
- [ ] Open local app and inspect dashboard visually.
- [ ] Commit changes with a clear message.
