"""Verified, read-only backup of the audited 3308 MySQL clone before lab patch 0004.

The archive lives outside Git. This helper never contacts ports 3306/3307.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
from datetime import datetime, timezone


CONTAINER = "emps-legacy-integration-mysql"
IMAGE = "sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b"
VOLUME = "emps_legacy_integration_20261017"
DATABASE = "emps_integration_test"
BACKUP_DIR = Path(__file__).resolve().parents[2] / "EMPS_BACKUPS"


def inspect_clone() -> None:
    result = subprocess.run(
        ["docker", "inspect", CONTAINER], capture_output=True, text=True, check=True
    )
    objects = json.loads(result.stdout)
    if len(objects) != 1:
        raise RuntimeError("Expected exactly one audited clone container")
    item = objects[0]
    ports = item["HostConfig"]["PortBindings"].get("3306/tcp", [])
    mounts = item["Mounts"]
    variables = set(item["Config"]["Env"])
    if not (
        item["Name"] == f"/{CONTAINER}"
        and item["Config"]["Image"] == IMAGE
        and item["Image"] == IMAGE
        and item["State"]["Running"]
        and ports == [{"HostIp": "127.0.0.1", "HostPort": "3308"}]
        and len(mounts) == 1
        and mounts[0]["Type"] == "volume"
        and mounts[0]["Name"] == VOLUME
        and mounts[0]["Destination"] == "/var/lib/mysql"
        and f"MYSQL_DATABASE={DATABASE}" in variables
        and "MYSQL_USER=emps_integration_app" in variables
    ):
        raise RuntimeError("Clone identity or local port does not match the audited 3308 instance")


def main() -> None:
    inspect_clone()
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = BACKUP_DIR / f"emps_integration_pre_maquete_{stamp}_{uuid4().hex[:8]}.sql.gz"
    temporary = target.with_suffix(".sql.gz.partial")
    command = [
        "docker", "exec", "-i", CONTAINER, "sh", "-lc",
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump '
        '--single-transaction --quick --no-tablespaces --hex-blob '
        '--default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE"',
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    raw_bytes = 0
    try:
        assert process.stdout is not None
        with gzip.open(temporary, "wb", compresslevel=6) as archive:
            while chunk := process.stdout.read(1024 * 1024):
                archive.write(chunk)
                raw_bytes += len(chunk)
        stderr = process.stderr.read(4096) if process.stderr else b""
        if process.wait() != 0 or raw_bytes < 1024 * 1024:
            raise RuntimeError(f"mysqldump failed or was incomplete: {stderr.decode(errors='replace')[:500]}")
        verified_bytes = 0
        with gzip.open(temporary, "rb") as archive:
            if not archive.read(128).startswith(b"-- MySQL dump"):
                raise RuntimeError("Backup does not start with a MySQL dump header")
            verified_bytes = 128
            while chunk := archive.read(1024 * 1024):
                verified_bytes += len(chunk)
        if verified_bytes != raw_bytes:
            raise RuntimeError("Backup decompression size differs from mysqldump output")
        with temporary.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest().upper()
        os.replace(temporary, target)
        print(json.dumps({"path": str(target), "sha256": digest, "uncompressedBytes": raw_bytes}))
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Backup aborted: {error}", file=sys.stderr)
        sys.exit(1)
