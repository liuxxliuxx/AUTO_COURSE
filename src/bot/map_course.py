"""
图谱课刷课模块 —— AI 新形态课程（知识图谱）自动学习。

针对 ai-smart-course-student-pro.zhihuishu.com 的新形态课程：
- 解析知识图谱页（模块 -> 知识单元 -> 知识项 -> 学习进度）
- 进入每个知识项的学习页，识别必学资源（忽略选学资源）
- 视频资源：完整播放到结束；非视频资源（PPT/教材片段等）：停留约 5 秒退出
- 全部遍历直到所有知识项学习进度 100%

注意（2026-09 实测修正）：
- 图谱页知识项是 id="knowledgeId-XXX"，不是 class
- 所有资源卡片容器 class 都是 basic-info-video-card-container（含 PPT），
  所以不能仅凭 class 含 "video" 判断类型，必须看文本时长特征
- 视频播放器容器 #vjs_videoContStudy，取 video 必须限定在其中，
  避免误取页面其他 video（广告/装饰动画）导致卡死
"""

import logging
import re
import time

from selenium.webdriver.common.by import By

from src.constants import (
    MEDIUM_SLEEP,
    LONG_SLEEP,
    EXTRA_LONG_SLEEP,
)

logger = logging.getLogger(__name__)

# ============================================================================
# 常量
# ============================================================================

# 非视频资源停留秒数
NON_VIDEO_HOLD_SECONDS = 5

# 视频监控间隔（秒）
VIDEO_CHECK_INTERVAL = 3

# 单视频最长监控（秒），超时视为完成失败
VIDEO_MAX_WAIT = 3600 * 3

# 视频监控兜底：连续 N 次（每次 3s）找不到视频元素或 duration<=0 视为异常退出
NO_VIDEO_MAX_STREAK = 20
ZERO_DURATION_MAX_STREAK = 20

# 学习页 URL 模板
KNOWLEDGE_STUDY_URL_TMPL = (
    "https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/"
    "knowledgeStudy/{course_id}/{map_id}?mapUid={map_uid}"
)
LEARN_PAGE_URL_TMPL = (
    "https://ai-smart-course-student-pro.zhihuishu.com/learnPage/"
    "{course_id}/{knowledge_id}/{map_id}?mapUid={map_uid}"
)

# ============================================================================
# 选择器
# ============================================================================

# 图谱页：知识项容器（id 为 knowledgeId-XXX）
MAP_ITEM_CSS = "[id*='knowledgeId-']"

# 学习进度文本（"学习进度  100 %"）
PROGRESS_TEXT_REGEX = re.compile(r"(\d+)\s*%")

# 学习页：资源分区
RESOURCE_SECTION_CSS = ".resources-section"
RESOURCE_TITLE_CSS = ".resources-detail-title"
RESOURCE_CARD_CSS = (
    ".basic-info-video-card-container, "
    ".resources-list > *, "
    ".resources-list [class*='item']"
)

# 卡片中的"已完成"标记
DONE_TEXT = "已完成"

# 视频播放器容器（限定作用域，避免误取其他 video）
VIDEO_PLAYER_CONTAINER_CSS = (
    "#vjs_videoContStudy, .vjs-video-player, .video-js"
)


class MapCourseBot:
    """AI 新形态课程（图谱课）自动刷课。"""

    def __init__(self, driver, stop_event=None):
        self.driver = driver
        self.stop_event = stop_event
        self.course_id = ""
        self.map_id = ""
        self.map_uid = ""

    # ========================================================================
    # 对外入口
    # ========================================================================

    def run(self, course_url: str, skip_completed: bool = True):
        """解析图谱页并遍历所有知识项直到全部完成。

        Returns:
            (completed_items, total_items)
        """
        self._parse_url(course_url)
        logger.info("图谱课刷课开始: %s", course_url)

        items = self._get_knowledge_items()
        if not items:
            logger.warning("未解析到知识项，请检查页面结构")
            return 0, 0

        total = len(items)
        done = 0
        for index, item in enumerate(items):
            if self._should_stop():
                logger.info("收到停止信号，图谱刷课停止")
                break

            title, knowledge_id, progress = item
            if skip_completed and progress >= 100:
                logger.info("跳过已完成: %s (%d%%)", title, progress)
                done += 1
                continue

            logger.info(
                "==== [%d/%d] 处理知识项: %s (进度 %d%%) ====",
                index + 1, total, title, progress,
            )
            try:
                self._process_knowledge_item(title, knowledge_id)
                done += 1
            except Exception as e:
                logger.error("处理知识项失败 '%s': %s", title, e, exc_info=True)

        logger.info("图谱刷课结束: 完成 %d/%d", done, total)
        return done, total

    # ========================================================================
    # 图谱页解析
    # ========================================================================

    def _parse_url(self, course_url: str):
        """从课程 URL 解析 course_id / map_id / map_uid。"""
        m = re.search(r"knowledgeStudy/(\d+)/(\d+)", course_url)
        if not m:
            m = re.search(r"learnPage/(\d+)/(\d+)", course_url)
        if not m:
            raise ValueError("无法从 URL 解析课程ID: %s" % course_url)
        self.course_id = m.group(1)
        self.map_id = m.group(2)
        mu = re.search(r"mapUid=([^&]+)", course_url)
        self.map_uid = mu.group(1) if mu else ""

    def _get_knowledge_items(self):
        """解析图谱页所有知识项。

        Returns:
            [(title, knowledge_id, progress), ...]
        """
        url = KNOWLEDGE_STUDY_URL_TMPL.format(
            course_id=self.course_id, map_id=self.map_id, map_uid=self.map_uid
        )
        self.driver.get(url)
        time.sleep(EXTRA_LONG_SLEEP)

        try:
            items_el = self.driver.find_elements(By.CSS_SELECTOR, MAP_ITEM_CSS)
        except Exception:
            logger.warning("图谱页未找到知识项容器")
            return []

        results = []
        for el in items_el:
            try:
                text = (el.text or "").replace("\n", " ")
                title = self._extract_title(text)
                knowledge_id = self._extract_knowledge_id(el)
                progress = self._extract_progress(text)
                if title and knowledge_id:
                    results.append((title, knowledge_id, progress))
                    logger.info("知识项: %s | %s | %d%%", title, knowledge_id, progress)
            except Exception as e:
                logger.debug("解析知识项失败: %s", e)
        return results

    @staticmethod
    def _extract_title(text: str) -> str:
        """从知识项文本提取标题（去掉'学习进度 X%'部分）。"""
        text = text.replace("学习进度", "").strip()
        return PROGRESS_TEXT_REGEX.sub("", text).strip()

    @staticmethod
    def _extract_knowledge_id(el):
        """从元素 id 中提取 knowledgeId-XXX。"""
        el_id = el.get_attribute("id") or ""
        m = re.search(r"knowledgeId-(\d+)", el_id)
        return m.group(1) if m else ""

    @staticmethod
    def _extract_progress(text: str) -> int:
        """提取学习进度百分比。"""
        m = re.search(r"(\d{1,3})\s*%", text)
        return int(m.group(1)) if m else 0

    # ========================================================================
    # 知识项学习
    # ========================================================================

    def _process_knowledge_item(self, title: str, knowledge_id: str):
        """进入知识项学习页，处理其中所有必学资源。"""
        learn_url = LEARN_PAGE_URL_TMPL.format(
            course_id=self.course_id,
            knowledge_id=knowledge_id,
            map_id=self.map_id,
            map_uid=self.map_uid,
        )
        logger.info("进入学习页: %s", learn_url)
        self.driver.get(learn_url)
        time.sleep(EXTRA_LONG_SLEEP)

        resources = self._get_must_learn_resources()
        if not resources:
            logger.info("知识项 '%s' 无必学资源", title)
            return

        for res in resources:
            if self._should_stop():
                return
            self._play_resource(title, res)

    def _get_must_learn_resources(self):
        """解析当前学习页的必学资源列表。

        Returns:
            [{'title': str, 'type': 'video'|'other', 'done': bool, 'el': WebElement}, ...]
        """
        sections = self.driver.find_elements(By.CSS_SELECTOR, RESOURCE_SECTION_CSS)
        resources = []
        for section in sections:
            try:
                title_el = section.find_element(By.CSS_SELECTOR, RESOURCE_TITLE_CSS)
                section_title = title_el.text.strip()
            except Exception:
                section_title = ""
            if "必学" not in section_title:
                continue

            cards = section.find_elements(By.CSS_SELECTOR, RESOURCE_CARD_CSS)
            for card in cards:
                try:
                    text = (card.text or "").replace("\n", " ")
                    if not text.strip():
                        continue
                    res = {
                        "title": text,
                        "type": self._detect_resource_type(card, text),
                        "done": DONE_TEXT in text,
                        "el": card,
                    }
                    if res["title"]:
                        resources.append(res)
                        logger.info(
                            "必学资源: %s | type=%s | done=%s",
                            res["title"], res["type"], res["done"],
                        )
                except Exception:
                    continue
        return resources

    @staticmethod
    def _detect_resource_type(card, text: str) -> str:
        """判断资源类型：视频还是其他（PPT/教材片段/文档等）。

        注意：所有资源卡片容器 class 都叫 basic-info-video-card-container，
        不能仅凭 class 含 video 判断（PPT 也会被误判为视频）。
        可靠判据（按优先级）：
        1. 文本含时长（mm:ss / h:mm:ss）-> 视频
        2. 文本含"页"或"完成" -> 其他（PPT 教材片段）
        3. 回退 class 判断（排除通用卡片样式）
        """
        # 1. 文本含时长格式（视频卡片特有）
        if re.search(r"\d{1,2}:\d{2}(:\d{2})?", text):
            return "video"
        # 2. 文本含页数/完成标记（PPT、教材片段）
        if ("页" in text) or ("完成" in text):
            return "other"
        # 3. 回退 class 判断：排除通用卡片样式
        cls = (card.get_attribute("class") or "").lower()
        if "video" in cls and "basic-info" not in cls:
            return "video"
        return "other"

    def _play_resource(self, knowledge_title: str, res: dict):
        """打开并处理单个必学资源。"""
        title = res["title"]
        logger.info("开始处理资源: %s", title)
        try:
            self.driver.execute_script("arguments[0].click();", res["el"])
            time.sleep(EXTRA_LONG_SLEEP)
        except Exception as e:
            logger.error("打开资源失败: %s", e)
            return

        if res["type"] == "video":
            # 打开后验证：必须出现真实可播的视频（duration>0），否则按非视频处理
            time.sleep(LONG_SLEEP)
            info = self._get_video_info()
            if not info.get("found") or float(info.get("duration", 0)) <= 0:
                logger.warning(
                    "资源未出现真实视频（可能被误判），按非视频处理: %s", title
                )
                self._hold_non_video(title)
                return
            self._wait_video_done(title)
        else:
            self._hold_non_video(title)

    def _hold_non_video(self, title: str):
        """非视频资源：停留约 5 秒后退出。"""
        logger.info("非视频资源停留 %ds: %s", NON_VIDEO_HOLD_SECONDS, title)
        time.sleep(NON_VIDEO_HOLD_SECONDS)

    def _wait_video_done(self, title: str):
        """监控视频播放直到结束，带兜底防卡死。"""
        logger.info("视频播放监控开始: %s", title)
        elapsed = 0
        last_playing = 0
        last_log = 0
        no_video_streak = 0          # 连续找不到视频的次数
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
                        logger.warning(
                            "视频时长异常(0s)持续 %d 次，退出监控: %s",
                            zero_duration_streak, title,
                        )
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
                    logger.warning(
                        "未找到视频元素持续 %d 次，退出监控: %s",
                        no_video_streak, title,
                    )
                    return
                logger.debug("未找到 video 元素")

            if elapsed - last_log >= 60:
                last_log = elapsed
                logger.info("视频进度: %.0f/%.0fs (%s)", cur, dur, title)

            time.sleep(VIDEO_CHECK_INTERVAL)
            elapsed += VIDEO_CHECK_INTERVAL

        logger.warning("视频监控超时: %s", title)

    def _get_video_info(self):
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
            return {"found": False}

    def _resume_video(self):
        """尝试恢复视频播放（优先播放器容器内的按钮/元素）。"""
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
                )
            if play_btn:
                for btn in play_btn:
                    try:
                        self.driver.execute_script("arguments[0].click();", btn)
                        time.sleep(MEDIUM_SLEEP)
                        info = self._get_video_info()
                        if info.get("found") and not info.get("paused"):
                            return
                    except Exception:
                        continue
            self.driver.execute_script(
                "var host=document.querySelector('#vjs_videoContStudy')||document;"
                "var v=host.querySelector('video');if(v)v.play();"
            )
        except Exception:
            pass

    def _should_stop(self):
        """外部停止信号。"""
        try:
            if self.stop_event is None:
                return False
            if callable(self.stop_event):
                return bool(self.stop_event())
            return bool(self.stop_event.is_set())
        except Exception:
            return False


def parse_map_course_url(url: str):
    """工具函数：从图谱课 URL 提取 course_id / map_id / map_uid。"""
    m = re.search(r"knowledgeStudy/(\d+)/(\d+)", url)
    if not m:
        raise ValueError("无效的图谱课 URL: %s" % url)
    map_uid = ""
    mu = re.search(r"mapUid=([^&]+)", url)
    if mu:
        map_uid = mu.group(1)
    return {"course_id": m.group(1), "map_id": m.group(2), "map_uid": map_uid}

