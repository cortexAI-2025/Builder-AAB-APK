#!/usr/bin/env python3
"""Validate completely before extracting into a new private directory."""
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

MAX_BYTES = 2 * 1024**3
MAX_FILES = 50000

def extract(archive, target):
    target = Path(target)
    if target.exists() and any(target.iterdir()):
        raise ValueError('Extraction destination must be empty')
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if len(entries) > MAX_FILES:
            raise ValueError('Too many archive entries')
        total, names = 0, set()
        for item in entries:
            name = item.filename
            parts = PurePosixPath(name).parts
            mode = item.external_attr >> 16
            if (not parts or name.startswith('/') or '\\' in name or
                any(p in ('..', '.') for p in name.rstrip('/').split('/')) or
                any(ord(c) < 32 for c in name) or re.match(r'^[A-Za-z]:', name)):
                raise ValueError('Unsafe archive path')
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Links and special files are forbidden')
            canonical = str(PurePosixPath(name))
            if canonical in names:
                raise ValueError('Duplicate archive path')
            names.add(canonical)
            if item.flag_bits & 1:
                raise ValueError('Encrypted entries unsupported')
            total += item.file_size
            if total > MAX_BYTES or item.file_size > max(1, item.compress_size) * 200:
                raise ValueError('Archive size or compression ratio exceeded')
        target.mkdir(parents=True, exist_ok=True, mode=0o700)
        written = 0
        for item in entries:
            dest = target.joinpath(*PurePosixPath(item.filename).parts)
            # Ignore previous outputs/caches, never accept a stale artifact.
            if any(p in ('build', '.gradle', '.git', 'node_modules') for p in PurePosixPath(item.filename).parts):
                continue
            if item.is_dir():
                dest.mkdir(parents=True, exist_ok=True, mode=0o700)
                continue
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with z.open(item) as source, os.fdopen(os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as out:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > MAX_BYTES:
                        raise ValueError('Extracted size exceeded')
                    out.write(chunk)

if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2])
