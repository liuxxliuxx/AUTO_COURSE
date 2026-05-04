#!/bin/bash
set -e

APP_NAME="智慧树自动刷课"
DIST_APP="dist/${APP_NAME}.app"
FRAMEWORKS="${DIST_APP}/Contents/Frameworks"
ANACONDA_LIB="$(python3 -c 'import sys; print(sys.prefix)')/lib"

echo "==> Building with py2app..."
python3 scripts/setup_mac.py py2app

echo "==> Copying Anaconda dylibs..."
DYNLOAD="${DIST_APP}/Contents/Resources/lib/python3.*/lib-dynload"
for so in "$DYNLOAD"/*.so; do
    otool -L "$so" 2>/dev/null | sed -n 's/.*@rpath\/\([^ ]*\).*/\1/p'
done | sort -u | while read -r lib; do
    src="${ANACONDA_LIB}/${lib}"
    dst="${FRAMEWORKS}/${lib}"
    if [ -f "$src" ] && [ ! -f "$dst" ]; then
        cp "$src" "$dst"
        echo "  ${lib}"
    fi
done

echo "==> Done: ${DIST_APP}"
