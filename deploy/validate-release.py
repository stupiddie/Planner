#!/usr/bin/env python3
"""Extract a source-only Git archive into an empty directory without unsafe paths."""
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile


def extract_release(archive_path, destination, revision):
    destination = Path(destination)
    if not destination.is_dir() or any(destination.iterdir()):
        raise ValueError('Destination must be an empty directory')
    with tarfile.open(archive_path, 'r:gz') as archive:
        if archive.pax_headers.get('comment') != revision:
            raise ValueError('Archive commit does not match requested release')
        members, names, total = [], set(), 0
        for member in archive:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or not path.parts
                    or any(ord(c) < 32 for c in member.name)
                    or not (member.isdir() or member.isfile())):
                raise ValueError('Unsafe archive entry')
            name = str(path)
            if name in names:
                raise ValueError('Duplicate archive entry')
            names.add(name)
            if path.parts[0] == '.git' or name in ('server/.env', 'server/node_modules') or name.startswith(('server/.env/', 'server/node_modules/')):
                raise ValueError('Archive contains runtime configuration or dependencies')
            total += member.size
            if len(names) > 10000 or total > 100 * 1024 * 1024:
                raise ValueError('Release exceeds allowed size')
            members.append(member)
        files = {member.name.rstrip('/') for member in members if member.isfile()}
        required = {'index.html', 'server/server.js', 'server/manage.js', 'server/package.json', 'server/package-lock.json'}
        if not required.issubset(files):
            raise ValueError('Incomplete application archive')
        for member in members:
            if any(str(parent) in files for parent in PurePosixPath(member.name).parents if str(parent) != '.'):
                raise ValueError('Conflicting file and directory paths')
        # Validate the complete archive before writing anything. Never extract links or devices.
        for member in members:
            target = destination / str(PurePosixPath(member.name))
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                os.chmod(target, 0o755 if member.mode & 0o111 else 0o644)


if __name__ == '__main__':
    extract_release(*sys.argv[1:])
