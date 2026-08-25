# RevenueCat — integrated (2026-06-25)
This file is memory for interacting with the user's RevenueCat account via the integration proxy.

## Identifiers (from /setup response — verbatim)
- rc_project_id: proj2d44ce62
- apple_app_id: app24b0fb3009
- play_app_id: app160af4cbef
- entitlement_lookup_key: pro
- offering_lookup_key: default
- bundle_id: com.sproutly.study / package_name: com.sproutly.study (updated 2026-06; app identifiers renamed)
- Packages (package -> product_id, current price):
  - $rc_monthly -> prodd15c4e46b9  ($2.99 / P1M, trial: none)
  - $rc_annual  -> prodf9d3ea9145  ($29.99 / P1Y, trial: none)
- Dashboard: https://app.revenuecat.com/projects/proj2d44ce62

SDK keys live only in /app/frontend/.env (EXPO_PUBLIC_REVENUECAT_TEST/IOS/ANDROID_API_KEY).

## Status check
curl -sS -H "$AUTH" "$INTEGRATION_PROXY_URL/internal/revenuecat/projects/01d870e3-b287-45cc-8c32-9c3b8517e719/status"
If project_state is less than project_created, re-fetch the RevenueCat playbook via the integration expert tool.

## Later updates (integration proxy APIs ONLY — never the RevenueCat REST API)
- Change price/duration/trial or add a package (upsert):
  POST $INTEGRATION_PROXY_URL/internal/revenuecat/projects/01d870e3-b287-45cc-8c32-9c3b8517e719/products
  body: {"products":[{"package":"$rc_monthly","price":14.99,"currency":"USD","period":"P1M","trial":"P1W","prices":[{"amount_micros":14990000,"currency":"USD"}]}]}
  (amount_micros = price × 1,000,000; omit "trial" for none)
- Remove a package:
  DELETE .../projects/01d870e3-b287-45cc-8c32-9c3b8517e719/products/%24rc_monthly
- Recover identifiers / repopulate .env: re-run the idempotent /setup call.

## App wiring
- /app/frontend/src/lib/revenuecat.tsx — configure + SubscriptionProvider + useSubscription (entitlement "pro")
- /app/frontend/app/_layout.tsx — module-scope initializeRevenueCat(), QueryClientProvider, Purchases.logIn(user.user_id) in AuthGate
- /app/frontend/app/paywall.tsx — coded paywall ($rc_monthly) + restore purchases
- Gating: timer.tsx skips the AdMob interstitial when isSubscribed; friends.tsx shows a golden PRO badge on the user's own row. Pro status is CLIENT-SIDE ONLY (no backend fields).

## Taking purchases LIVE — user's manual store-side steps
1. Upload App Store Connect API key (.p8) / in-app purchase key and Google Play service-account JSON in the RevenueCat dashboard (Apps → app name).
2. Set up payment profiles in App Store Connect and Play Console.
3. Create matching in-app purchase products with the SAME product IDs shown in the RevenueCat dashboard.
4. Make a release build, test via TestFlight / Play internal testing, then submit for review.
All steps are also documented in the FAQ section of the payments panel.
