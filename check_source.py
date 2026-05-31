#!/usr/bin/env python3
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'plugins', 'official', 'written_coords_fr'))

from main import _find_candidates
import inspect

print('Source de _find_candidates (premiers 1000 caractères):')
source = inspect.getsource(_find_candidates)
print(source[:1000])
print('\n... (suite)')
print(source[1000:2000])
print('\n... (fin)')
print(source[2000:])
