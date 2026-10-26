import importlib.machinery
import importlib.util
import pathlib
import unittest


loader = importlib.machinery.SourceFileLoader('pack', str(pathlib.Path(__file__).parents[1] / 'bin/pack-release'))
spec = importlib.util.spec_from_loader('pack', loader)
pack = importlib.util.module_from_spec(spec)
loader.exec_module(pack)


class PackReleaseTest(unittest.TestCase):
    def test_rounds_keep_separate_archive_groups(self):
        for election in ('2026', '2026-2'):
            with self.subTest(election=election):
                jobs = pack.plan(election, {('logs', 'sp'): [('files/sp-log.jez', 10)]}, {})
                self.assertEqual(f'{election}-logs-sp-01.zip', jobs[0]['name'])
                self.assertEqual(election, pack.NAME.fullmatch(jobs[0]['name'])[1])

    def test_runoff_split_keeps_existing_part_number(self):
        parts = {'logs-sp': [{'name': '2026-2-logs-sp-03.zip', 'bound': None, 'sig': None}]}
        files = [('files/sp-a.jez', pack.MAX), ('files/sp-b.jez', pack.MAX)]
        jobs = pack.plan('2026-2', {('logs', 'sp'): files}, parts)
        self.assertEqual(['2026-2-logs-sp-03.zip', '2026-2-logs-sp-04.zip'], [job['name'] for job in jobs])


if __name__ == '__main__':
    unittest.main()
