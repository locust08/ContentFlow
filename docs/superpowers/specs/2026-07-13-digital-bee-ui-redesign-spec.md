# ContentFlow AI Digital Bee UI Redesign Spec

Date: 2026-07-13

## Goal

Refresh ContentFlow AI from a dark, crowded AI studio into a clean Digital Bee branded production dashboard inspired by the approved mockup.

## Approved Visual Direction

- Light SaaS dashboard with a warm pale yellow/cream page background.
- White app shell and cards with subtle shadows.
- Strong black typography.
- Digital Bee yellow as the primary accent.
- Purple/blue used only as AI/progress highlights.
- Left sidebar remains persistent and clearer.
- Dashboard-first layout with metric cards, production pipeline, assigned projects, media preview, analytics, and worker queue.

## UX Requirements

- Reduce visual clutter by making Dashboard, AI Generator, Auto Clipper, Media Library, and Analytics feel like separate workspaces.
- Preserve existing backend/API behavior and role gating.
- Keep Admin, Staff, and Manager/Client demo flows working.
- Keep project workflows functional while improving hierarchy, spacing, color, and status readability.
- Make the interface acceptable for FYP demo screenshots and client review.

## Implementation Scope

- Update `public/styles.css` design tokens and component styling.
- Update `public/index.html` only if copy/layout hooks are needed.
- Update `public/app.js` only for dashboard card contents/copy, not backend behavior.
- Do not change Supabase, Vercel, local worker, or production job behavior.

## Verification

- Run JavaScript syntax checks.
- Run existing tests.
- Open local app and visually inspect desktop layout.
- Confirm hosted-critical API behavior remains untouched.
