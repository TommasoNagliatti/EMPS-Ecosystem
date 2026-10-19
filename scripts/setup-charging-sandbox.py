"""Install charging-only sandbox tables and fixtures in the audited local MySQL clone.

Never addresses source databases on 3306/3307 or any official service. Before the
first write, verifies the 3308 container identity and a complete local backup.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import runpy
import secrets
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "site" / "emps-site-main" / "database" / "patches" / "0005-local-charging-sandbox.sql"
PATCH_CASHIER = ROOT / "site" / "emps-site-main" / "database" / "patches" / "0006-local-cashier-prepaid.sql"
BASE = runpy.run_path(str(ROOT / "scripts" / "setup-maquete-lab.py"))
mysql = BASE["mysql"]
inspect_clone = BASE["inspect_clone"]
TABLES = {"lab_charge_intents", "lab_charge_sessions", "lab_charge_payments"}
CASHIER_TABLE = "lab_charge_receipts"
CHARGERS = {"76": "EV1", "77": "EV2"}
TARIFF_NAME = "SANDBOX - Posto 24h"


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=True
    ).stdout.strip()


def protected_counts() -> str:
    return mysql(
        "SELECT (SELECT COUNT(*) FROM charging_sessions),"
        "(SELECT COUNT(*) FROM payments),"
        "(SELECT COUNT(*) FROM payment_intents),"
        "(SELECT COUNT(*) FROM demo_import_batches),"
        "(SELECT COUNT(*) FROM demo_energy_readings),"
        "(SELECT COUNT(*) FROM demo_charging_sessions),"
        "(SELECT COUNT(*) FROM demo_payments),"
        "(SELECT COUNT(*) FROM demo_session_scenarios);"
    )


def fixtures() -> tuple[list[list[str]], list[list[str]]]:
    tariffs = [
        row.split("\t") for row in mysql(
            "SELECT id,charger_id,tariff_name,base_price_per_kwh,fixed_fee,"
            "dynamic_pricing_enabled,status FROM tariffs WHERE station_id=46 ORDER BY charger_id,id;"
        ).splitlines() if row
    ]
    qr = [
        row.split("\t") for row in mysql(
            "SELECT id,charger_id,short_code,is_active,LENGTH(public_token) "
            "FROM charger_qr_bindings WHERE charger_id IN (76,77) ORDER BY charger_id,id;"
        ).splitlines() if row
    ]
    for row in tariffs:
        if (len(row) != 7 or row[1] not in CHARGERS or row[2] != TARIFF_NAME or
                row[3] != "2.0000" or row[4] != "0.00" or row[5:] != ["0", "active"]):
            raise RuntimeError("Unexpected tariff on the guarded Posto chargers")
    for row in qr:
        if (len(row) != 5 or row[1] not in CHARGERS or
                not re.fullmatch(r"LAB46-(EV1|EV2)-[0-9a-f]{8}", row[2]) or
                row[3] != "1" or int(row[4]) < 40):
            raise RuntimeError("Unexpected QR binding on the guarded Posto chargers")
    for charger_id in CHARGERS:
        if (sum(row[1] == charger_id for row in tariffs) > 1 or
                sum(row[1] == charger_id for row in qr) > 1):
            raise RuntimeError("Multiple sandbox tariffs or QR bindings found")
    return tariffs, qr


def assert_schema(cashier: bool) -> None:
    expected = {
        "lab_charge_intents": {"id", "station_id", "charger_id", "actor_user_id",
            "qr_binding_id", "tariff_id", "payment_method", "spending_limit",
            "price_per_kwh", "fixed_fee", "status", "idempotency_key", "created_at", "expires_at"},
        "lab_charge_sessions": {"id", "intent_id", "station_id", "charger_id", "actor_user_id",
            "qr_binding_id", "evse", "status", "start_key", "stop_key", "meter_source",
            "simulated_power_kw", "energy_kwh", "total_amount", "requested_at",
            "started_at", "ended_at", "updated_at"} | ({"auto_stop_at"} if cashier else set()),
        "lab_charge_payments": {"id", "session_id", "provider", "method", "status",
            "amount", "paid_at", "created_at"},
    }
    if cashier:
        expected[CASHIER_TABLE] = {"id", "intent_id", "station_id", "charger_id", "actor_user_id",
            "method", "amount_received", "confirmation_source", "confirmed_at", "consumed_amount",
            "unused_balance", "closed_at", "return_status"}
    for table, columns in expected.items():
        found = {row.split("\t")[0] for row in mysql(f"SHOW COLUMNS FROM `{table}`;").splitlines()}
        if found != columns:
            raise RuntimeError(f"Unexpected columns in {table}; inspect before proceeding")


def main() -> None:
    if git("branch", "--show-current") != "feat/charging-sandbox-esp32-integration":
        raise RuntimeError("Charging sandbox setup requires its dedicated branch")
    subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", "3134086", "HEAD"], check=True)
    inspect_clone()
    if not PATCH.is_file() or not PATCH_CASHIER.is_file():
        raise RuntimeError("Patches 0005/0006 are missing")
    station = mysql(
        "SELECT id,admin_id,status,review_state,visibility FROM stations WHERE id=46;"
    )
    if station != "46\t105\tpending\tDRAFT\tPRIVATE":
        raise RuntimeError("Posto 46 identity or protections differ; no schema write")
    chargers = mysql(
        "SELECT id,administrative_status,ocpp_identity FROM chargers "
        "WHERE station_id=46 ORDER BY id;"
    ).splitlines()
    if chargers != [
        "76\tpending\tSIMULATED_DEMO_POSTO_24H_001_EVSE_01",
        "77\tpending\tSIMULATED_DEMO_POSTO_24H_001_EVSE_02",
    ]:
        raise RuntimeError("Posto EVSE identity or physical protection differs; no schema write")
    before = protected_counts()
    if before.split("\t")[:3] != ["65", "61", "45"]:
        raise RuntimeError("Protected operational counts differ; no schema write")
    tables = set(mysql("SHOW TABLES;").splitlines())
    if not TABLES.isdisjoint(tables) and not TABLES.issubset(tables):
        raise RuntimeError("Partial charging sandbox schema found; inspect before writing")
    if CASHIER_TABLE in tables and not TABLES.issubset(tables):
        raise RuntimeError("Cashier receipt table exists without the base sandbox schema")
    if len(tables) not in (40, 43, 44):
        raise RuntimeError(f"Unexpected clone table count: {len(tables)}")
    if len(tables) == 44 and CASHIER_TABLE not in tables:
        raise RuntimeError("Unexpected 44th table; inspect before writing")
    old_tariffs, old_qr = fixtures()
    changes = TABLES.isdisjoint(tables) or CASHIER_TABLE not in tables or len(old_tariffs) != 2 or len(old_qr) != 2
    old_lab_counts = (mysql("SELECT (SELECT COUNT(*) FROM lab_charge_intents),"
        "(SELECT COUNT(*) FROM lab_charge_sessions),(SELECT COUNT(*) FROM lab_charge_payments);")
        if TABLES.issubset(tables) else None)
    if changes:
        backup = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "backup-maquete-clone.py"),
             "pre_cashier_prepaid"], capture_output=True, text=True, check=True
        )
        result = json.loads(backup.stdout)
        print(f"Verified pre-write backup: {result['path']} SHA-256 {result['sha256']}", flush=True)
    if TABLES.isdisjoint(tables):
        if len(tables) != 40:
            raise RuntimeError("Unexpected pre-patch schema; inspect before writing")
        mysql(PATCH.read_text(encoding="utf-8"))
    tables = set(mysql("SHOW TABLES;").splitlines())
    if len(tables) not in (43, 44) or not TABLES.issubset(tables):
        raise RuntimeError("Patch 0005 result incomplete; restore verified backup")
    if CASHIER_TABLE not in tables:
        assert_schema(False)
        mysql(PATCH_CASHIER.read_text(encoding="utf-8"))
    tables = set(mysql("SHOW TABLES;").splitlines())
    if len(tables) != 44 or CASHIER_TABLE not in tables:
        raise RuntimeError("Patch 0006 result incomplete; restore verified backup")
    assert_schema(True)

    tariffs, qr = fixtures()
    for charger_id in CHARGERS:
        if not any(row[1] == charger_id for row in tariffs):
            mysql(
                "INSERT INTO tariffs (station_id,charger_id,tariff_name,base_price_per_kwh,"
                "fixed_fee,dynamic_pricing_enabled,currency_code,valid_from,status) VALUES "
                f"(46,{charger_id},'{TARIFF_NAME}',2.0000,0.00,0,'BRL',UTC_TIMESTAMP(3),'active');"
            )
        if not any(row[1] == charger_id for row in qr):
            token = secrets.token_urlsafe(32)
            suffix = secrets.token_hex(4)
            code = f"LAB46-{CHARGERS[charger_id]}-{suffix}"
            mysql(
                "INSERT INTO charger_qr_bindings "
                "(charger_id,public_token,short_code,version_number,is_active,valid_from) "
                f"VALUES ({charger_id},'{token}','{code}',1,1,UTC_TIMESTAMP(3));"
            )
    tariffs, qr = fixtures()
    new_lab_counts = mysql("SELECT (SELECT COUNT(*) FROM lab_charge_intents),"
        "(SELECT COUNT(*) FROM lab_charge_sessions),(SELECT COUNT(*) FROM lab_charge_payments);")
    if len(tariffs) != 2 or len(qr) != 2 or protected_counts() != before or (
            old_lab_counts is not None and new_lab_counts != old_lab_counts):
        raise RuntimeError("Sandbox setup verification failed; inspect clone against backup")
    print(json.dumps({
        "stationId": 46, "chargerIds": [76, 77], "tariffIds": [int(row[0]) for row in tariffs],
        "qrBindingIds": [int(row[0]) for row in qr], "sandboxTables": sorted(TABLES | {CASHIER_TABLE}),
        "operationalSessions": 65, "operationalPayments": 61, "operationalPaymentIntents": 45,
        "historyCountsPreserved": True, "physicalChargersRemainPending": True,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Charging sandbox setup aborted: {error}", file=sys.stderr)
        sys.exit(1)
