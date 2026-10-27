import hashlib
import gzip
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[2]/'scripts/archive'))
from publish_section_facts import bounded_batches,pin_fragment,public_document,snapshot_parts,export_archives,index_payloads


class SectionPublicationTest(unittest.TestCase):
    def test_complete_index_is_compressed_without_losing_source_metadata(self):
        document=dict(expectedSources=423,sourceCounts={'ready':423},tables={'votes':{'parts':{'one':dict(url='one.gz',localFile='one.gz',rawBytes=99,cities=['30015'])}}})
        files=index_payloads(document);descriptor=json.loads(files['index.json'])
        metadata=json.loads(gzip.decompress(files[descriptor['index']['url']]))
        self.assertEqual(metadata['tables']['votes']['parts']['one']['cities'],['30015'])
        self.assertEqual(metadata['tables']['votes']['parts']['one']['rawBytes'],99)
        self.assertNotIn('localFile',metadata['tables']['votes']['parts']['one'])
        self.assertEqual(descriptor['index']['sha256'],hashlib.sha256(files['index.json.gz']).hexdigest())

    def test_exports_preserve_pack_bytes_and_fail_if_the_snapshot_changed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);body=b'exact compressed observations';(root/'part.gz').write_bytes(body)
            records=[dict(path='part.gz',bytes=len(body),sha256=hashlib.sha256(body).hexdigest())]
            archives=export_archives(root,records,root/'exports',limit=100000)
            with zipfile.ZipFile(archives[0]) as archive:
                self.assertEqual(archive.read('part.gz'),body)
            original=archives[0].read_bytes()
            export_archives(root,records,root/'exports',limit=100000)
            self.assertEqual(archives[0].read_bytes(),original)
            (root/'part.gz').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'changed while preparing'):
                export_archives(root,records,root/'exports',limit=100000)

    def test_push_batches_remain_below_the_transport_limit(self):
        records=[dict(path=str(i),bytes=n) for i,n in enumerate([600,800,11])]
        batches=list(bounded_batches(records,1000))
        self.assertEqual([[r['path'] for r in batch] for batch in batches],[['0'],['1','2']])
        self.assertTrue(all(sum(r['bytes'] for r in b)<=1000 for b in batches))

    def test_public_fragment_pins_sources_and_removes_local_transport_paths(self):
        fragment=dict(tables={'votes':dict(parts={'part':dict(url='votes/a.csv.gz',localFile='votes/a.csv.gz',electionIds=['event'],sourcePart='part')})},
            sourceMetadata=[dict(url='source-metadata/a.json.gz',localFile='source-metadata/a.json.gz')],sources=[dict(coverageUrl='source-metadata/a.json.gz')])
        actual=pin_fragment(fragment,'a'*40)
        p=actual['tables']['votes']['parts']['part']
        self.assertEqual(p['electionIds'],['event']);self.assertNotIn('localFile',p)
        self.assertIn('/'+('a'*40)+'/votes/a.csv.gz',p['url'])
        self.assertIn('/'+('a'*40)+'/source-metadata/a.json.gz',actual['sources'][0]['coverageUrl'])

    def test_private_metadata_is_not_published(self):
        self.assertEqual(public_document(dict(localFile='/srv/private/cache.gz',url='parts/a.gz')),{'url':'parts/a.gz'})
        with self.assertRaisesRegex(ValueError,'private filesystem'):
            public_document(dict(debugPath='/home/private/internal.json'))

    def test_hashing_writes_the_verified_bytes_to_git_without_a_second_file_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);body=b'compressed factual bytes';(root/'part.gz').write_bytes(body)
            part=dict(url='part.gz',localFile='part.gz',bytes=len(body),sha256=hashlib.sha256(body).hexdigest())
            doc=dict(tables={'votes':dict(parts={'one':part})})
            with patch('publish_section_facts.subprocess.check_output',return_value=('b'*40+'\n').encode()) as git:
                result=snapshot_parts(root,doc)
                self.assertEqual(git.call_args.kwargs['input'],body)
            self.assertEqual(result[0]['sha256'],part['sha256'])
            (root/'part.gz').write_bytes(b'modified')
            with self.assertRaisesRegex(ValueError,'changed after'):
                snapshot_parts(root,doc)


if __name__=='__main__':unittest.main()
