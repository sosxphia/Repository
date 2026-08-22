# SproutGoals — Product Requirements

## One-liner
Cutesy, gamified mobile app where completing goals and focus sessions grows a virtual plant. Each plant progresses through stages: seed → sprout → sapling → bloom.

## Core Loop
- User signs in with Google (Emergent Auth).
- User adds goals and/or runs focus timer sessions.
- Completing a goal = +10 XP; every focus minute = +2 XP.
- XP flows into the *current* plant, advancing stages.
- Full-bloom plants stay in the "My Garden" collection; user can reset to plant a new one.

## Screens (Bottom Tabs)
1. **Garden** — Hero card of current plant, XP progress bar to next stage, horizontal collection of all plants, quick-action tiles to Focus/Goals, reset button.
2. **Focus (Timer)** — Circular Pomodoro-style timer (presets 15/25/45/60 min), start/stop; on completion (or ≥1 min elapsed on stop) posts session and adds XP.
3. **Goals** — Chunky task list, add via bottom-sheet modal, tap circular checkbox to complete (+10 XP), swipe/tap trash to delete.
4. **Profile** — Google avatar/name/email, 4 stat cards (streak, focus min, goals done, bloomed), 6 badge achievements (locked/unlocked), sign-out.

## Backend (FastAPI + MongoDB)
Collections: `users`, `user_sessions`, `plants`, `goals`, `focus_sessions`.
Custom IDs: `user_id`, `plant_id`, `goal_id`. `_id` never returned.
Session tokens indexed with 7-day TTL.

## XP → Stage thresholds
- Seed: 0–49 · Sprout: 50–149 · Sapling: 150–349 · Bloom: 350+

## Design
Tactile / Playful (Personality 4) — cream #FFFCF6, sunshine yellow #F59E0B, emerald #10B981. Chunky pill/rounded shapes, spring press-down, haptics on every major interaction.

## Integrations
- Emergent-managed Google Auth (mobile + web).
- No AI, no external LLM, no push notifications in MVP.

## Tree View update (June 2026)
- Branches are now PURELY AESTHETIC: no goal tooltips, no tap targets. Branch count still = number of completed goals (capped by stage), but no goal titles shown on the tree.
- New trunk details: bird holes (dark hollow with bark rim; topmost hole has a little bluebird peeking) spaced along the trunk, and small leafy sprigs sprouting from trunk sides between branches. Branches also got individual tip leaves.
- `TreeView` prop changed: `goals: {goal_id,title}[]` → `branches: number`.
