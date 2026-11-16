from pathlib import Path
import subprocess
import tempfile
import unittest
SCRIPT=Path(__file__).parents[1]/'scripts/analyze_project.sh'
class AnalysisTests(unittest.TestCase):
    def test_kotlin_custom_module_without_literal_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'mobile').mkdir();(root/'gradle/wrapper').mkdir(parents=True)
            (root/'build.gradle.kts').write_text('plugins {}');(root/'settings.gradle.kts').write_text('include(":mobile")')
            (root/'mobile/build.gradle.kts').write_text('plugins { id("com.android.application") }\nandroid { compileSdk = 34 }')
            (root/'gradlew').write_text('# fixture only');(root/'gradle/wrapper/gradle-wrapper.jar').write_bytes(b'fixture')
            (root/'gradle/wrapper/gradle-wrapper.properties').write_text('distributionUrl=gradle-8.6-bin.zip')
            p=subprocess.run(['bash','-c','set -euo pipefail; source "$1"; analyze_project "$2"','test',str(SCRIPT),tmp],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stdout+p.stderr)
    def test_groovy_sdk_literals(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'app').mkdir();(root/'app/build.gradle').write_text('android { compileSdk 34; minSdk 23; targetSdk 34 }')
            p=subprocess.run(['bash','-c','source "$1"; _resolve_sdk_versions "$2"; echo "$COMPILE_SDK:$MIN_SDK:$TARGET_SDK"','test',str(SCRIPT),tmp],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr);self.assertIn('34:23:34',p.stdout)
if __name__=='__main__':unittest.main()
