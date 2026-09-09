# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, 'D:/Projects/AUTO_COURSE')

# 构造假 card 对象（只需要 get_attribute）
class FakeCard:
    def __init__(self, cls):
        self._cls = cls
    def get_attribute(self, attr):
        return self._cls if attr == 'class' else ''

from src.bot.map_course import MapCourseBot

M = MapCourseBot._detect_resource_type

# 教材片段卡片（class 含 video，但文本含"页"）→ 必须是 other
print('教材片段1:', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '1.1 计算机网络产生与发展 已完成'))
print('教材片段2:', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '41页 第1章-计算机网络概述.ppt'))
print('教材片段3:', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '1.5 网络标准化 已完成'))

# 真正视频（含时长）→ 必须是 video
print('视频1:', M(FakeCard('basic-info-video-card-container ZHIHUISHU_QZMD'), '计算机网络定义和分类 00:03:17 0%'))
print('视频2:', M(FakeCard('basic-info-video-card-container'), '计算机网络的发展 00:02:32 0%'))
print('视频3（纯时长）:', M(FakeCard('x'), '视频片段 12:34'))

# 纯文本无时长无页数 → other（保守）
print('文本:', M(FakeCard('basic-info-video-card-container'), '某种纯文本资源'))

