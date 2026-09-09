# -*- coding: utf-8 -*-
import io
p = r'D:/Projects/AUTO_COURSE/src/bot/map_course.py'
s = io.open(p, encoding='utf-8').read()

# 确认常量已插入
assert 'NO_VIDEO_MAX_STREAK' in s, 'const missing'
assert 'duration <= 0' in s or 'duration", 0)) <= 0' in s, 'play guard missing'

# 替换 _wait_video_done 主体（用 while 循环起始标记到返回前，精确锚定）
old_wait = '''        logger.info("视频播放监控开始: %s", title)
        elapsed = 0
        last_playing = 0
        last_log = 0
        cur = 0
        dur = 0
        while elapsed < VIDEO_MAX_WAIT:
            if self._should_stop():
                logger.info("停止信号，退出视频监控: %s", title)
                return
            info = self._get_video_info()
            if info.get("found"):
                cur = float(info.get("current", 0))
                dur = float(info.get("duration", 0))
                paused = bool(info.get("paused"))
                ended = bool(info.get("ended"))
                if ended or (dur > 0 and cur >= dur - 1):
                    logger.info("视频播放完毕: %s (%.0f/%.0fs)", title, cur, dur)
                    return
                if paused:
                    if elapsed - last_playing > 30:
                        logger.info("视频暂停 %ds，尝试恢复播放: %s", elapsed, title)
                        self._resume_video()
                        last_playing = elapsed
                else:
                    last_playing = elapsed
            else:
                logger.debug("未找到 video 元素")
            if elapsed - last_log >= 60:
                last_log = elapsed
                logger.info("视频进度: %.0f/%.0fs (%s)", cur, dur, title)
            time.sleep(VIDEO_CHECK_INTERVAL)
            elapsed += VIDEO_CHECK_INTERVAL
        logger.warning("视频监控超时: %s", title)'''

new_wait = '''        logger.info("视频播放监控开始: %s", title)
        elapsed = 0
        last_playing = 0
        last_log = 0
        no_video_streak = 0
        zero_duration_streak = 0
        cur = 0
        dur = 0
        while elapsed < VIDEO_MAX_WAIT:
            if self._should_stop():
                logger.info("停止信号，退出视频监控: %s", title)
                return
            info = self._get_video_info()
            if info.get("found"):
                cur = float(info.get("current", 0))
                dur = float(info.get("duration", 0))
                paused = bool(info.get("paused"))
                ended = bool(info.get("ended"))
                no_video_streak = 0
                if dur <= 0:
                    zero_duration_streak += 1
                    if zero_duration_streak >= ZERO_DURATION_MAX_STREAK:
                        logger.warning("视频时长异常(0s)持续 %d 次，退出监控: %s", zero_duration_streak, title)
                        return
                else:
                    zero_duration_streak = 0
                if ended or (dur > 0 and cur >= dur - 1):
                    logger.info("视频播放完毕: %s (%.0f/%.0fs)", title, cur, dur)
                    return
                if paused:
                    if elapsed - last_playing > 30:
                        logger.info("视频暂停 %ds，尝试恢复播放: %s", elapsed, title)
                        self._resume_video()
                        last_playing = elapsed
                else:
                    last_playing = elapsed
            else:
                no_video_streak += 1
                if no_video_streak >= NO_VIDEO_MAX_STREAK:
                    logger.warning("未找到视频元素持续 %d 次，退出监控: %s", no_video_streak, title)
                    return
                logger.debug("未找到 video 元素")
            if elapsed - last_log >= 60:
                last_log = elapsed
                logger.info("视频进度: %.0f/%.0fs (%s)", cur, dur, title)
            time.sleep(VIDEO_CHECK_INTERVAL)
            elapsed += VIDEO_CHECK_INTERVAL
        logger.warning("视频监控超时: %s", title)'''

assert old_wait in s, 'WAIT NOT FOUND'
s = s.replace(old_wait, new_wait, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('WAIT FIXED')

