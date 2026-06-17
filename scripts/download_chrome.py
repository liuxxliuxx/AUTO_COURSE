"""Download Chrome for Testing and ChromeDriver into the project bin/ folder."""

import argparse
import json
import os
import platform
import shutil
import stat
import sys
import urllib.request
import zipfile

VERSION_API_URL = (
    "https://googlechromelabs.github.io/chrome-for-testing/"
    "last-known-good-versions.json"
)
DOWNLOAD_BASE = "https://storage.googleapis.com/chrome-for-testing-public"

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN_DIR = os.path.join(PROJECT_ROOT, "bin")


def _platform_config():
    if sys.platform == "win32":
        label = "win64"
    elif sys.platform == "darwin":
        machine = platform.machine().lower()
        label = "mac-arm64" if machine in ("arm64", "aarch64") else "mac-x64"
    else:
        raise RuntimeError(f"Unsupported platform: {sys.platform}")

    chrome_dir = f"chrome-{label}"
    driver_dir = f"chromedriver-{label}"
    if sys.platform == "darwin":
        chrome_exe = (
            "Google Chrome for Testing.app/Contents/MacOS/"
            "Google Chrome for Testing"
        )
        driver_exe = "chromedriver"
    else:
        chrome_exe = "chrome.exe"
        driver_exe = "chromedriver.exe"

    return {
        "label": label,
        "chrome_zip": f"{{version}}/{label}/{chrome_dir}.zip",
        "driver_zip": f"{{version}}/{label}/{driver_dir}.zip",
        "chrome_dir": chrome_dir,
        "driver_dir": driver_dir,
        "chrome_exe": chrome_exe,
        "driver_exe": driver_exe,
    }


PLATFORM = _platform_config()


def fetch_latest_stable_version():
    print("Querying latest stable Chrome for Testing version...")
    try:
        with urllib.request.urlopen(VERSION_API_URL) as response:
            data = json.loads(response.read().decode("utf-8"))
        version = data["channels"]["Stable"]["version"]
        print(f"Latest stable version: {version}")
        return version
    except Exception as exc:
        print(f"Failed to query version: {exc}")
        print("Pass --version <version> to download a specific version.")
        sys.exit(1)


def download_file(url, dest_path):
    print(f"  Download: {url}")
    print(f"  Save to : {dest_path}")

    def _progress(block_count, block_size, total_size):
        downloaded = block_count * block_size
        if total_size > 0:
            percent = min(100, downloaded * 100 // total_size)
            mb_down = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r  Progress: {percent}% ({mb_down:.1f}/{mb_total:.1f} MB)", end="")

    try:
        urllib.request.urlretrieve(url, dest_path, _progress)
        print()
    except Exception as exc:
        print(f"\nDownload failed: {exc}")
        sys.exit(1)


def extract_zip(zip_path, extract_to):
    print(f"  Extract: {os.path.basename(zip_path)} -> {extract_to}")
    os.makedirs(extract_to, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as archive:
        archive.extractall(extract_to)
    os.remove(zip_path)


def _make_executable(path):
    if os.path.exists(path) and sys.platform != "win32":
        mode = os.stat(path).st_mode
        os.chmod(path, mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def verify_bin():
    chrome_path = os.path.join(BIN_DIR, PLATFORM["chrome_dir"], PLATFORM["chrome_exe"])
    driver_path = os.path.join(BIN_DIR, PLATFORM["driver_dir"], PLATFORM["driver_exe"])

    _make_executable(chrome_path)
    _make_executable(driver_path)

    ok = True
    for label, path in (("Chrome", chrome_path), ("ChromeDriver", driver_path)):
        if os.path.exists(path):
            size_mb = os.path.getsize(path) / (1024 * 1024)
            print(f"  [OK] {label}: {path} ({size_mb:.1f} MB)")
        else:
            print(f"  [FAIL] {label} not found: {path}")
            ok = False
    return ok


def main():
    parser = argparse.ArgumentParser(description="Download Chrome for Testing")
    parser.add_argument(
        "--version",
        "-v",
        help="Chrome version to download. Defaults to latest stable.",
    )
    args = parser.parse_args()
    version = args.version or fetch_latest_stable_version()

    if os.path.exists(BIN_DIR):
        print(f"Cleaning old cache: {BIN_DIR}")
        shutil.rmtree(BIN_DIR)
    os.makedirs(BIN_DIR, exist_ok=True)

    chrome_url = f"{DOWNLOAD_BASE}/{PLATFORM['chrome_zip'].format(version=version)}"
    chrome_zip = os.path.join(BIN_DIR, f"{PLATFORM['chrome_dir']}.zip")
    print(f"\n[1/2] Download Chrome for Testing v{version} ({PLATFORM['label']})")
    download_file(chrome_url, chrome_zip)
    extract_zip(chrome_zip, BIN_DIR)

    driver_url = f"{DOWNLOAD_BASE}/{PLATFORM['driver_zip'].format(version=version)}"
    driver_zip = os.path.join(BIN_DIR, f"{PLATFORM['driver_dir']}.zip")
    print(f"\n[2/2] Download ChromeDriver v{version} ({PLATFORM['label']})")
    download_file(driver_url, driver_zip)
    extract_zip(driver_zip, BIN_DIR)

    print("\nVerifying bin/...")
    if verify_bin():
        print(f"\nChrome for Testing v{version} is ready.")
        print(f"Location: {BIN_DIR}")
    else:
        print("\nDownload verification failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
