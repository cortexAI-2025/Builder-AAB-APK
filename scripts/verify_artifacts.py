#!/usr/bin/env python3
"""Fail closed: Android verifiers, not file extensions, establish validity."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60,
                            env={'PATH': os.environ.get('PATH', ''), 'JAVA_HOME': os.environ.get('JAVA_HOME', ''), 'LANG': 'C', 'LC_ALL': 'C'})
    if result.returncode:
        raise ValueError('Artifact verifier failed')
    return result.stdout + result.stderr

def verify(file):
    file = Path(file)
    if file.is_symlink() or not file.is_file() or not file.stat().st_size:
        raise ValueError('Artifact must be a nonempty regular file')
    if file.suffix == '.apk':
        run([os.environ.get('APKSIGNER_PATH', 'apksigner'), 'verify', '--verbose', str(file)])
    elif file.suffix == '.aab':
        with zipfile.ZipFile(file) as z:
            names = z.namelist()
            if 'BundleConfig.pb' not in names or not any(n.endswith('/manifest/AndroidManifest.xml') for n in names):
                raise ValueError('Invalid Android App Bundle structure')
            if not any(n.upper().startswith('META-INF/') and n.upper().endswith(('.RSA', '.DSA', '.EC')) for n in names):
                raise ValueError('Unsigned AAB')
        output = run(['jarsigner', '-J-Duser.language=en', '-verify', '-verbose', str(file)])
        if 'jar verified.' not in output or 'unsigned entries' in output.lower() or 'jar is unsigned' in output.lower():
            raise ValueError('AAB JAR signature verification failed')
        bundletool = os.environ.get('BUNDLETOOL_JAR')
        if not bundletool or not Path(bundletool).is_file():
            raise ValueError('BUNDLETOOL_JAR required')
        run(['java', '-jar', bundletool, 'validate', '--bundle=' + str(file)])
    else:
        raise ValueError('Unsupported artifact format')
    with file.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'name': file.name, 'sha256': digest, 'size': file.stat().st_size, 'verified': True}

if __name__ == '__main__':
    print(json.dumps([verify(p) for p in sys.argv[1:]]))
