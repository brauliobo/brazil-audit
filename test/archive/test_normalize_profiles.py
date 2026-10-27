import csv
import gzip
import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / 'scripts/archive'))
from normalize_profiles import FIELDS, aggregate, canonical_members, mapping, normalize_source, transform

HEADERS = ['DT_GERACAO','HH_GERACAO','AA_ELEICAO','SG_UF','CD_MUNICIPIO','NM_MUNICIPIO','NR_ZONA',
           'CD_GENERO','DS_GENERO','QT_ELEITORES','QT_ELEITORES_BIOMETRIA']
VALUES = ['14/07/2026','18:03:33','2026','AC','01007','BUJARI','-1','-3','#NE','12','0']
SOURCE = dict(dataset_id='eleitorado-2026',kind='electorate',resource={'url':'https://cdn.tse.jus.br/perfil_eleitorado_2026.zip'})


class DemographicProfilesTest(unittest.TestCase):
    def test_source_unknown_category_is_retained_and_missing_metric_is_not_zero(self):
        row = transform(VALUES, mapping(HEADERS), SOURCE, 'a'*64)
        self.assertEqual((row['gender_code'], row['gender']), ('-3','#NE'))
        self.assertEqual(row['biometric'], 0); self.assertIsNone(row['absent'])
        self.assertEqual(row['eligible'], 12); self.assertIsNone(row['zone'])
        self.assertEqual(row['source_zone'], '-1'); self.assertEqual(row['grain'], 'municipality')
        self.assertIsNone(row['turn']); self.assertEqual(row['generated_date'], '2026-07-14')

    def test_negative_quantity_becomes_unknown_with_original_sentinel(self):
        values = VALUES.copy(); values[-2] = '-1'
        row = transform(values, mapping(HEADERS), SOURCE, 'a'*64)
        self.assertIsNone(row['eligible']); self.assertEqual(json.loads(row['metric_sentinels']), {'eligible':-1})

    def test_owning_mapping_rejects_unrepresented_axis(self):
        with self.assertRaisesRegex(ValueError, 'unmapped demographic fields'):
            mapping(HEADERS+['NEW_SOURCE_DIMENSION'])

    def test_brasil_file_is_one_nationwide_cell_source_not_an_extra_territory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'source.zip'
            with zipfile.ZipFile(path,'w') as archive:
                archive.writestr('perfil_BRASIL.csv','national cells')
                archive.writestr('perfil_AC.csv','copied AC cells')
            with zipfile.ZipFile(path) as archive:
                self.assertEqual([m.filename for m in canonical_members(archive)], ['perfil_BRASIL.csv'])

    def test_state_cube_sums_disjoint_cells_without_filling_unknown_categories(self):
        row = transform(VALUES, mapping(HEADERS), SOURCE, 'a'*64)
        combined = aggregate(aggregate(None,row), row)
        self.assertEqual(combined['eligible'], 24); self.assertIsNone(combined['present'])
        self.assertEqual((combined['level'],combined['grain']), ('state','state'))
        self.assertIsNone(combined['city_code']); self.assertEqual(combined['gender_code'],'-3')

    def test_complete_pipeline_preserves_cells_and_partitions_rollup_separately(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = SOURCE.copy(); resource = source['resource']; key=hashlib.sha256(resource['url'].encode()).hexdigest()
            path=root/'downloads'/key/'perfil_eleitorado_2026.zip'; path.parent.mkdir(parents=True)
            body=io.StringIO(); writer=csv.writer(body,delimiter=';',lineterminator='\n');writer.writerow(HEADERS)
            writer.writerow(VALUES);writer.writerow(VALUES)
            with zipfile.ZipFile(path,'w') as archive:archive.writestr('perfil_BRASIL.csv',body.getvalue().encode('cp1252'))
            result=normalize_source(root,root/'out',source)
            self.assertTrue(result['complete']); self.assertEqual(result['rows'],2)
            detail=result['parts']['eleitorado-2026/ac.detail']; state=result['parts']['eleitorado-2026/ac.state']
            self.assertEqual((detail['rows'],state['rows']),(2,1))
            self.assertEqual(detail['grains'],['municipality'])
            with gzip.open(root/'out'/state['localFile'],'rt') as stream:
                row=dict(zip(FIELDS,next(csv.reader(stream))))
            self.assertEqual(row['eligible'],'24');self.assertEqual(row['level'],'state')
            self.assertEqual(row['source_sha256'],result['sourceSha256'])
            self.assertEqual(result['selectedMembers'][0]['columnMapping']['eligible'],'QT_ELEITORES')


if __name__ == '__main__':unittest.main()
