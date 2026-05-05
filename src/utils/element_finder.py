"""
通用 WebDriver 元素查找工具。

提供多选择器 fallback 查找，解决同一页面元素在不同版本间
CSS 选择器可能变化的问题——用一个列表依次尝试，找到即返回。
"""

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def find_element(driver, by, values, timeout=10):
    """用多个选择器值依次尝试查找元素，返回第一个匹配的 WebElement。

    Args:
        driver: Selenium WebDriver 实例
        by: 定位方式 (By.CSS_SELECTOR / By.XPATH 等)
        values: 选择器值列表，按优先级排列
        timeout: 每个选择器的等待超时秒数

    Returns:
        找到的 WebElement，全未找到返回 None
    """
    for value in values:
        try:
            el = WebDriverWait(driver, timeout).until(
                EC.presence_of_element_located((by, value))
            )
            return el
        except TimeoutException:
            continue
    return None
