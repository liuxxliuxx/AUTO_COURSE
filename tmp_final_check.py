# -*- coding: utf-8 -*-
import sys, ast
sys.stdout.reconfigure(encoding='utf-8')
# 1. 语法检查
for f in [r'D:/Projects/AUTO_COURSE/src/bot/map_course.py']:
    src = open(f, encoding='utf-8').read()
    ast.parse(src)
    print('SYNTAX OK:', f.split('/')[-1], 'lines:', len(src.splitlines()))

# 2. 对比备份与当前（确认重写没丢失功能）
backup = open(r'D:/Projects/AUTO_COURSE/tmp_map_course_backup.py', encoding='utf-8').read()
cur = open(r'D:/Projects/AUTO_COURSE/src/bot/map_course.py', encoding='utf-8').read()

import re
def funcs(s): return set(re.findall(r'def (\w+)', s))
b_f, c_f = funcs(backup), funcs(cur)
print('备份函数:', sorted(b_f))
print('当前函数:', sorted(c_f))
print('缺失:', sorted(b_f - c_f))
print('新增:', sorted(c_f - b_f))

