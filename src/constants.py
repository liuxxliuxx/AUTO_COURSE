"""
项目常量集中管理模块。

将散落在业务代码中的 CSS 选择器、超时值、URL、轮询间隔等
硬编码值统一收拢到此文件，方便平台改版时快速定位修改。
"""

# ============================================================================
# URL 常量
# ============================================================================

# 智慧树在线平台登录页
ZHIHUISHU_BASE_URL = "https://onlineweb.zhihuishu.com/"

# 数字石大 (UPC) 统一认证入口
UPC_BASE_URL = "https://i.upc.edu.cn/"

# UPC SSO 登录后跳转到课程中心的 forward URL
UPC_FORWARD_URL = (
    "https://i.upc.edu.cn/dcp/forward.action"
    "?path=dcp/core/appstore/menu/jsp/redirect"
    "&appid=2c4f8d7e62e94fef93dd2f0c3b87a777&ac=3"
)

# 智慧树登录后默认跳转的课程中心页面（首次使用时预填充）
DEFAULT_LOGGED_URL = (
    "https://hike-teaching-center.polymas.com/"
    "custom-stu-hike/agent-course-hike/ai-course-center"
)

# ============================================================================
# Keyring 配置（用于安全存储账号密码）
# ============================================================================

KEYRING_SERVICE = "zhihuishu_auto_course"
KEYRING_USERNAME_KEY = "zhanghao"
KEYRING_PASSWORD_KEY = "mima"

# ============================================================================
# 智慧树登录页 — CSS 选择器
# ============================================================================

# 手机号登录 Tab
LOGIN_TAB_CSS = ["a.cur[href='#signin']", "#qSignin.cur", "a.cur"]
LOGIN_TAB_XPATH = ["//a[contains(text(),'手机号')]", "//a[@href='#signin']"]

# 用户名/手机号输入框
LOGIN_USERNAME_CSS = [
    "#lUsername",
    'input[name="username"]',
    'input[placeholder*="手机号"]',
]

# 密码输入框
LOGIN_PASSWORD_CSS = [
    "#lPassword",
    'input[name="password"]',
    'input[type="password"]',
]

# 登录按钮（智慧树直接登录）
LOGIN_BTN_CSS = [".wall-sub-btn", "span.wall-sub-btn"]
LOGIN_BTN_XPATH = [
    "//span[contains(@class,'wall-sub-btn')]",
    "//span[contains(text(),'登') and contains(@class,'wall')]",
]

# ============================================================================
# UPC (数字石大) SSO 登录 — CSS 选择器
# ============================================================================

# CAS 登录 iframe（Vant UI 表单嵌套在此 iframe 中）
UPC_LOGIN_IFRAME_CSS = "iframe[src*='login-normal']"

# ============================================================================
# 验证码检测 — 选择器与关键字
# ============================================================================

# iframe src 中可能包含的验证码关键字（用于判定 iframe 是否为验证码 iframe）
CAPTCHA_IFRAME_KEYWORDS = [
    "captcha", "yidun", "turing", "cstaticdun",
    "necaptcha", "verify",
]

# 验证码弹窗元素选择器（检查是否可见且尺寸正常）
CAPTCHA_POPUP_SELECTORS = [
    ".yidun_popup",
    ".yidun_modal",
    ".yidun_popup__content",
    "#tcaptcha_transform_dy",
    "#lPwdError",
]

# 登录页图片验证码输入框
CAPTCHA_IMAGE_INPUT_ID = "j-captcha-mobile"

# ============================================================================
# 课程页面 — 学前必读弹窗
# ============================================================================

PRESCHOOL_DIALOG_CSS = "div.dialog-read"
PRESCHOOL_CLOSE_CSS = [
    ".dialog-read i.iconguanbi",
    ".dialog-read i.iconfont",
    ".dialog-read .el-dialog__header i",
]

# ============================================================================
# 课程视频列表 — 选择器
# ============================================================================

VIDEO_LIST_ITEM_CSS = "li.video"
VIDEO_SMALL_LESSON_CSS = ".small-lesson"
VIDEO_TITLE_CSS = ".catalogue_title"
VIDEO_FINISHED_MARK_CSS = ".time_icofinish"
VIDEO_CURRENT_PLAY_CSS = "li.video.current_play"

# ============================================================================
# 视频播放器 — 选择器
# ============================================================================

# 大播放按钮（多版本兼容）
PLAY_BTN_CSS = [
    ".vjs-big-play-button",
    ".playButton .bigPlayButton",
    "#playButton .bigPlayButton",
]

# 播放控制栏按钮
PLAY_CONTROL_BTN_CSS = "button.vjs-play-control"

# <video> 元素
VIDEO_ELEMENT_CSS = "video"

# ============================================================================
# 弹题测验 (Quiz) — 选择器
# ============================================================================

# 弹题对话框
QUIZ_DIALOG_CSS = 'div.el-dialog[aria-label*="弹题"]'
QUIZ_DIALOG_FALLBACK_CSS = "div.el-dialog"

# 弹题选项
QUIZ_OPTION_CSS = ".topic-item"
QUIZ_OPTION_ACTIVE_CSS = [".topic-option-item.active", ".item-topic.active"]

# 下一题按钮
QUIZ_NEXT_BTN_CSS = ".btn-next"

# 关闭弹题对话框
QUIZ_CLOSE_CSS = [
    ".el-dialog__headerbtn",
    ".el-dialog__close",
    "button[aria-label='Close']",
]

# 弹题底部按钮（xpath）
QUIZ_FOOTER_BTN_XPATH = (
    ".//div[contains(@class,'dialog-footer')]//div[contains(@class,'btn')]"
)
QUIZ_CLOSE_BTN_XPATH = ".//div[@class='btn'][contains(text(),'关闭')]"

# ============================================================================
# 超时与轮询间隔（秒）
# ============================================================================

# 浏览器启动后等待页面加载
PAGE_LOAD_WAIT = 3

# 操作间短等待
SHORT_SLEEP = 0.5
MEDIUM_SLEEP = 1
LONG_SLEEP = 2
EXTRA_LONG_SLEEP = 3

# WebDriverWait 默认超时
WAIT_SHORT = 3       # 快速检测（如 tab 是否已存在）
WAIT_MEDIUM = 5      # 一般等待（如输入框出现）
WAIT_DEFAULT = 10    # 默认超时
WAIT_LONG = 30       # 较长等待（如登录后二次重试）
WAIT_EXTRA_LONG = 60 # 超长等待（如登录跳转）

# 视频监控
VIDEO_MONITOR_MAX_WAIT = 3600   # 单个视频最长等待 60 分钟
VIDEO_MONITOR_CHECK_INTERVAL = 2  # 弹题/状态检查间隔
VIDEO_MONITOR_CAPTCHA_INTERVAL = 30  # 验证码检查间隔（避免高频误报）

# GUI 轮询间隔（毫秒）
GUI_LOG_POLL_MS = 200
GUI_CAPTCHA_POLL_MS = 500

# 验证码等待超时
CAPTCHA_WAIT_TIMEOUT = 300  # 最多等 5 分钟

# 初始弹窗处理最大尝试次数
INITIAL_DIALOG_MAX_ATTEMPTS = 10

# 课程列表项页面标记完成的 CSS class
COURSE_ITEM_FINISHED_CSS = ".time_icofinish"

# 课程重试最大次数
CLICK_VIDEO_MAX_RETRIES = 10

# ============================================================================
# 自动调度器
# ============================================================================

# 调度器轮询间隔（毫秒）
AUTO_SCHEDULER_INTERVAL_MS = 30000
