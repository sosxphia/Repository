"""
Iteration 22 smoke tests — verifies bundle-id revert to com.company.treeapp
did not break anything.

Focus:
1. app.json config (bundle id, package, google-services match)
2. Backend APPLE_AUDIENCES aligned + core endpoints healthy
3. Smoke regression: 5 core GETs return 200 for seeded ui-test-user
"""
import json
import os
import pytest
import requests

BASE_URL = "https://grow-by-goals.preview.emergentagent.com"
UI_TOKEN = "uitest_token_123"

APP_JSON_PATH = "/app/frontend/app.json"
GS_JSON_PATH = "/app/frontend/google-services.json"
BACKEND_ENV_PATH = "/app/backend/.env"

EXPECTED_BUNDLE = "com.company.treeapp"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_headers():
    return {"Authorization": f"Bearer {UI_TOKEN}", "Content-Type": "application/json"}


# ---------- Config validation (app.json + google-services.json + backend .env) ----------
class TestConfigAlignment:
    def test_app_json_is_valid_json(self):
        with open(APP_JSON_PATH) as f:
            data = json.load(f)
        assert "expo" in data

    def test_app_json_name_slug_scheme(self):
        with open(APP_JSON_PATH) as f:
            expo = json.load(f)["expo"]
        assert expo["name"] == "Sproutly"
        assert expo["slug"] == "sproutly"
        assert expo["scheme"] == "sproutly"

    def test_app_json_ios_bundle_identifier(self):
        with open(APP_JSON_PATH) as f:
            expo = json.load(f)["expo"]
        assert expo["ios"]["bundleIdentifier"] == EXPECTED_BUNDLE

    def test_app_json_android_package(self):
        with open(APP_JSON_PATH) as f:
            expo = json.load(f)["expo"]
        assert expo["android"]["package"] == EXPECTED_BUNDLE

    def test_app_json_android_google_services_file_ref(self):
        with open(APP_JSON_PATH) as f:
            expo = json.load(f)["expo"]
        assert expo["android"]["googleServicesFile"] == "./google-services.json"

    def test_google_services_package_name_matches_android_package(self):
        with open(GS_JSON_PATH) as f:
            gs = json.load(f)
        pkgs = [c["client_info"]["android_client_info"]["package_name"] for c in gs["client"]]
        assert EXPECTED_BUNDLE in pkgs, f"google-services.json has {pkgs}, expected {EXPECTED_BUNDLE}"

    def test_backend_env_apple_audiences(self):
        with open(BACKEND_ENV_PATH) as f:
            content = f.read()
        assert f'APPLE_AUDIENCES="com.company.treeapp,host.exp.Exponent"' in content or \
               f'APPLE_AUDIENCES=com.company.treeapp,host.exp.Exponent' in content

    def test_no_react_native_purchases_plugin(self):
        """react-native-purchases has no config plugin and would crash Metro."""
        with open(APP_JSON_PATH) as f:
            expo = json.load(f)["expo"]
        plugins_flat = json.dumps(expo["plugins"])
        assert "react-native-purchases" not in plugins_flat


# ---------- Backend basic health / auth surface ----------
class TestBackendHealth:
    def test_root_api_returns_sproutly_message(self, api):
        r = api.get(f"{BASE_URL}/api/")
        assert r.status_code == 200, r.text
        body = r.json()
        # Should mention Sproutly
        blob = json.dumps(body).lower()
        assert "sprout" in blob, f"Root /api/ did not mention Sproutly: {body}"

    def test_auth_me_with_seeded_token(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        # user_id should be ui-test-user
        assert body.get("user_id") == "ui-test-user" or body.get("id") == "ui-test-user", body

    def test_apple_endpoint_rejects_garbage_token(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/apple",
            json={"identity_token": "garbage.jwt.token"},
        )
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "Invalid Apple identity token" in detail or "invalid" in detail.lower()


# ---------- Smoke regression: 5 core GETs used by the 5 tabs / paywall ----------
class TestSmokeRegression:
    def test_plants_current(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/plants/current", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        # sanity — should have a name or plant_id field
        assert isinstance(body, dict)

    def test_settings(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/settings", headers=auth_headers)
        assert r.status_code == 200, r.text

    def test_focus_sessions_today(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/focus-sessions/today", headers=auth_headers)
        assert r.status_code == 200, r.text

    def test_friends_leaderboard(self, api, auth_headers):
        r = api.get(f"{BASE_URL}/api/friends/leaderboard", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, (list, dict))

    def test_streak_freezes_status(self, api, auth_headers):
        """Paywall/profile also relies on this."""
        r = api.get(f"{BASE_URL}/api/streak-freezes/status", headers=auth_headers)
        assert r.status_code == 200, r.text
