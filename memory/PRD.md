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
- Branch leaf-ball clusters removed (June 2026) — branches show only slim ellipse leaves along them and at tips.
- Trunk thickness now grows with tree AGE: +8% per 10 full days since plant `created_at`, capped at day 100 (max 1.8x base width). Computed in garden.tsx as `ageDays`, passed to `TreeView`.
- Stump redesigned with `StumpDetail` component: big root flares, knuckle roots, bark ridges/crack, moss, grass tufts, red mushroom, pebbles — drawn over the trunk base.
- Test plant for `ui-test-user` was backdated 45 days to verify thickening.

## PayPal Streak Freeze (June 2026)
- $1.99 Streak Freeze purchase via PayPal (SANDBOX creds in backend/.env: PAYPAL_CLIENT_ID/PAYPAL_SECRET/PAYPAL_BASE_URL).
- Backend: POST /api/paypal/orders (create), GET /api/paypal/return (capture + grant exactly once → users.streak_freezes +1, HTML result page), GET /api/paypal/cancel, GET /api/paypal/orders/{id}/status (polling). payments collection {order_id, user_id, product, amount, status}. /api/stats returns streak_freezes.
- Frontend: profile.tsx "Streak Freeze" card (owned count + PayPal buy button) → opens approval URL (window.open on web / WebBrowser on native), polls status 4s/3min, success haptic + reload.
- Tree-death mechanic already existed: _check_and_kill_stale_plant consumes freezes on missed days, else kills tree + resets streak.
- Tested: 43/43 backend tests pass (iteration_3.json). Real buyer approval requires PayPal sandbox buyer login (user must test manually).

## Freeze Reminder + Dead Tree Visual (June 2026)
- GET /api/streak-status → {at_risk, active_today, streak_days, streak_freezes}. at_risk = no activity today AND last activity yesterday AND streak > 0.
- Garden shows red warning banner (testID streak-risk-banner) when at_risk: message adapts to freeze count; CTAs "Focus now" + "Get a freeze" (→profile, only when 0 freezes).
- Dead state: when plant.is_dead, garden shows grey memorial card ("X withered away…") + "Replant a new tree" button (testID replant-button → existing reset modal). TreeView isDead prop renders wilted grey DeadTree SVG (snapped top, drooping bare branches, empty bird hole, cracks, fallen leaves).
- Verified: banner screenshot, dead tree screenshot, replant → fresh alive tree via /plants/{id}/reset.

## Streak Calendar (June 2026)
- GET /api/activity-calendar?year=&month= → {year, month, active_days[], streak_days}; active days aggregated from focus_sessions.created_at, goals.completed_at, daily_quests.completed_at (UTC days).
- New component /app/frontend/src/components/StreakCalendar.tsx (testIDs: streak-calendar, calendar-prev, calendar-next): month grid, green dot = active day, outlined = today, next-month disabled at current month. Shown on Profile under "Streak Calendar 🔥" above the Streak Freeze card.
