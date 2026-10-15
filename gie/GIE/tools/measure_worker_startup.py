"""Measure real GIE worker startup without changing models or saved reports.

Run from the GIE directory with its Python 3.12 virtual environment:
    python -B tools/measure_worker_startup.py --mode parallel
    python -B tools/measure_worker_startup.py --mode serial

All worker state lives in a temporary directory. Output is one JSON record.
"""

import argparse
import concurrent.futures
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import traceback

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from gie_multistation.manager import Manager


STATIONS = (
    "Commercial_HighAutonomy_V2",
    "DEMO_POSTO_24H_001",
    "DEMO_CASA_001",
)


if os.name == "nt":
    class MemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
            ("PrivateUsage", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.GetProcessTimes.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL


def process_sample(pid):
    if os.name != "nt":
        return None
    handle = kernel.OpenProcess(0x1000 | 0x0010, False, pid)
    if not handle:
        return None
    try:
        mem = MemoryCounters()
        mem.cb = ctypes.sizeof(mem)
        created, exited, kernel_time, user_time = (wintypes.FILETIME() for _ in range(4))
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(mem), mem.cb):
            return None
        if not kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel_time), ctypes.byref(user_time)):
            return None
        def seconds(value):
            return ((value.dwHighDateTime << 32) | value.dwLowDateTime) / 10_000_000
        return {
            "working_set_mib": mem.WorkingSetSize / 1048576,
            "private_mib": mem.PrivateUsage / 1048576,
            "cpu_seconds": seconds(kernel_time) + seconds(user_time),
        }
    finally:
        kernel.CloseHandle(handle)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("serial", "parallel"), required=True)
    parser.add_argument("--timeout", type=float, default=90)
    args = parser.parse_args()
    started = time.monotonic()
    record = {"mode": args.mode, "timeout_seconds": args.timeout, "station_results": {}, "samples": {},
              "max_simultaneous_working_set_mib": 0}
    stop_monitor = threading.Event()
    with tempfile.TemporaryDirectory(prefix="gie-startup-measure-", dir=Path(__file__).resolve().parents[1]) as directory:
        manager = Manager(directory, timeout=args.timeout)
        def monitor():
            while not stop_monitor.wait(0.1):
                simultaneous_working_set_mib = 0
                for sid, slot in manager.slots.items():
                    process = slot["process"]
                    if process is None or process.pid is None:
                        continue
                    sample = process_sample(process.pid)
                    if sample is None:
                        continue
                    simultaneous_working_set_mib += sample["working_set_mib"]
                    current = record["samples"].setdefault(sid, {"pid": process.pid, "peak_working_set_mib": 0, "peak_private_mib": 0, "cpu_seconds": 0})
                    current["peak_working_set_mib"] = max(current["peak_working_set_mib"], sample["working_set_mib"])
                    current["peak_private_mib"] = max(current["peak_private_mib"], sample["private_mib"])
                    current["cpu_seconds"] = max(current["cpu_seconds"], sample["cpu_seconds"])
                record["max_simultaneous_working_set_mib"] = max(
                    record["max_simultaneous_working_set_mib"], simultaneous_working_set_mib)
        sampler = threading.Thread(target=monitor, daemon=True)
        sampler.start()
        try:
            def initialize(sid):
                begin = time.monotonic()
                try:
                    state = manager.start(sid)
                    return {"status": "ok", "elapsed_seconds": time.monotonic() - begin,
                            "pid": state["pid"], "model_identity": state["model_identity"],
                            "hardware_commands_sent": state["hardware_commands_sent"]}
                except Exception as exc:
                    return {"status": "error", "elapsed_seconds": time.monotonic() - begin,
                            "error": type(exc).__name__ + ": " + str(exc), "traceback": traceback.format_exc()}
            if args.mode == "serial":
                for sid in STATIONS:
                    record["station_results"][sid] = initialize(sid)
                    print(sid, record["station_results"][sid]["status"], round(record["station_results"][sid]["elapsed_seconds"], 2), flush=True)
            else:
                with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                    tasks = {sid: executor.submit(initialize, sid) for sid in STATIONS}
                    for sid, task in tasks.items():
                        record["station_results"][sid] = task.result()
                        print(sid, record["station_results"][sid]["status"], round(record["station_results"][sid]["elapsed_seconds"], 2), flush=True)
            record["elapsed_seconds"] = time.monotonic() - started
            record["sum_individual_peak_working_set_mib"] = sum(x["peak_working_set_mib"] for x in record["samples"].values())
            record["aggregate_cpu_seconds"] = sum(x["cpu_seconds"] for x in record["samples"].values())
        finally:
            stop_monitor.set()
            sampler.join(2)
            manager.close()
    print(json.dumps(record, ensure_ascii=False, indent=2), flush=True)
    return 0 if all(r["status"] == "ok" for r in record["station_results"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
