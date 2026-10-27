import csv
import gzip
import io
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/archive'))
from pack_section_facts import Packs, attach_metric_coverage


class SectionPacksTest(unittest.TestCase):
    def test_reference_metric_coverage_keeps_known_zero_separate_from_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);path=root/'units.csv.gz'
            with gzip.open(path,'wt',encoding='utf8',newline='') as stream:
                writer=csv.writer(stream,lineterminator='\n')
                writer.writerow(['event','office','pe','0',''])
                writer.writerow(['event','office','pe','','100'])
            before=path.read_bytes()
            record=dict(table=dict(name='election_section_units',columns='election_id,office_key,state,blank,eligible',parts={'p':dict(url=path.name)}))
            result=attach_metric_coverage(record,root)
            coverage=result['metricCoverage'][0]
            self.assertEqual(coverage['rows'],2)
            self.assertEqual(coverage['metrics']['blank'],dict(knownRows=1,totalRows=2))
            self.assertEqual(coverage['metrics']['eligible'],dict(knownRows=1,totalRows=2))
            self.assertEqual(path.read_bytes(),before,'metadata enrichment must not rewrite factual CSVs')

    def test_same_city_chunks_have_independent_reload_boundaries_and_keep_section_grain(self):
        fields=['election_id','state','city_code','zone','section','office','office_key','votes','source_part']
        row=dict(election_id='e',state='ac',city_code='01120',zone='0001',office='3',office_key='governor',votes='5')
        results=[]
        with tempfile.TemporaryDirectory() as directory,patch('pack_section_facts.MAX_ROWS',2):
            for name in ['first','second']:
                root=pathlib.Path(directory)/name
                writer=Packs(root,'election_section_votes',fields,'source')
                for section in range(5):writer.write({**row,'section':str(section).zfill(4)})
                parts=writer.finish()
                self.assertEqual(len(parts),3)
                self.assertEqual(sum(p['rows'] for p in parts.values()),5)
                seen=set()
                for key,p in parts.items():
                    self.assertEqual(p['where'],"source_part = '"+key+"'")
                    self.assertEqual(p['grains'],['section'])
                    self.assertEqual(p['cities'],['01120'])
                    rows=list(csv.reader(io.StringIO(gzip.decompress((root/p['url']).read_bytes()).decode())))
                    self.assertTrue(all(r[-1]==key for r in rows))
                    seen.update(r[4] for r in rows)
                self.assertEqual(len(seen),5)
                results.append({k:p['sha256'] for k,p in parts.items()})
            self.assertEqual(results[0],results[1])

if __name__=='__main__':unittest.main()
