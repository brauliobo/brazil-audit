import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts/archive'))
from archive_rdv import identity


class OfficialRdvIdentityTest(unittest.TestCase):
    def test_modern_source_and_legacy_published_member_share_exact_election_identity(self):
        self.assertEqual(identity('o00407ac0100700090001-rdv.dat'),
                         identity('files/ac-01007-0009-0001-hash-o00407-0100700090001.rdv'))

    def test_older_source_requires_state_context_and_preserves_turn_election_code(self):
        self.assertIsNone(identity('o00406-0100700090001.rdv'))
        self.assertEqual(identity('o00406-0100700090001.rdv', 'AC'), 'o00406:ac:0100700090001')
        self.assertNotEqual(identity('o00406-0100700090001.rdv', 'AC'), identity('o00407-0100700090001.rdv', 'AC'))
