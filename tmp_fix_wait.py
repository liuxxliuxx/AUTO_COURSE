# -*- coding: utf-8 -*-
import io
p = r'D:/Projects/AUTO_COURSE/src/bot/map_course.py'
s = io.open(p, encoding='utf-8').read()

# 1. 替换 _play_resource：打开后先验证 video 真实存在（防误判视频后无 video 元素卡死）
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

assert old_play in s, 'PLAY NOT FOUND'
s = s.replace(old_play, new_play, 1)

# 2. 替换 _wait_video_done：加 duration/无视频 兜底超时
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
        no_video_streak = 0          # 连续找不到 video 的次数
        zero_duration_streak = 0     # 连续 duration<=0 的次数
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

# 3. 增加常量（在 VIDEO_CHECK_INTERVAL 附近）
old_const = '''# 视频监控间隔
VIDEO_CHECK_INTERVAL = 3'''
new_const = '''# 视频监控间隔
VIDEO_CHECK_INTERVAL = 3

# 视频监控兜底：连续 N 次（每次 3s）找不到视频元素或 duration<=0 视为异常退出
NO_VIDEO_MAX_STREAK = 20
ZERO_DURATION_MAX_STREAK = 20'''

assert old_const in s, 'CONST NOT FOUND'
s = s.replace(old_const, new_const, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('WAIT FIXED')

