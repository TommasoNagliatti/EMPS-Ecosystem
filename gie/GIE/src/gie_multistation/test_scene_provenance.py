"""Commercial presentation metadata must satisfy EMPS without changing frozen scenes."""
import copy
import json
import unittest
from .manager import scoped_decision
from .registry import ROOT


class SceneProvenanceTests(unittest.TestCase):
    config = {'kind': 'commercial', 'station_id': 'Commercial_HighAutonomy_V2'}

    def test_all_original_scenes_preserved(self):
        scenes = json.loads((ROOT / 'src/gie_control/assets/scenes.json').read_text(encoding='utf-8'))['scenes']
        self.assertEqual(len(scenes), 16)
        for scene in scenes:
            original = copy.deepcopy(scene['result'])
            for mode in ('PRESENTATION', 'MANUAL_DEMO'):
                result = scoped_decision(original, self.config, mode)
                self.assertEqual(result['provenance']['station_id'], self.config['station_id'])
                self.assertEqual(result['provenance']['origin'], 'SIMULATED')
                expected = copy.deepcopy(original)
                expected['provenance'].update(station_id=self.config['station_id'], origin='SIMULATED')
                self.assertEqual(result, expected)
                self.assertEqual(original, scene['result'])

    def test_conflicting_identity_or_origin_rejected(self):
        for provenance in ({'station_id': 'DEMO_CASA_001'}, {'origin': 'REAL'}):
            with self.assertRaises(ValueError):
                scoped_decision({'provenance': provenance}, self.config, 'PRESENTATION')

    def test_other_modes_profiles_and_empty_state_unchanged(self):
        value = {'provenance': {'station_id': 'DEMO_CASA_001'}}
        self.assertIs(scoped_decision(value, self.config, 'NORMAL'), value)
        self.assertIs(scoped_decision(value, {'kind': 'forecast'}, 'SIMULATION'), value)
        self.assertIsNone(scoped_decision(None, self.config, 'PRESENTATION'))


if __name__ == '__main__':
    unittest.main()
