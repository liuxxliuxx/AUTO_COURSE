import os
import sys


def _get_db_path():
    """Return platform-appropriate database path in user data directory."""
    if sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    elif sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        base = os.environ.get("XDG_DATA_HOME",
                              os.path.join(os.path.expanduser("~"), ".local", "share"))
    path = os.path.join(base, "zhihuishu_auto_course")
    os.makedirs(path, exist_ok=True)
    return os.path.join(path, "course_progress.db")


DB_PATH = _get_db_path()
