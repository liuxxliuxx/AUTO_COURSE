# AUTO_COURSE 开发手册（组件版）

## 1. 执行链路：`App -> Page -> Event`
系统核心只看这一条：

```text
App.run()
  -> 依次执行每个 Page.run()
    -> Page 创建 ctx(Proxy)
    -> 依次执行 Event.run(ctx)
    -> 若 Event.is_loop=True，则循环 run(ctx) 直到 is_end(ctx)=True
```

你可以把它理解为：
- `App` 管“先后顺序”
- `Page` 管“本页事件编排 + 本页状态”
- `Event` 管“流程决策”
- `ctx(Proxy)` 管“页面动作实现”

---

## 2. App 组件（编排多个页面）
### 必需元素
1. `pages`
- 类型：列表
- 作用：定义页面执行顺序

### 必需方法
1. `run(self)`
- 作用：按顺序调用每个 `page.run()`

### 最小示例
```python
from app.app import App

app = App([login_page, course_page])
app.run()
```

---

## 3. Page 组件（编排本页事件）
### 必需元素
1. `name`
- 页面名称，用于标识

2. `urls`
- 本页可用 URL 列表（可多个）

3. `events`
- 本页事件列表，按顺序执行

4. `proxy_factory`
- 用来创建 `ctx`（代理对象）

5. `state`
- 字典，页面内共享运行态（事件之间传值）

### 必需方法
1. `run(self)`
- 创建 `ctx`
- 调 `ctx.on_page_start(self)`（如果有）
- 执行全部事件
- 调 `ctx.on_page_end(self)`（如果有）

### 最小示例
```python
from page.page import Page
from proxy.course_page_proxy import CoursePageProxy
from events.course.navigate_course_event import NavigateCourseEvent

course_page = Page(
    name="course",
    urls=["https://studyvideoh5.zhihuishu.com/..."],
    events=[NavigateCourseEvent()],
    proxy_factory=CoursePageProxy,
)

course_page.state["bot"] = bot
course_page.state["role"] = "course"
course_page.state["loop_sleep_seconds"] = 1.0
```

---

## 4. Event 组件（流程决策）
### 必需元素
1. `is_loop: bool`
- `False`：执行一次
- `True`：循环执行

### 必需方法
1. `run(self, ctx)`
- 写业务流程/决策逻辑

2. `is_end(self, ctx)`（仅循环事件需要）
- 返回 `True` 结束循环

### 事件内部取值与存值
1. 取配置值（来自 GUI 全局）  
```python
import global_state

gui = global_state.get_gui()
skip = gui.get("skip_completed_courses", True) if gui else True
```

2. 取页面共享状态（Page.state）  
```python
unfinished = ctx.get("unfinished", [])
idx = ctx.get("video_index", 0)
```

3. 存页面共享状态（Page.state）  
```python
ctx.set("video_index", idx + 1)
ctx.set("completed_this_run", ctx.get("completed_this_run", 0) + 1)
```

### 最小示例（一次性）
```python
from events.base_event import IEvent

class InitQueueEvent(IEvent):
    is_loop = False

    def run(self, ctx):
        videos = ctx.extract_videos()
        ctx.set("unfinished", videos)
        ctx.set("video_index", 0)
```

### 最小示例（循环）
```python
from events.base_event import IEvent

class LoopPlayEvent(IEvent):
    is_loop = True

    def run(self, ctx):
        unfinished = ctx.get("unfinished", [])
        idx = ctx.get("video_index", 0)
        if idx < len(unfinished):
            title, item = unfinished[idx]
            ctx.click_video(item, title)
            ctx.set("video_index", idx + 1)

    def is_end(self, ctx):
        return ctx.get("video_index", 0) >= len(ctx.get("unfinished", []))
```

---

## 5. Proxy（ctx）组件（页面动作）
Proxy 是 Event 的动作执行器，Event 不应直接写 Selenium。

### 必需元素
1. `page`
- 当前 page 引用

2. `bot`
- 运行上下文对象（driver、账号等）

### 常用方法（建议）
1. 生命周期
- `on_page_start(page)`
- `on_page_end(page)`

2. 上下文
- `get(key, default)`
- `set(key, value)`
- `wait(seconds)`

3. 页面动作
- `open(url)`
- `extract_videos()`
- `is_finished(item)`
- `click_video(item, title)`
- `monitor_and_wait_for_video(title)`

---

## 6. URL 选择器（`urls` + `select_index`）
当一个 Page 有多个 URL（例如智慧树登录和数字石大登录）时，用 URL 选择器决定打开哪一个。

### 6.1 Page 侧配置
```python
login_page = Page(
    name="login",
    urls=[bot.base_url, "https://i.upc.edu.cn/"],
    events=[...],
    proxy_factory=CoursePageProxy,
)
login_page.state["url_selector"] = LoginURLSelector()
```

### 6.2 选择器协议
支持两种形式：

1. 函数形式  
```python
def selector(urls, ctx) -> int:
    return 0
```

2. 对象方法形式（推荐）  
```python
class LoginURLSelector:
    def select_index(self, urls, ctx) -> int:
        return 0
```

要求：
- 返回值必须是 URL 下标（`0 ~ len(urls)-1`）。
- 返回非法下标时，代理应回退到 `0`。

### 6.3 双登录示例
```python
class LoginURLSelector:
    def select_index(self, urls, ctx) -> int:
        # upc 走第 2 个 URL，其余走第 1 个 URL
        if getattr(ctx.bot, "login_method", "") == "upc":
            return 1 if len(urls) > 1 else 0
        return 0
```

---

## 7. GUI 取值示例（统一入口）
GUI 是全局配置中心，统一通过 `get`：

```python
gui = global_state.get_gui()
username = gui.get("username", "")
password = gui.get("password", "")
video_url = gui.get("video_url", "")
time_limit = gui.get("time_limit_minutes", 0)
skip_completed = gui.get("skip_completed_courses", True)
```

扩展新配置时，只需在 GUI 的 getter 映射里注册新 key。

---

## 8. SQL 取值与写入示例
### 7.1 取值
```python
# 读取设置
limit = db.get_setting("time_limit", "0")

# 读取 URL 历史
logged_list = db.get_url_history("logged")
video_list = db.get_url_history("video")

# 读取已学课程
finished = db.get_finished_courses(video_url)
```

### 7.2 写入
```python
# 写设置
db.set_setting("time_limit", "120")

# 写 URL 历史
db.save_url_history("logged", logged_url)
db.save_url_history("video", video_url, note)

# 写已学课程
db.save_finished_course(video_url, title)
```

---

## 9. 开发时最常见的值流
一个典型值流（跳过已学）：

1. GUI 勾选框保存 `skip_completed_courses`
2. Event 从 `gui.get("skip_completed_courses")` 读取策略
3. Event 调用 `ctx.extract_videos()` 拿全量课程
4. Event 基于 `ctx.is_finished(item)` 过滤并 `ctx.set("unfinished", ...)`
5. 循环 Event 从 `ctx.get("unfinished")` 消费队列

这个模式就是当前推荐的扩展范式。
