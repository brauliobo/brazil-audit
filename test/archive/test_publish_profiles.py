import csv
import gzip
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).parents[2]/'scripts/archive'))
from normalize_profiles import FIELDS, PartWriter
from publish_profiles import split_city_parts


class BrowserProfilePartitionsTest(unittest.TestCase):
    def test_city_intervals_are_disjoint_copy_partitions_and_preserve_every_cell(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);writer=PartWriter(root/'sp.detail.csv.gz')
            for bucket in [10,11,12]:
                for i in range(20):
                    row=dict.fromkeys(FIELDS)
                    row.update(dataset_id='sample',state='sp',level='detail',grain='zone',city_code=str(bucket*1000+i),
                               gender=str(i),eligible=i,year=2026)
                    writer.write(row)
            writer.close()
            pieces=split_city_parts(writer.path,root/'split')
            self.assertEqual({label for label,_,_,_ in pieces},{'10','11','12'})
            self.assertEqual(sum(p['rows'] for _,_,p,_ in pieces),60)
            for label,path,metadata,where in pieces:
                self.assertIn(f"city_code >= '{int(label)*1000:05d}'",where)
                with gzip.open(path,'rt') as stream:
                    rows=list(csv.DictReader(stream,fieldnames=FIELDS))
                self.assertTrue(all(int(r['city_code'])//1000==int(label) for r in rows))
                self.assertEqual(len(rows),metadata['rows'])

    def test_oversized_owning_partition_fails_instead_of_publishing_unbounded_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);writer=PartWriter(root/'source.csv.gz')
            row=dict.fromkeys(FIELDS);row.update(city_code='10001',eligible=1)
            writer.write(row);writer.close()
            with patch('publish_profiles.MAX_PART',1):
                with self.assertRaisesRegex(ValueError,'exceeds 20 MB'):
                    split_city_parts(writer.path,root/'split')


if __name__=='__main__':unittest.main()
