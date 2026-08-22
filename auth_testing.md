# Apple Sign-In — Setup & Testing

## Frontend
- Package: `expo-apple-authentication@8.0.8`
- `app.json`:
  - `expo.ios.usesAppleSignIn: true`
  - Plugin `"expo-apple-authentication"` added to plugins array
- `src/context/AuthContext.tsx` exposes `signInWithApple()` and `appleAvailable` (true only on iOS when `AppleAuthentication.isAvailableAsync()` resolves true)
- Login screen renders the native `AppleAuthenticationButton` under the Google button, only on iOS when available (Android and web don't see it)

## Backend
- Env: `APPLE_AUDIENCES="com.emergent.growbygoals.off8vr,host.exp.Exponent"` — both bundle id AND Expo Go audience so identity tokens verify in both Expo Go and standalone builds
- Endpoint: `POST /api/auth/apple` — body `{identity_token, name?, email?}`
- Verification: RS256 against Apple JWKS (`https://appleid.apple.com/auth/keys`), issuer `https://appleid.apple.com`, audience must be in `APPLE_AUDIENCES`
- User linking:
  1. Look up by `apple_sub` (token `sub` claim)
  2. If not found and email present, look up by email — auto-links Apple sign-in to an existing Google user with the same email
  3. Otherwise create a new user and seed a starter plant
- Apple only returns email/name on FIRST sign-in — server never overwrites existing values with nulls on subsequent logins
- Returns `{session_token, user}` — the same 7-day `session_token` format used by Google auth (works with all existing protected endpoints)
- MongoDB indexes: `users.apple_sub` unique+sparse, `users.email` sparse (was previously unique — auto-migrated on startup)

## Build requirement
- Apple Sign-In requires the "Sign In with Apple" entitlement on the app's Apple Developer team. It is enabled automatically when `expo.ios.usesAppleSignIn: true` is set in `app.json` — Emergent's Publish → Generate iOS build flow honors this on prebuild.
- Not testable in Expo Go on Android or web preview. Testable in **Expo Go on iOS** (uses `host.exp.Exponent` audience) or in a signed iOS build (uses bundle id audience).

## Testing (per playbook)
1. Seed a test user + session directly in Mongo to test authed endpoints in isolation — same pattern as Google Auth test setup in `/app/memory/test_credentials.md`.
2. Hit `POST /api/auth/apple` with an invalid `identity_token` — expect 401 "Invalid Apple identity token".
3. Hit `POST /api/auth/apple` with no `APPLE_AUDIENCES` set — expect 500 "Apple audiences not configured".
4. Real button flow requires a real Apple ID on a real iOS device or Expo Go on iOS — not automatable in headless preview.
