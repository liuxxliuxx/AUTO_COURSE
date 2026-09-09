# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Projects/AUTO_COURSE')

class FakeCard:
    def __init__(self, cls): self._cls = cls
    def get_attribute(self, attr): return self._cls if attr == 'class' else ''

from src.bot.map_course import MapCourseBot, parse_map_course_url
M = MapCourseBot._detect_resource_type

cases = [
    ('教材片段-完成', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '1.1 计算机网络产生与发展 已完成'), 'other'),
    ('教材片段-页', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '41页 第1章-计算机网络概述.ppt'), 'other'),
    ('教材片段-已完成', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '1.5 网络标准化 已完成'), 'other'),
    ('视频-时长', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '计算机网络定义和分类 00:03:17 0%'), 'video'),
    ('视频-2分钟', M(FakeCard('basic-info-video-card-container'), '计算机网络的发展 00:02:32 0%'), 'video'),
    ('纯文本', M(FakeCard('basic-info-video-card-container'), '某种纯文本资源'), 'other'),
]
ok = True
for name, got, expect in cases:
    status = 'PASS' if got == expect else 'FAIL'
    if got != expect: ok = False
    print(f'{status}: {name} -> {got} (expect {expect})')

print('----')
print('parse:', parse_map_course_url('https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/2095206238632878080/256522?mapUid=1828621305889558528'))
print('ALL PASS' if ok else 'SOME FAILED')

