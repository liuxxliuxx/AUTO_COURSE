# -*- coding: utf-8 -*-
import sys, ast
sys.stdout.reconfigure(encoding='utf-8')
p = r'D:/Projects/AUTO_COURSE/src/bot/map_course.py'
s = open(p, encoding='utf-8').read()
ast.parse(s)
print('SYNTAX OK')
checks = [
    'NO_VIDEO_MAX_STREAK',
    'ZERO_DURATION_MAX_STREAK',
    'if not info.get("found") or float',
    '("页" in text) or ("完成" in text)',
    'if re.search(r"\d{1,2}:\d{2}(:\d{2})?", text)',
]
for kw in checks:
    print(repr(kw), '->', kw in s)

