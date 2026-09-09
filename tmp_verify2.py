# -*- coding: utf-8 -*-
import sys, ast
sys.stdout.reconfigure(encoding='utf-8')
p = r'D:/Projects/AUTO_COURSE/src/bot/map_course.py'
s = open(p, encoding='utf-8').read()
ast.parse(s)
print('SYNTAX OK, lines:', len(s.splitlines()))
checks = {
    'NO_VIDEO_MAX_STREAK': 'NO_VIDEO_MAX_STREAK' in s,
    'ZERO_DURATION_MAX_STREAK': 'ZERO_DURATION_MAX_STREAK' in s,
    'play_guard': 'if not info.get("found") or float' in s,
    'detect_duration_regex': '\\d{1,2}:\\d{2}' in s,
    'detect_page_mark': '("页" in text) or ("完成" in text)' in s,
    'scoped_video_query': "document.querySelector('#vjs_videoContStudy')" in s,
    'resume_scoped': '#vjs_videoContStudy .vjs-big-play-button' in s,
    'id_selector': "[id*='knowledgeId-']" in s,
}
for k, v in checks.items():
    print(k, '->', v)

