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

/**
 * 智慧树登录入口。
 *
 * 2026-09 改版：登录搬到了独立的「登录中心」（Element UI 单页应用），
 * 老的 `onlineweb.zhihuishu.com` 上只剩一个隐藏在弹窗里、不可见的表单 ——
 * 旧选择器在那儿永远找不到可见输入框，登录流程直接失败。
 * 课程页未登录时也是被重定向到这里（`?origin=zhs&service=...`）。
 */
export const ZHIHUISHU_LOGIN_URL = 'https://login.zhihuishu.com/'

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

/**
 * 登录方式标签页。
 *
 * 新版登录中心是 Element UI 的 tabs（账号登录 / 学号登录 / 工号登录 / 扫码），
 * 默认停在「账号登录」；旧版的 `a.cur` 那套留着兜底。
 */
export const LOGIN_TAB_CSS = ['.el-tabs__item', 'a.cur[href="#signin"]', '#qSignin.cur', 'a.cur']
export const LOGIN_TAB_XPATH = [
  "//div[contains(@class,'el-tabs__item')][contains(text(),'账号登录')]",
  "//div[contains(@class,'el-tabs__item')][contains(text(),'密码登录')]",
  "//a[contains(text(),'手机号')]",
  "//a[@href='#signin']"
]

export const LOGIN_USERNAME_CSS = [
  'input[name="mobile"]',
  'input[placeholder*="手机号"]',
  'input[placeholder*="用户名"]',
  '#lUsername',
  'input[name="username"]'
]

export const LOGIN_PASSWORD_CSS = [
  'input[type="password"]',
  'input[placeholder*="密码"]',
  '#lPassword',
  'input[name="password"]'
]

export const LOGIN_BTN_CSS = [
  '[class*="btn-block__grandient_login"]',
  '.wall-sub-btn',
  'span.wall-sub-btn'
]
export const LOGIN_BTN_XPATH = [
  "//div[contains(@class,'base-button-component')][contains(text(),'登录')]",
  "//span[contains(@class,'wall-sub-btn')]",
  "//span[contains(text(),'登') and contains(@class,'wall')]"
]

/** 账号密码登录的最大尝试次数（失败就重来一遍，而不是直接停） */
export const LOGIN_MAX_ATTEMPTS = 3

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

/** Optional information cards only; question/captcha controls belong to their own handlers. */
export const COURSE_INFO_MARKERS = [
  '欢迎', '学习时间', '考试时间', '考核比',
  ...LEARNING_PROGRESS_POPUP_KEYWORDS
]
export const COURSE_INFO_CLOSE_CSS = [
  '[aria-label="关闭"]', '[aria-label="Close" i]', '[title="关闭"]',
  '[class*="close" i]', '[class*="guanbi" i]', '.el-dialog__headerbtn',
  'button', '[role="button"]', 'i', 'svg', 'span', 'div'
]
export const COURSE_INFO_PROTECTED_CSS = [
  'video', 'li.video', '.yidun_popup', '.yidun_modal', '[class*="captcha" i]',
  'iframe', '[aria-label*="弹题"]', '.topic-item', '.topic-option-item',
  'input', 'textarea', 'select'
]
export const COURSE_CLICK_PROBE_MS = 3_000

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

/**
 * 播放控制的探测预算（毫秒）。
 *
 * 预算是**整个策略**共享的：v1 的 4 级策略逐个选择器各等一个超时，
 * 播放器按钮在暂停/播放之间又会来回显隐，于是"恢复播放"要等十几秒。
 * 这里改成"预算内轮询、命中即返回"：按钮已经在就毫秒级返回，
 * 没渲染完也只在预算内等。
 */
export const PLAY_PROBE = {
  /** 大播放按钮 */
  bigButton: 1_200,
  /** 控制栏播放按钮 */
  control: 800,
  /** 点击 video 本体前等它可见 */
  videoElement: 600,
  /** 单次点击的超时（被遮罩时走坐标点击，不会真的等满） */
  click: 1_500,
  /** 点击后等"进入播放态"的上限（自适应轮询，命中即返回） */
  playing: 1_200,
  /** 原生 play() 后等播放态（一般立刻就好） */
  nativeResume: 600,
  /** 轮询间隔 */
  pollMs: 120
} as const

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
