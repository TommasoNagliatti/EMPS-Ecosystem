import sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from fastapi.testclient import TestClient
from service.api import create_app

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(create_app(token='service-test-secret-123456789',station_id='123'))
        self.client.headers['Authorization']='Bearer service-test-secret-123456789'
    def test_auth_and_safe_start(self):
        self.assertEqual(self.client.get('/health',headers={'Authorization':'Bearer wrong'}).status_code,401)
        s=self.client.get('/state').json()
        self.assertEqual(s['mode'],'NORMAL');self.assertIsNone(s['state']);self.assertFalse(s['presentation']['playing'])
    def test_presentation_and_guard(self):
        self.assertEqual(self.client.post('/manual-demo/event',json={'event':'EV_PEAK'}).status_code,409)
        s=self.client.post('/presentation/start').json();self.assertTrue(s['presentation']['playing'])
        s=self.client.post('/presentation/pause').json();self.assertFalse(s['presentation']['playing'])
        self.assertEqual(self.client.post('/presentation/next').json()['presentation']['scene_number'],2)
        self.assertEqual(self.client.post('/presentation/previous').json()['presentation']['scene_number'],1)
        self.assertFalse(self.client.post('/presentation/reset').json()['presentation']['playing'])
    def test_real_mpc_with_stable_slot_context(self):
        body={'station_id':'123','demands':[{'charger_id':'456','session_id':'7','evse_slot':2,'requested_kw':11,'connected':True}]}
        self.assertEqual(self.client.post('/context',json=body).status_code,200)
        self.client.post('/mode',json={'mode':'MANUAL_DEMO'})
        result=self.client.post('/manual-demo/event',json={'event':'RESET'}).json()['state']
        self.assertTrue(result['execution_allowed'],result.get('health'))
        n=result['numeric_state'];self.assertEqual(n['ev_demand_kw'],11)
        self.assertAlmostEqual(n['evse_setpoints_kw'][1],11);self.assertEqual(n['evse_setpoints_kw'][0],0)
        body['demands'][0]['connected']=False;body['demands'][0]['requested_kw']=0
        stopped=self.client.post('/context',json=body).json()['state']
        self.assertEqual(sum(stopped['numeric_state']['evse_setpoints_kw']),0)
    def test_station_boundary_and_input_validation(self):
        self.assertEqual(self.client.post('/context',json={'station_id':'999','demands':[]}).status_code,409)
        self.assertEqual(self.client.post('/context',json={'station_id':'123','demands':[{'charger_id':'1','evse_slot':5}]}).status_code,422)
        self.assertEqual(self.client.post('/mode',json={'mode':'UNSAFE'}).status_code,422)

if __name__=='__main__':unittest.main()
