#!/usr/bin/env python3
"""Create an isolated hosted runner for the actual PlayerSurfaceView.

Usage: generate-native.py OUTPUT_DIR HOST_PRODUCTS_DIR VIDEO_MP4 SUBTITLE_SRT
The host must be built with ENABLE_TESTABILITY=YES. No application changes.
"""
from pathlib import Path
import shutil
import subprocess
import sys

if len(sys.argv) != 5:
    raise SystemExit(__doc__)
source = Path(__file__).resolve().parent
subprocess.run([sys.executable, str(source.parent / 'NativePlayback/generate-project.py'), *sys.argv[1:]], check=True)
shutil.copyfile(source / 'FullscreenNativeTests.swift', Path(sys.argv[1]).resolve() / 'NativePlaybackTests.swift')
