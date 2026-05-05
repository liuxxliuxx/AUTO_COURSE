"""
Generate NSIS installer script (.nsi) with proper UTF-8 BOM encoding.

Usage:
    python scripts/generate_nsi.py dist/ZhiHuiShu_AutoCourse dist/installer/ZhiHuiShu_AutoCourse-setup.exe
"""

import sys

DISPLAY_NAME = "智慧树自动刷课"
APP_NAME = "ZhiHuiShu_AutoCourse"

NSI_TEMPLATE = '''
!include "MUI2.nsh"

Name "{display_name}"
OutFile "{outfile}"
InstallDir "$PROGRAMFILES64\\{app_name}"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "!{display_name}" SecMain
    SectionIn RO
    SetOutPath $INSTDIR
    File /r "{app_dir}\\*.*"

    CreateDirectory "$SMPROGRAMS\\{display_name}"
    CreateShortCut "$SMPROGRAMS\\{display_name}\\{display_name}.lnk" "$INSTDIR\\{app_name}.exe"
    CreateShortCut "$SMPROGRAMS\\{display_name}\\Uninstall.lnk" "$INSTDIR\\uninstall.exe"

    WriteUninstaller "$INSTDIR\\uninstall.exe"
SectionEnd

Section "创建桌面快捷方式" SecDesktop
    CreateShortCut "$DESKTOP\\{display_name}.lnk" "$INSTDIR\\{app_name}.exe"
SectionEnd

LangString DESC_SecMain 2052 "安装程序文件到计算机。"
LangString DESC_SecDesktop 2052 "在桌面上创建快捷方式，方便快速启动。"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${{SecMain}} $(DESC_SecMain)
    !insertmacro MUI_DESCRIPTION_TEXT ${{SecDesktop}} $(DESC_SecDesktop)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
    Delete "$DESKTOP\\{display_name}.lnk"
    RMDir /r "$SMPROGRAMS\\{display_name}"
    RMDir /r "$INSTDIR"
SectionEnd
'''


def main():
    if len(sys.argv) < 3:
        print(f"Usage: python {sys.argv[0]} <app_dir> <outfile>")
        print(f"Example: python {sys.argv[0]} dist/{APP_NAME} dist/installer/{APP_NAME}-setup.exe")
        sys.exit(1)

    app_dir = sys.argv[1]
    outfile = sys.argv[2]

    nsi = NSI_TEMPLATE.format(
        display_name=DISPLAY_NAME,
        app_name=APP_NAME,
        app_dir=app_dir,
        outfile=outfile,
    )

    nsi_path = outfile.replace(".exe", ".nsi")
    with open(nsi_path, "w", encoding="utf-8-sig") as f:
        f.write(nsi)

    print(f"NSIS script written: {nsi_path}")


if __name__ == "__main__":
    main()
