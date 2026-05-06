"""
Chrome for Testing 下载脚本。

从 Google 官方源下载指定版本（或最新稳定版）的 Chrome 和 ChromeDriver，
解压到项目的 bin/ 目录供打包使用。

用法：
    python scripts/download_chrome.py              # 下载最新稳定版
    python scripts/download_chrome.py --version 120.0.6099.109  # 下载指定版本
"""

import argparse
import json
import os
import shutil
import sys
import urllib.request
import zipfile

# Chrome for Testing 版本查询 API
VERSION_API_URL = (
    "https://googlechromelabs.github.io/chrome-for-testing/"
    "last-known-good-versions.json"
)

# 下载 URL 模板
DOWNLOAD_BASE = "https://storage.googleapis.com/chrome-for-testing-public"

_PLATFORM_MAP = {
    "darwin": {
        "chrome_zip": "{version}/mac-arm64/chrome-mac-arm64.zip",
        "chromedriver_zip": "{version}/mac-arm64/chromedriver-mac-arm64.zip",
        "chrome_dir": "chrome-mac-arm64",
        "chromedriver_dir": "chromedriver-mac-arm64",
        "chrome_exe": "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chromedriver_exe": "chromedriver",
    },
    "win32": {
        "chrome_zip": "{version}/win64/chrome-win64.zip",
        "chromedriver_zip": "{version}/win64/chromedriver-win64.zip",
        "chrome_dir": "chrome-win64",
        "chromedriver_dir": "chromedriver-win64",
        "chrome_exe": "chrome.exe",
        "chromedriver_exe": "chromedriver.exe",
    },
}

_platform = _PLATFORM_MAP.get(sys.platform)
if _platform is None:
    print(f"不支持的操作系统: {sys.platform}")
    sys.exit(1)

CHROME_ZIP = _platform["chrome_zip"]
CHROMEDRIVER_ZIP = _platform["chromedriver_zip"]
CHROME_DIR = _platform["chrome_dir"]
CHROMEDRIVER_DIR = _platform["chromedriver_dir"]
CHROME_EXE = _platform["chrome_exe"]
CHROMEDRIVER_EXE = _platform["chromedriver_exe"]

# 项目根目录（脚本所在目录的上一级）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN_DIR = os.path.join(PROJECT_ROOT, "bin")


def fetch_latest_stable_version():
    """从 Chrome for Testing API 获取最新稳定版号。"""
    print(f"正在查询最新稳定版本...")
    try:
        with urllib.request.urlopen(VERSION_API_URL) as resp:
            data = json.loads(resp.read().decode())
        version = data["channels"]["Stable"]["version"]
        print(f"最新稳定版: {version}")
        return version
    except Exception as e:
        print(f"查询版本失败: {e}")
        print("请手动指定版本号: python scripts/download_chrome.py --version <版本号>")
        sys.exit(1)


def download_file(url, dest_path):
    """下载文件并显示进度。"""
    print(f"  下载: {url}")
    print(f"  保存到: {dest_path}")

    def _progress(block_count, block_size, total_size):
        downloaded = block_count * block_size
        if total_size > 0:
            pct = min(100, downloaded * 100 // total_size)
            mb_down = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r  进度: {pct}% ({mb_down:.1f}/{mb_total:.1f} MB)", end="")

    try:
        urllib.request.urlretrieve(url, dest_path, _progress)
        print()  # 换行
    except Exception as e:
        print(f"\n下载失败: {e}")
        sys.exit(1)


def extract_zip(zip_path, extract_to):
    """解压 zip 文件到目标目录。"""
    print(f"  解压: {os.path.basename(zip_path)} -> {extract_to}")
    os.makedirs(extract_to, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(extract_to)
    # 清理 zip 文件
    os.remove(zip_path)


def verify_bin():
    """检查 bin/ 目录中的关键文件是否存在。"""
    chrome_exe = os.path.join(BIN_DIR, CHROME_DIR, CHROME_EXE)
    chromedriver_exe = os.path.join(BIN_DIR, CHROMEDRIVER_DIR, CHROMEDRIVER_EXE)

    ok = True
    if os.path.exists(chrome_exe):
        size_mb = os.path.getsize(chrome_exe) / (1024 * 1024)
        print(f"  [OK] {CHROME_EXE} ({size_mb:.1f} MB)")
    else:
        print(f"  [FAIL] {CHROME_EXE} 未找到")
        ok = False

    if os.path.exists(chromedriver_exe):
        size_mb = os.path.getsize(chromedriver_exe) / (1024 * 1024)
        print(f"  [OK] {CHROMEDRIVER_EXE} ({size_mb:.1f} MB)")
    else:
        print(f"  [FAIL] {CHROMEDRIVER_EXE} 未找到")
        ok = False

    return ok


def main():
    parser = argparse.ArgumentParser(description="下载 Chrome for Testing")
    parser.add_argument(
        "--version", "-v",
        help="指定 Chrome 版本号，不指定则下载最新稳定版",
    )
    args = parser.parse_args()

    version = args.version or fetch_latest_stable_version()

    # 清理旧版本
    if os.path.exists(BIN_DIR):
        print(f"清理旧版本: {BIN_DIR}")
        shutil.rmtree(BIN_DIR)

    os.makedirs(BIN_DIR, exist_ok=True)

    # 下载 Chrome
    chrome_url = f"{DOWNLOAD_BASE}/{CHROME_ZIP.format(version=version)}"
    chrome_zip = os.path.join(BIN_DIR, f"{CHROME_DIR}.zip")
    print(f"\n[1/2] 下载 Chrome for Testing v{version} ({sys.platform})")
    download_file(chrome_url, chrome_zip)
    extract_zip(chrome_zip, BIN_DIR)

    # 下载 ChromeDriver
    chromedriver_url = f"{DOWNLOAD_BASE}/{CHROMEDRIVER_ZIP.format(version=version)}"
    chromedriver_zip = os.path.join(BIN_DIR, f"{CHROMEDRIVER_DIR}.zip")
    print(f"\n[2/2] 下载 ChromeDriver v{version} ({sys.platform})")
    download_file(chromedriver_url, chromedriver_zip)
    extract_zip(chromedriver_zip, BIN_DIR)

    # 验证
    print(f"\n验证 bin/ 目录...")
    if verify_bin():
        print(f"\nChrome for Testing v{version} 下载完成！")
        print(f"位置: {BIN_DIR}")
    else:
        print(f"\n下载验证失败，请重试。")
        sys.exit(1)


if __name__ == "__main__":
    main()
