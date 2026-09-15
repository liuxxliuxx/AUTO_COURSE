/**
 * 自动化层常量 —— 对应 v1 `src/constants.py`。
 *
 * 平台改版时只需要改这一个文件。
 *
 * 选择器一律用**多候选数组**：v1 的做法就是依次尝试，
 * 实测（docs/PLAYWRIGHT_POC.md §2.2）智慧树登录页的 `#lUsername` 已经不在页面上，
 * 靠后面的候选才命中 —— 所以这个策略必须保留，不能精简成单个选择器。
 */

// ============================================================================
// URL
// ============================================================================

export const ZHIHUISHU_BASE_URL = 'https://onlineweb.zhihuishu.com/'

export const UPC_BASE_URL = 'https://i.upc.edu.cn/'

export const UPC_FORWARD_URL =
  'https://i.upc.edu.cn/dcp/forward.action' +
  '?path=dcp/core/appstore/menu/jsp/redirect' +
  '&appid=2c4f8d7e62e94fef93dd2f0c3b87a777&ac=3'

/** 首次使用时预填充的课程中心地址 */
export const DEFAULT_LOGGED_URL =
  'https://hike-teaching-center.polymas.com/custom-stu-hike/agent-course-hike/ai-course-center'

// ============================================================================
// 智慧树登录页
// ============================================================================

export const LOGIN_TAB_CSS = ['a.cur[href="#signin"]', '#qSignin.cur', 'a.cur']
export const LOGIN_TAB_XPATH = ["//a[contains(text(),'手机号')]", "//a[@href='#signin']"]

export const LOGIN_USERNAME_CSS = [
  '#lUsername',
  'input[name="username"]',
  'input[placeholder*="手机号"]'
]

export const LOGIN_PASSWORD_CSS = ['#lPassword', 'input[name="password"]', 'input[type="password"]']

export const LOGIN_BTN_CSS = ['.wall-sub-btn', 'span.wall-sub-btn']
export const LOGIN_BTN_XPATH = [
  "//span[contains(@class,'wall-sub-btn')]",
  "//span[contains(text(),'登') and contains(@class,'wall')]"
]

// ============================================================================
// UPC（数字石大）SSO
// ============================================================================

/** CAS 登录 iframe（Vant UI 表单嵌在里面） */
export const UPC_LOGIN_IFRAME_CSS = "iframe[src*='login-normal']"

// ============================================================================
// 验证码
// ============================================================================

/** iframe src 里出现任一关键字即判定为验证码 iframe */
export const CAPTCHA_IFRAME_KEYWORDS = [
  'captcha',
  'yidun',
  'turing',
  'cstaticdun',
  'necaptcha',
  'verify'
]

export const CAPTCHA_POPUP_SELECTORS = [
  '.yidun_popup',
  '.yidun_modal',
  '.yidun_popup__content',
  '#tcaptcha_transform_dy',
  '#lPwdError'
]

export const CAPTCHA_IMAGE_INPUT_ID = 'j-captcha-mobile'

// ============================================================================
// 课程页弹窗
// ============================================================================

export const PRESCHOOL_DIALOG_CSS = 'div.dialog-read'
export const PRESCHOOL_CLOSE_CSS = [
  '.dialog-read i.iconguanbi',
  '.dialog-read i.iconfont',
  '.dialog-read .el-dialog__header i'
]

export const LEARNING_PROGRESS_POPUP_CSS = ['.ss2077-msg-custom', '.ss2077-msg-bg']
export const LEARNING_PROGRESS_POPUP_KEYWORDS = [
  '当前时间计划学习进度',
  '学习进度',
  '班级平均学习进度'
]

// ============================================================================
// 课程视频列表
// ============================================================================

export const VIDEO_LIST_ITEM_CSS = 'li.video'
export const VIDEO_SMALL_LESSON_CSS = '.small-lesson'
export const VIDEO_TITLE_CSS = '.catalogue_title'
export const VIDEO_FINISHED_MARK_CSS = '.time_icofinish'
export const VIDEO_CURRENT_PLAY_CSS = 'li.video.current_play'

// ============================================================================
// 视频播放器
// ============================================================================

export const PLAY_BTN_CSS = [
  '.vjs-big-play-button',
  '.playButton .bigPlayButton',
  '#playButton .bigPlayButton'
]

export const PLAY_CONTROL_BTN_CSS = 'button.vjs-play-control'
export const VIDEO_ELEMENT_CSS = 'video'

// ============================================================================
// 弹题
// ============================================================================

export const QUIZ_DIALOG_CSS = 'div.el-dialog[aria-label*="弹题"]'
export const QUIZ_DIALOG_FALLBACK_CSS = 'div.el-dialog'
export const QUIZ_OPTION_CSS = '.topic-item'
export const QUIZ_OPTION_ACTIVE_CSS = ['.topic-option-item.active', '.item-topic.active']
export const QUIZ_NEXT_BTN_CSS = '.btn-next'
export const QUIZ_CLOSE_CSS = [
  '.el-dialog__headerbtn',
  '.el-dialog__close',
  "button[aria-label='Close']"
]
export const QUIZ_FOOTER_BTN_XPATH =
  ".//div[contains(@class,'dialog-footer')]//div[contains(@class,'btn')]"
export const QUIZ_CLOSE_BTN_XPATH = ".//div[@class='btn'][contains(text(),'关闭')]"

// ============================================================================
// 超时与轮询（毫秒）
// ============================================================================

export const TIMEOUT = {
  /** 快速探测（例如判断某个元素是不是已经在了） */
  short: 3_000,
  /** 一般等待（输入框出现等） */
  medium: 5_000,
  default: 10_000,
  /** 较长等待（登录后二次重试） */
  long: 30_000,
  /** 超长等待（登录跳转） */
  extraLong: 60_000,
  /** 单个视频最长监控：60 分钟 */
  videoMonitorMax: 60 * 60 * 1000
} as const

/** 轮询间隔 */
export const INTERVAL = {
  /** 视频监控循环 */
  videoMonitor: 2_000,
  /** 验证码检查（低频，避免误报） */
  captcha: 30_000,
  /** 自动暂停检测 */
  autoplayGuard: 10_000,
  /** 进度日志 */
  progressLog: 30_000
} as const

/**
 * 固定等待。
 *
 * v1 大量依赖 `time.sleep` 来"等页面稳下来"。
 * v2 能用 Playwright 的 auto-wait 就不该再用固定等待，
 * 但以下几处保留是为了**行为等价**，等端到端验证后再逐步清理。
 */
export const SLEEP = {
  short: 500,
  medium: 1_000,
  long: 2_000,
  extraLong: 3_000,
  pageLoad: 3_000
} as const

/** 初始弹窗交叉检测的最大轮数 */
export const INITIAL_DIALOG_MAX_ATTEMPTS = 10

/** 点击视频失败后的最大重试次数 */
export const CLICK_VIDEO_MAX_RETRIES = 10

/** 验证码等待用户处理的上限：5 分钟 */
export const CAPTCHA_WAIT_TIMEOUT = 300_000

/** 视频 src 提取脚本（与 v1 逐字一致） */
export const VIDEO_SRC_EXTRACTION_JS = `
  var v = document.querySelector('video');
  if (!v) return '';
  var src = v.src || v.currentSrc || '';
  if (src.startsWith('blob:')) {
    var sources = v.querySelectorAll('source');
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].src && !sources[i].src.startsWith('blob:')) return sources[i].src;
    }
    return '';
  }
  return src;
`
