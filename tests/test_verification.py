import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile
spec = importlib.util.spec_from_file_location('verify', Path(__file__).parents[1]/'scripts/verify_artifacts.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class VerificationTests(unittest.TestCase):
    def test_unsigned_bundle_blocked_before_external_verifier(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'unsigned.aab'
            with zipfile.ZipFile(file,'w') as z:
                z.writestr('BundleConfig.pb',b'fixture');z.writestr('base/manifest/AndroidManifest.xml',b'fixture')
            with self.assertRaisesRegex(ValueError,'Unsigned'):m.verify(file)
    def test_fake_apk_verifier_failure_is_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'bad.apk';file.write_bytes(b'invalid')
            with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','bad signature')):
                with self.assertRaises(ValueError):m.verify(file)
    def test_signed_marker_cannot_replace_jarsigner_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'fake.aab'
            with zipfile.ZipFile(file,'w') as z:
                for name in ['BundleConfig.pb','base/manifest/AndroidManifest.xml','META-INF/KEY.RSA']:z.writestr(name,b'fixture')
            with patch.object(m,'run',return_value='jar is unsigned.'):
                with self.assertRaises(ValueError):m.verify(file)
    def test_signing_helper_requires_authorization(self):
        script=Path(__file__).parents[1]/'scripts/sign_artifacts.sh'
        result=subprocess.run(['bash','-c','source "$1"; sign_aab /missing.aab','test',str(script)],capture_output=True,env={'PATH':'/usr/bin:/bin'})
        self.assertNotEqual(result.returncode,0)
if __name__=='__main__': unittest.main()
