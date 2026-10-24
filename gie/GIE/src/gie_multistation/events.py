"""Persistent, station-scoped alert feed for cycles served by the core API."""
from pathlib import Path
import threading

from gie_panel.alerts import Alerts, detect, key
from gie_panel.data import equipment


class EventFeed:
    def __init__(self, directory):
        self.directory = Path(directory) / 'alerts'
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.ledgers = {}
        self.cycle_locks = {}

    def cycle_lock(self, station_id):
        with self.lock:
            return self.cycle_locks.setdefault(station_id, threading.RLock())

    def ledger(self, station_id):
        with self.lock:
            if station_id not in self.ledgers:
                self.ledgers[station_id] = Alerts(self.directory / (station_id + '.sqlite'))
            return self.ledgers[station_id]

    def record_cycle(self, station_id, reply, config, current=None):
        result = reply.get('state')
        if result is None:
            return
        ledger = self.ledger(station_id)
        active = {key(a['code'], a.get('equipment_id')) for a in ledger.list(station_id)
                  if a['status'] != 'RESOLVED'}
        conditions, domains = detect(result, equipment(config), current, active)
        source = 'core:' + reply['generation'] + ':' + str(reply['revision'])
        ledger.observe(station_id, reply['generation'], result['timestamp'], source,
                       conditions, domains)

    def alerts(self, station_id, severity=None, status=None, equipment_id=None):
        return self.ledger(station_id).list(station_id, severity, status, equipment_id)

    def events(self, station_id, after=0):
        return self.ledger(station_id).history(station_id, after)

    def acknowledge(self, station_id, alert_id):
        return self.ledger(station_id).ack(station_id, alert_id)

    def close(self):
        with self.lock:
            for ledger in self.ledgers.values():
                ledger.close()
            self.ledgers.clear()
