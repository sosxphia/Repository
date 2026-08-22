#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## PayPal Streak Freeze Integration (June 2026)
- task: PayPal sandbox payment for Streak Freeze ($1.99) granting users.streak_freezes +1
- implemented: POST /api/paypal/orders (auth, creates sandbox order, stores payments doc, returns approve_url), GET /api/paypal/return?token= (captures + grants exactly once, HTML result page), GET /api/paypal/cancel?token= (marks cancelled), GET /api/paypal/orders/{id}/status (auth, polling), /api/stats now includes streak_freezes.
- frontend: profile.tsx Streak Freeze card (testID buy-freeze-button, freeze-count) → opens PayPal approval in browser, polls status every 4s for 3 min.
- verified by main agent: order creation against real sandbox creds OK; cancel + status transitions OK; unapproved return shows "Payment not completed"; exactly-once grant verified via mocked capture (freezes=1 after double capture).
- NOT tested: real PayPal buyer approval (requires sandbox buyer login — cannot automate).
- needs_retesting: true (backend flow regression + auth guards)

## Freeze Reminder + Dead Tree Visual (June 2026)
- GET /api/streak-status (auth) added; garden.tsx risk banner + dead memorial card + replant; TreeView DeadTree render.
- Main agent verified via curl + screenshots: at_risk logic, banner render, dead tree render, replant creates alive tree. needs_retesting: false

## Streak Calendar (June 2026)
- GET /api/activity-calendar added + StreakCalendar component on profile. Main agent verified via curl (current + past month aggregation) and screenshots (active day highlight, prev-month nav, next disabled). needs_retesting: false

## Tree Revive via PayPal (June 2026)
- PAYPAL_PRODUCTS catalog, POST /api/paypal/orders {product}, revive grant on capture (exactly once, restores plant, refreshes last_activity_date). Frontend shared paypal.ts helper + revive button on garden memorial card.
- Verified: curl (revive order, 400s), /app/backend/tests/test_revive_manual.py PASS, pytest tests/test_paypal.py 17/17 pass, screenshots of memorial + waiting states. needs_retesting: false

## Push Notifications (June 2026)
- Emergent managed push integrated per playbook. register-push returns mapped 500 with placeholder key (expected in preview). Kill path verified non-blocking with push failure. App loads on web (guards OK). All playbook self-verification symbols present. Cannot test delivery in preview — needs real build.
