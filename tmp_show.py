# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')
lines = open(r'D:/Projects/AUTO_COURSE/src/bot/map_course.py', encoding='utf-8').read().splitlines()
# 打印 190-300 区域（play/wait/video_info）
for i in range(189, min(300, len(lines))):
    if 'def _play_resource' in lines[i] or 'def _wait_video_done' in lines[i] or 'def _get_video_info' in lines[i] or 'def _resume' in lines[i] or 'def _hold' in lines[i]:
        start = i
        break
for i in range(start, min(320, len(lines))):
    print(i+1, lines[i])

