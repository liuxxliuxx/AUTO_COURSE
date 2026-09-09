# -*- coding: utf-8 -*-
import io
p = r'D:/Projects/AUTO_COURSE/src/bot/map_course.py'
s = io.open(p, encoding='utf-8').read()

# 1. _get_video_info
old_gi = '''    def _get_video_info(self):
        try:
            return self.driver.execute_script(
                "var v=document.querySelector('video');"
                "if(!v)return {found:false};"
                "return {found:true, current:v.currentTime||0, duration:v.duration||0,"
                " paused:v.paused, ended:!!v.ended};"
            )
        except Exception:
            return {"found": False}'''

new_gi = '''    def _get_video_info(self):
        """读取视频播放状态（限定在播放器容器内，避免误取页面其他 video）。"""
        try:
            return self.driver.execute_script(
                "var host=document.querySelector('#vjs_videoContStudy')"
                "||document.querySelector('.vjs-video-player')"
                "||document.querySelector('.video-js');"
                "var v=host?host.querySelector('video'):null;"
                "if(!v)v=document.querySelector('video');"
                "if(!v)return {found:false};"
                "return {found:true, current:v.currentTime||0, duration:v.duration||0,"
                " paused:v.paused, ended:!!v.ended};"
            )
        except Exception:
            return {"found": False}'''

assert old_gi in s, 'GI NOT FOUND'
s = s.replace(old_gi, new_gi, 1)

# 2. _resume_video
old_rv = '''    def _resume_video(self):
        try:
            play_btn = self.driver.find_elements(
                By.CSS_SELECTOR, ".vjs-big-play-button, .vjs-play-control"
            )'''
new_rv = '''    def _resume_video(self):
        try:
            play_btn = self.driver.find_elements(
                By.CSS_SELECTOR,
                "#vjs_videoContStudy .vjs-big-play-button, "
                "#vjs_videoContStudy .vjs-play-control, "
                "#vjs_videoContStudy video",
            )
            if not play_btn:
                play_btn = self.driver.find_elements(
                    By.CSS_SELECTOR, ".vjs-big-play-button, .vjs-play-control"
                )'''
assert old_rv in s, 'RV NOT FOUND'
s = s.replace(old_rv, new_rv, 1)

# 3. 末尾兜底 play()
old_fb = '            self.driver.execute_script("var v=document.querySelector('video'); if(v)v.play();")'
new_fb = '            self.driver.execute_script(
                "var host=document.querySelector('#vjs_videoContStudy')||document;"
                "var v=host.querySelector('video');if(v)v.play();"
            )'
assert old_fb in s, 'FB NOT FOUND'
s = s.replace(old_fb, new_fb, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('SCOPE FIXED')

