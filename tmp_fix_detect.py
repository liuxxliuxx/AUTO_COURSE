# -*- coding: utf-8 -*-
import io, re
p = r'D:/Projects/AUTO_COURSE/src/bot/map_course.py'
s = io.open(p, encoding='utf-8').read()

# 1. 替换 _detect_resource_type
old_detect = '''    @staticmethod
    def _detect_resource_type(card, text: str) -> str:
        cls = (card.get_attribute("class") or "").lower()
        if "video" in cls:
            return "video"
        if re.search(r"\\d{2}:\\d{2}(:\\d{2})?", text):
            return "video"
        return "other"'''

new_detect = '''    @staticmethod
    def _detect_resource_type(card, text: str) -> str:
        """判断资源类型：视频还是其他（PPT/教材片段/文档等）。

        注意：所有资源卡片容器 class 都叫 basic-info-video-card-container，
        不能仅凭 class 含 video 判断（PPT 也会被误判）。
        可靠判据：文本含时长（mm:ss / h:mm:ss）-> 视频；
                 文本含"页/完成"等 -> 其他（PPT 教材片段）。
        """
        # 1. 文本含时长格式（视频卡片特有）
        if re.search(r"\\d{1,2}:\\d{2}(:\\d{2})?", text):
            return "video"
        # 2. 文本含页数/完成标记（PPT、教材片段）
        if ("页" in text) or ("完成" in text):
            return "other"
        # 3. 回退 class 判断：排除通用卡片样式
        cls = (card.get_attribute("class") or "").lower()
        if "video" in cls and "basic-info" not in cls:
            return "video"
        return "other"'''

assert old_detect in s, 'OLD_DETECT NOT FOUND'
s = s.replace(old_detect, new_detect, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('DETECT FIXED')

