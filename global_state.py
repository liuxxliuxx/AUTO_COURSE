"""Process-wide globals for sql/driver/yml/gui resources."""

GLOBAL_SQL = None
GLOBAL_DRIVER = None
GLOBAL_YML = {}
GLOBAL_GUI = None


def set_globals(*, sql=None, driver=None, yml=None, gui=None):
    global GLOBAL_SQL, GLOBAL_DRIVER, GLOBAL_YML, GLOBAL_GUI
    if sql is not None:
        GLOBAL_SQL = sql
    if driver is not None:
        GLOBAL_DRIVER = driver
    if yml is not None:
        GLOBAL_YML = yml
    if gui is not None:
        GLOBAL_GUI = gui


def get_driver():
    return GLOBAL_DRIVER
