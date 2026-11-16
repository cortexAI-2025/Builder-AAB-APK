import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('safe_zip', Path(__file__).parents[1] / 'scripts/safe_zip.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class ArchiveTests(unittest.TestCase):
    def attempt(self, name, mode=stat.S_IFREG | 0o644):
        with tempfile.TemporaryDirectory() as tmp:
            archive, out = Path(tmp)/'a.zip', Path(tmp)/'out'
            with zipfile.ZipFile(archive, 'w') as z:
                info = zipfile.ZipInfo(name)
                info.external_attr = mode << 16
                z.writestr(info, 'payload')
            m.extract(archive, out)
            return (out/name).read_text()
    def test_valid(self): self.assertEqual(self.attempt('repo/app/src/Test.kt'), 'payload')
    def test_traversal(self):
        for name in ('../escape', '/absolute', 'C:/escape', 'a/../../escape', 'a\\escape', 'a\nfile'):
            with self.subTest(name=name), self.assertRaises(ValueError): self.attempt(name)
    def test_symlink(self):
        with self.assertRaises(ValueError): self.attempt('link', stat.S_IFLNK | 0o777)
    def test_special(self):
        with self.assertRaises(ValueError): self.attempt('fifo', stat.S_IFIFO | 0o644)
    def test_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp)/'a.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('a', '1'); z.writestr('a', '2')
            with self.assertRaises(ValueError): m.extract(archive, Path(tmp)/'out')
    def test_bomb(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp)/'a.zip'
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z: z.writestr('huge', b'a'*1000000)
            with self.assertRaises(ValueError): m.extract(archive, Path(tmp)/'out')
if __name__ == '__main__': unittest.main()
