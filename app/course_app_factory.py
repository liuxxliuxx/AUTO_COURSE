from app.app import App
from events.course.ensure_login_event import EnsureLoginEvent
from events.course.init_browser_event import InitBrowserEvent
from events.course.navigate_course_event import NavigateCourseEvent
from events.course.report_event import ReportEvent
from events.course.video_playback_loop_event import VideoPlaybackLoopEvent
from page.page import Page
from proxy.course_page_proxy import CoursePageProxy
from proxy.url_selectors import LoginURLSelector


def build_course_app(bot) -> App:
    login_page = Page(
        name="login",
        urls=[bot.base_url, "https://i.upc.edu.cn/"],
        events=[InitBrowserEvent(), EnsureLoginEvent()],
        proxy_factory=CoursePageProxy,
    )
    login_page.state["bot"] = bot
    login_page.state["role"] = "login"
    login_page.state["loop_sleep_seconds"] = 1.0
    login_page.state["url_selector"] = LoginURLSelector()

    course_page = Page(
        name="course",
        urls=[bot.video_url],
        events=[NavigateCourseEvent(), VideoPlaybackLoopEvent(), ReportEvent()],
        proxy_factory=CoursePageProxy,
    )
    course_page.state["bot"] = bot
    course_page.state["role"] = "course"
    course_page.state["loop_sleep_seconds"] = 1.0

    return App([login_page, course_page])
