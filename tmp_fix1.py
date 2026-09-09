# -*- coding: utf-8 -*-
import io
p = r'D:/Projects/AUTO_COURSE/src/bot/map_course.py'
s = io.open(p, encoding='utf-8').read()

# 1. 常量：在 VIDEO_MAX_WAIT 后插入兜底常量
old_const = 'VIDEO_MAX_WAIT = 3600 * 3'
new_const = '''VIDEO_MAX_WAIT = 3600 * 3

# 视频监控兜底：连续 N 次（每次 3s）找不到视频元素或 duration<=0 视为异常退出
NO_VIDEO_MAX_STREAK = 20
ZERO_DURATION_MAX_STREAK = 20'''

assert old_const in s, 'CONST NOT FOUND2'
s = s.replace(old_const, new_const, 1)

# 2. 替换 _play_resource
old_play = '''        if res["type"] == "video":
            self._wait_video_done(title)
        else:
            self._hold_non_video(title)'''

new_play = '''        if res["type"] == "video":
            # 打开后验证：必须出现真实可播的视频（duration>0），否则按非视频处理
            time.sleep(LONG_SLEEP)
            info = self._get_video_info()
            if not info.get("found") or float(info.get("duration", 0)) <= 0:
                logger.warning("资源未出现真实视频（可能被误判），按非视频处理: %s", title)
                self._hold_non_video(title)
                return
            self._wait_video_done(title)
        else:
            self._hold_non_video(title)'''

assert old_play in s, 'PLAY NOT FOUND2'
s = s.replace(old_play, new_play, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('PART1 DONE')

