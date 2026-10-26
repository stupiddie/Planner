import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[1] / 'validate-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
REVISION = 'a' * 40
REQUIRED = ['index.html', 'server/server.js', 'server/manage.js', 'server/package.json', 'server/package-lock.json']


class ReleaseTests(unittest.TestCase):
    def make_archive(self, root, extra=(), revision=REVISION, required=REQUIRED):
        archive = Path(root) / 'release.tar.gz'
        with tarfile.open(archive, 'w:gz', format=tarfile.PAX_FORMAT, pax_headers={'comment': revision}) as tar:
            for name in required:
                entry = tarfile.TarInfo(name)
                data = b'source code'
                entry.size, entry.mode = len(data), 0o644
                tar.addfile(entry, io.BytesIO(data))
            for entry in extra:
                tar.addfile(entry, io.BytesIO(b'') if entry.isfile() else None)
        return archive

    def test_valid_source_archive(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'source'
            dest.mkdir()
            release.extract_release(self.make_archive(root), dest, REVISION)
            self.assertEqual((dest / 'server/server.js').read_bytes(), b'source code')

    def test_unsafe_entries_rejected_before_writing(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/tmp/escape', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('hardlink', tarfile.LNKTYPE), ('device', tarfile.CHRTYPE), ('server/.env', tarfile.REGTYPE), ('server/node_modules/file', tarfile.REGTYPE), ('.git/config', tarfile.REGTYPE), ('index.html', tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                dest = Path(root) / 'source'
                dest.mkdir()
                entry = tarfile.TarInfo(name)
                entry.type, entry.linkname = kind, '/etc/passwd'
                with self.assertRaises(ValueError):
                    release.extract_release(self.make_archive(root, [entry]), dest, REVISION)
                self.assertEqual(list(dest.iterdir()), [])

    def test_incomplete_or_wrong_revision_rejected(self):
        for revision, required in [('b' * 40, REQUIRED), (REVISION, REQUIRED[:-1])]:
            with tempfile.TemporaryDirectory() as root:
                dest = Path(root) / 'source'
                dest.mkdir()
                with self.assertRaises(ValueError):
                    release.extract_release(self.make_archive(root, revision=revision, required=required), dest, REVISION)

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'source'
            dest.mkdir()
            (dest / 'keep').write_text('existing local data')
            with self.assertRaises(ValueError):
                release.extract_release(self.make_archive(root), dest, REVISION)
            self.assertEqual((dest / 'keep').read_text(), 'existing local data')

    def test_directory_cannot_replace_required_file(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root) / 'source'
            dest.mkdir()
            entry = tarfile.TarInfo('index.html')
            entry.type = tarfile.DIRTYPE
            with self.assertRaises(ValueError):
                release.extract_release(self.make_archive(root, [entry], required=REQUIRED[1:]), dest, REVISION)


if __name__ == '__main__':
    unittest.main()
