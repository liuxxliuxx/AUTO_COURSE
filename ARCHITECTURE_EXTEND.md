# 框架扩展文档（中文）

## 1. 当前架构说明

当前项目采用 `app -> page -> event` 执行链，并通过 `proxy` 传递页面上下文：

1. `main.py` 只做入口，调用 `init_app()` 后执行 `app.run()`。
2. `App.run()` 按顺序运行多个 `Page`。
3. 每个 `Page.run()` 会先创建一个代理对象 `ctx`（由 `proxy_factory` 生成）。
4. `event.run(ctx)` 只操作 `ctx`，不直接操作 `page`。
5. 循环事件通过 `event.is_end(ctx)` 判断是否结束。

这样做的目标是：
- `page` 负责编排和生命周期
- `proxy` 负责 driver/UI 上下文
- `event` 只关注业务动作

---

## 2. 如何新增一个 Page

现在不需要再写 `BasePage` 子类，直接使用通用 `Page`：

```python
from page.page import Page

my_page = Page(
    name="my_page",
    urls=["https://a.example.com", "https://b.example.com"],
    events=[EventA(), EventB()],
    proxy_factory=MyPageProxy,
)

my_page.state["bot"] = bot
my_page.state["role"] = "my_role"
my_page.state["loop_sleep_seconds"] = 1.0
```

参数说明：
- `name`: 页面名称，用于日志和定位。
- `urls`: URL 数组，默认第一个为主 URL。
- `events`: 该页面的事件列表，按顺序执行。
- `proxy_factory`: 代理对象工厂，必须提供。
- `state`: 页面运行时共享状态（字典）。

---

## 3. 如何编写代理对象（Proxy）

代理对象是 `event` 的唯一操作入口。事件拿到的是 `ctx`，不是 `page`。

建议最少提供以下能力：
- `wait(seconds)`
- `get(key, default)` / `set(key, value)`

如果是浏览器页面，建议再提供：
- `driver` 属性
- `open(url)`
- `find(...)` / `click(...)` / `input(...)`
- 可选生命周期钩子：
  - `on_page_start(page)`
  - `on_page_end(page)`

示例位置：
- `proxy/course_page_proxy.py`
- `proxy/gui_callback_proxy.py`

---

## 4. 如何新增事件（Event）

所有事件实现 `IEvent`：

```python
from events.base_event import IEvent

class MyEvent(IEvent):
    is_loop = False

    def run(self, ctx):
        # 只通过 ctx 操作，不直接依赖 page
        pass
```

循环事件：

```python
class MyLoopEvent(IEvent):
    is_loop = True

    def run(self, ctx):
        pass

    def is_end(self, ctx) -> bool:
        return False
```

规则：
- `is_loop=False`：执行一次 `run(ctx)`
- `is_loop=True`：重复执行 `run(ctx)`，每轮后调用 `is_end(ctx)`

---

## 5. 双登录 URL 方案（你当前要求）

登录页支持多个 URL，通过“URL 选择器对象”决定用第几个：

- 在页面里配置：
  - `urls=[普通登录URL, UPC登录URL]`
- 在 `page.state` 注入：
  - `url_selector`
- 在代理中执行选择逻辑：
  - 有 `url_selector` 就按它返回的索引选 URL
  - 无选择器或异常时，默认选 `urls[0]`

已实现位置：
- `proxy/url_selectors.py`（`LoginURLSelector`）
- `proxy/course_page_proxy.py`（`pick_url` 逻辑）
- `app/course_app_factory.py`（登录页注入 `url_selector`）

支持两种选择器形式：
1. 函数：`selector(urls, ctx) -> int`
2. 对象方法：`selector.select_index(urls, ctx) -> int`

---

## 6. 推荐扩展流程

新增一个业务能力时，建议按这个顺序：

1. 先定义 Page（页面边界 + urls + events 顺序）
2. 再定义 Proxy（上下文能力、driver切换、状态读写）
3. 最后实现 Event（纯业务步骤）
4. 在 `app_factory` 里装配并加入 `App` 执行链

这样可以保持低耦合、易替换、易维护。
