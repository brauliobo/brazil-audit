import csv
import io
import pathlib
import sys
import tempfile
import unittest
import zipfile
from collections import Counter
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'scripts/archive'))
from reference_members import merge_observation
from section_facts import source_rows


def row(member,section='0001',**changes):
    return dict(election_id='2022:548:1:2022-10-02',office_key='historical:25:CONSELHEIRO DISTRITAL',
        state='pe',city_code='30015',zone='0004',section=section,transit='N',eligible='100',present='80',absent='20',
        blank='0',null_votes='0',nominal_reported='80',source_member=member,**changes)


def audit():return dict(members={},overlaps=Counter(),duplicateRows=0)


class ReferenceMembersTest(unittest.TestCase):
    def test_three_representations_use_one_exact_quantity_and_keep_unique_state_units(self):
        records={};a=audit()
        for member in ['detalhe_BR.csv','detalhe_PE.csv','detalhe_BRASIL.csv']:
            merge_observation(records,row(member),a)
        merge_observation(records,row('detalhe_PE.csv','0002'),a)
        self.assertEqual(len(records),2)
        self.assertEqual(a['duplicateRows'],2)
        self.assertEqual(records[next(iter(records))]['source_member'],'detalhe_BRASIL.csv')
        self.assertEqual({r['section'] for r in records.values()},{'0001','0002'})
        self.assertEqual(sum(int(r['nominal_reported']) for r in records.values()),160)

    def test_conflicts_and_unknown_versus_zero_are_never_replaced_by_a_preferred_member(self):
        for changed in [{'present':'81'},{'blank':''}]:
            records={};a=audit();merge_observation(records,row('detalhe_PE.csv'),a)
            replacement=row('detalhe_BRASIL.csv');replacement.update(changed)
            with self.assertRaisesRegex(ValueError,'Conflicting section reference measures'):
                merge_observation(records,replacement,a)

    def test_disjoint_transit_cohorts_remain_distinct(self):
        records={};a=audit();merge_observation(records,row('detalhe_PE.csv'),a)
        other=row('detalhe_BRASIL.csv');other['transit']='S';merge_observation(records,other,a)
        self.assertEqual(len(records),2)
        self.assertEqual(a['duplicateRows'],0)

    def test_reference_input_retains_br_brasil_and_uf_until_content_reconciliation(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'references.zip'
            text=io.StringIO();writer=csv.writer(text,delimiter=';',lineterminator='\n')
            writer.writerow(['NR_SECAO','CD_ELEICAO','CD_CARGO','SG_UF'])
            writer.writerow(['1','548','25','PE'])
            with zipfile.ZipFile(path,'w') as z:
                for member in ['detalhe_BR.csv','detalhe_BRASIL.csv','detalhe_PE.csv']:z.writestr(member,text.getvalue())
            observed=list(source_rows(path))
            self.assertEqual(len(observed),3)
            self.assertEqual({r['_source_member'] for r in observed},{'detalhe_BR.csv','detalhe_BRASIL.csv','detalhe_PE.csv'})

if __name__=='__main__':unittest.main()
