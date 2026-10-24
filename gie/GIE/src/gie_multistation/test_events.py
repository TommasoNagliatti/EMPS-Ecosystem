"""Core API events must follow real station cycles and survive service restart."""
import asyncio
import tempfile
import unittest

import httpx

from gie_provisioning.examples import fixture
from .api import create_app


STATION = 'NEW_EVENT_001'
ADMIN = 'event-admin-' + 'a' * 32
OTHER = 'event-other-' + 'b' * 32


class EventFeedTests(unittest.TestCase):
    def test_cycle_events_ack_scope_cursor_and_persistence(self):
        async def exercise(directory):
            app = create_app({ADMIN: [STATION], OTHER: ['DEMO_CASA_001']},
                             directory, provisioning_tokens=[ADMIN])
            headers = {'Authorization': 'Bearer ' + ADMIN}
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                             base_url='http://test') as client:
                    response = await client.post('/v2/stations', json=fixture(STATION), headers=headers)
                    self.assertEqual(response.status_code, 200, response.text)
                    response = await client.post('/v1/stations/' + STATION + '/initialize', json={}, headers=headers)
                    self.assertEqual(response.status_code, 200, response.text)
                    response = await client.post('/v2/stations/' + STATION + '/cycle',
                                                 json={'issue_time': '2026-10-13T00:00:00-04:00'}, headers=headers)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()['event_feed_status'], 'recorded')
                    self.assertFalse(response.json()['state']['execution_allowed'])

                    path = '/v1/stations/' + STATION
                    events = (await client.get(path + '/events', headers=headers)).json()
                    self.assertTrue(events)
                    self.assertTrue(all(event['station_id'] == STATION for event in events))
                    self.assertTrue(all(event['physical_dispatch'] is False for event in events))
                    self.assertEqual((await client.get(path + '/events')).status_code, 401)
                    self.assertEqual((await client.get(path + '/events',
                                            headers={'Authorization': 'Bearer ' + OTHER})).status_code, 403)
                    cursor = events[-1]['cursor']
                    self.assertEqual((await client.get(path + '/events?after=' + str(cursor), headers=headers)).json(), [])
                    self.assertEqual((await client.get(path + '/events?after=-1', headers=headers)).status_code, 422)
                    await client.get(path + '/state', headers=headers)
                    self.assertEqual((await client.get(path + '/events?after=' + str(cursor), headers=headers)).json(), [])

                    alerts = (await client.get(path + '/alerts', headers=headers)).json()
                    self.assertTrue(alerts)
                    alert_id = alerts[0]['alert_id']
                    ack = await client.post(path + '/alerts/' + alert_id + '/ack', headers=headers)
                    self.assertEqual(ack.status_code, 200, ack.text)
                    self.assertEqual(ack.json()['status'], 'ACKNOWLEDGED')
                    new_events = (await client.get(path + '/events?after=' + str(cursor), headers=headers)).json()
                    self.assertEqual([item['transition'] for item in new_events], ['ACKNOWLEDGED'])
                    self.assertEqual((await client.post(path + '/alerts/' + alert_id + '/ack', headers=headers)).status_code, 200)
                    self.assertEqual(len((await client.get(path + '/events?after=' + str(cursor), headers=headers)).json()), 1)

            app = create_app({ADMIN: [STATION]}, directory)
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                             base_url='http://test') as client:
                    persisted = (await client.get('/v1/stations/' + STATION + '/events', headers=headers)).json()
                    self.assertEqual(len(persisted), len(events) + 1)
                    self.assertEqual(persisted[-1]['transition'], 'ACKNOWLEDGED')

        with tempfile.TemporaryDirectory(prefix='gie-events-') as directory:
            asyncio.run(exercise(directory))


if __name__ == '__main__':
    unittest.main()
