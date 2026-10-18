"""Apply maquete-only SQL patch to the verified local 3308 clone, once.

The operation takes and verifies a complete backup before the first schema write.
It never contacts either source MySQL container or an official database.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "site" / "emps-site-main" / "database" / "patches" / "0004-lab-maquete.sql"
CONTAINER = "emps-legacy-integration-mysql"
IMAGE = "sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b"
LAB_TABLES = {"lab_devices", "lab_device_commands", "lab_device_events", "lab_rfid_tags"}


def command(*args: str, input_bytes: bytes | None = None) -> str:
    result = subprocess.run(args, input=input_bytes, capture_output=True, check=True)
    return result.stdout.decode("utf-8", errors="replace")


def mysql(sql: str) -> str:
    return command(
        "docker", "exec", "-i", CONTAINER, "sh", "-lc",
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql '
        '--default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE" -N -B',
        input_bytes=sql.encode("utf-8"),
    ).strip()


def inspect_clone() -> None:
    item = json.loads(command("docker", "inspect", CONTAINER))[0]
    bindings = item["HostConfig"]["PortBindings"].get("3306/tcp", [])
    mounts = item["Mounts"]
    variables = set(item["Config"]["Env"])
    if not (
        item["Name"] == f"/{CONTAINER}"
        and item["Config"]["Image"] == IMAGE
        and item["Image"] == IMAGE
        and item["State"]["Running"]
        and bindings == [{"HostIp": "127.0.0.1", "HostPort": "3308"}]
        and len(mounts) == 1
        and mounts[0]["Name"] == "emps_legacy_integration_20261017"
        and mounts[0]["Destination"] == "/var/lib/mysql"
        and "MYSQL_DATABASE=emps_integration_test" in variables
        and "MYSQL_USER=emps_integration_app" in variables
    ):
        raise RuntimeError("Only the audited 3308 clone may receive the maquete patch")


def counts() -> tuple[int, int, int]:
    value = mysql(
        "SELECT (SELECT COUNT(*) FROM charging_sessions), "
        "(SELECT COUNT(*) FROM payments), "
        "(SELECT COUNT(*) FROM payment_intents);"
    )
    return tuple(map(int, value.split("\t")))  # type: ignore[return-value]


def main() -> None:
    branch = command("git", "-C", str(ROOT), "branch", "--show-current").strip()
    if branch != "feat/esp32-maquete-local-bridge":
        raise RuntimeError("Maquete setup requires the dedicated branch")
    subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", "4a759cd", "HEAD"], check=True)
    inspect_clone()
    if not PATCH.is_file():
        raise RuntimeError("Patch 0004 is missing")
    tables = set(mysql("SHOW TABLES;").splitlines())
    station = mysql("SELECT COUNT(*) FROM stations WHERE id=46;")
    if station != "1":
        raise RuntimeError("Posto station 46 is missing from clone")
    original_counts = counts()
    if original_counts != (65, 61, 45):
        raise RuntimeError(f"Protected operational counts changed: {original_counts}")
    if not tables.isdisjoint(LAB_TABLES) and not LAB_TABLES.issubset(tables):
        raise RuntimeError("Partial lab schema found; inspect manually before any further write")

    if tables.isdisjoint(LAB_TABLES):
        if len(tables) != 36:
            raise RuntimeError(f"Unexpected pre-patch table count: {len(tables)}")
        backup = json.loads(command(sys.executable, str(ROOT / "scripts" / "backup-maquete-clone.py")))
        print(f"Verified backup: {backup['path']} SHA-256 {backup['sha256']}", flush=True)
        mysql(PATCH.read_text(encoding="utf-8"))
        tables = set(mysql("SHOW TABLES;").splitlines())
        if len(tables) != 40 or not LAB_TABLES.issubset(tables):
            raise RuntimeError("Patch result is incomplete; restore from verified backup")
    elif len(tables) != 40:
        raise RuntimeError(f"Unexpected post-patch table count: {len(tables)}")

    bindings = mysql("SELECT id, station_id FROM lab_devices ORDER BY id;")
    if bindings and bindings != "maquete-01\t46":
        raise RuntimeError("Existing lab binding differs; no device reassignment performed")
    if not bindings:
        mysql("INSERT INTO lab_devices (id, station_id) VALUES ('maquete-01', 46);")
    if mysql("SELECT id, station_id FROM lab_devices;") != "maquete-01\t46":
        raise RuntimeError("Lab binding verification failed")
    if counts() != original_counts:
        raise RuntimeError("Protected operational counts changed during setup")
    print("Lab schema 0004 and explicit maquete-01 -> Posto 46 binding verified; protected counts unchanged")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Maquete setup aborted: {error}", file=sys.stderr)
        sys.exit(1)
