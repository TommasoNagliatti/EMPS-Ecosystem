import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
from fastapi.testclient import TestClient
from gie_control import GIEControl
from service.isolated_preview import SOURCE, create_app


class IsolatedPreviewTest(unittest.TestCase):
    def setUp(self):
        self.env = {"EMPS_LOCAL_GIE_DEMO": "true", "EMPS_LOCAL_GIE_STATION_ID": "39",
                    "EMPS_LOCAL_GIE_TOKEN": "local-preview-unit-test-only-0000000000"}
        self.now = 100.0
        self.control = GIEControl(clock=lambda: self.now)
        self.client = TestClient(create_app(self.env, self.control))
        self.headers = {"Authorization": "Bearer " + self.env["EMPS_LOCAL_GIE_TOKEN"]}

    def test_identified_virtual_replay(self):
        self.assertEqual(self.client.get("/health", headers=self.headers).json()["status"], "ok")
        data = self.client.get("/state", headers=self.headers).json()
        self.assertEqual(data["source"], SOURCE)
        self.assertTrue(data["isolated"])
        self.assertFalse(data["hardware_confirmed"])
        self.assertEqual(data["station_id"], "39")
        self.assertEqual(data["presentation"]["scene_number"], 5)
        self.assertTrue(data["presentation"]["playing"])
        self.assertEqual(len(data["context"]["demands"]), 4)
        for slot, demand in enumerate(data["context"]["demands"], 1):
            self.assertEqual(demand["charger_id"], f"virtual-evse-{slot}")
            self.assertIsNone(demand["session_id"])

    def test_authenticated_get_only(self):
        for path in ("/health", "/state"):
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path, headers={"Authorization": "Bearer wrong"}).status_code, 401)
            self.assertEqual(self.client.post(path, headers=self.headers).status_code, 405)
        for path in ("/mode", "/context", "/cycle", "/presentation/next", "/docs", "/openapi.json"):
            self.assertEqual(self.client.post(path, headers=self.headers).status_code, 404)

    def test_autoplay_and_bounded_loop(self):
        self.now += 10
        self.assertEqual(self.client.get("/state", headers=self.headers).json()["presentation"]["scene_number"], 6)
        self.control.set_scene("16")
        self.now += 10
        self.assertEqual(self.client.get("/state", headers=self.headers).json()["presentation"]["scene_number"], 1)
        self.now += 1000
        self.assertEqual(self.client.get("/state", headers=self.headers).json()["presentation"]["scene_number"], 2)

    def test_unsafe_environment_rejected_before_control_creation(self):
        for key in ("DATABASE_URL", "JWT_SECRET", "GIE_SERVICE_URL", "GIE_SERVICE_TOKEN", "STRIPE_SECRET_KEY", "OCPP_GATEWAY_URL"):
            with self.assertRaises(RuntimeError):
                create_app({**self.env, key: "must-not-be-inherited"})
        for changes in ({"EMPS_LOCAL_GIE_DEMO": "false"}, {"EMPS_LOCAL_GIE_STATION_ID": "0"}, {"EMPS_LOCAL_GIE_TOKEN": "short"}):
            with self.assertRaises(RuntimeError):
                create_app({**self.env, **changes})


if __name__ == "__main__":
    unittest.main()
