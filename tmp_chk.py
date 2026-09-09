# -*- coding: utf-8 -*-
import io

content = io.open(r'D:/Projects/AUTO_COURSE/src/bot/map_course.py', encoding='utf-8').read()
print('当前文件行数:', len(content.splitlines()))
print('包含 _get_video_info:', '_get_video_info' in content)
print('包含 _play_resource:', '_play_resource' in content)

