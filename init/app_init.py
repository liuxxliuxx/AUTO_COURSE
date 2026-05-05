from app.app import App
from events.common.callback_event import CallbackEvent
from global_state import set_globals
from gui.course_gui import CourseGUI
from page.page import Page
from proxy.gui_callback_proxy import GUICallbackProxy
from sql.database import Database


def init_app() -> App:
    db_proxy = Database()
    gui = CourseGUI(db_proxy=db_proxy)
    set_globals(sql=db_proxy, yml={}, gui=gui)

    page = Page(
        name="gui_main",
        urls=["gui://mainloop"],
        events=[CallbackEvent(lambda ctx: gui.run())],
        proxy_factory=GUICallbackProxy,
    )
    page.state["gui"] = gui
    return App([page])
