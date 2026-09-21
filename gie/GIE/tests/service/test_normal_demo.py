import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from fastapi.testclient import TestClient
from service.normal_demo import NormalDemo, local_inputs
from service.api import create_app
from gie_control.scenarios import validate_physics

class NormalTests(unittest.TestCase):
    def test_day_night_and_weather_failure(self):
        day=datetime(2026,9,19,15,tzinfo=timezone.utc)
        self.assertGreater(local_inputs(day)['solar_kw'],300)
        self.assertEqual(local_inputs(day.replace(hour=3))['solar_kw'],0)
        broken=NormalDemo(weather=True,clock=lambda:day,transport=lambda _:(_ for _ in ()).throw(OSError('offline')))
        one=broken.sample({'latitude':-23.5,'longitude':-46.6})
        self.assertGreater(one['solar_kw'],0);self.assertEqual(broken.weather_source,'local_time_fallback')
    def test_soc_uses_seconds_not_solver_interval(self):
        now=datetime(2026,9,19,15,tzinfo=timezone.utc)
        n=NormalDemo(clock=lambda:now);n.last_at=now-timedelta(seconds=5)
        n.result={'execution_allowed':True,'numeric_state':{'battery_discharge_kw':100,'battery_charge_kw':0}}
        self.assertAlmostEqual(n.sample({})['battery_soc_pct'],50-100/.95*5/3600/2000*100)
    def test_normal_uses_frozen_runtime_and_real_slot_context(self):
        day=datetime(2026,9,19,15,tzinfo=timezone.utc)
        with patch.dict(os.environ,{'GIE_NORMAL_DEMO':'true','GIE_WEATHER_ENABLED':'false'}),patch('service.api.NormalDemo',lambda **_:NormalDemo(clock=lambda:day)):
            c=TestClient(create_app(token='normal-demo-test-secret-123456',station_id='13'))
        c.headers['Authorization']='Bearer normal-demo-test-secret-123456'
        context={'station_id':'13','demands':[{'charger_id':'49','evse_slot':1,'requested_kw':22,'connected':True,'session_id':'100'}]}
        result=c.post('/context',json=context).json()['state']
        self.assertIsNotNone(result);self.assertEqual(result['mode'],'NORMAL');self.assertTrue(result['provenance']['normal_demo']);validate_physics(result)
        self.assertGreater(result['numeric_state']['evse_setpoints_kw'][0],0)
        context['demands'][0].update(connected=False,requested_kw=0,session_id=None)
        off=c.post('/context',json=context).json()['state'];self.assertEqual(sum(off['numeric_state']['evse_setpoints_kw']),0)
        self.assertTrue(c.post('/presentation/start').json()['presentation']['playing'])
        self.assertFalse(c.post('/presentation/pause').json()['presentation']['playing'])
        self.assertEqual(c.post('/mode',json={'mode':'NORMAL'}).json()['mode'],'NORMAL')
        with patch('service.api.time.monotonic',return_value=10**12):self.assertIsNone(c.get('/state').json()['state'])

if __name__=='__main__':unittest.main()
