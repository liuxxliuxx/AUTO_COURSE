#!/bin/bash
set -e

# Internal name: English only (used for directories, app bundle, DMG)
APP_NAME="ZhiHuiShu_AutoCourse"
DISPLAY_NAME="智慧树自动刷课"
DIST_APP="dist/${APP_NAME}.app"
FRAMEWORKS="${DIST_APP}/Contents/Frameworks"
PYTHON=".venv/bin/python3"
PYTHON_LIB="$(${PYTHON} -c 'import sys; print(sys.base_prefix)')/lib"
echo "==> Building with py2app..."
${PYTHON} scripts/setup_mac.py py2app

echo "==> Copying root-level modules..."
RES="${DIST_APP}/Contents/Resources"
cp config.py database.py "${RES}/"

echo "==> Copying dylibs..."
DYNLOAD=$(echo "${DIST_APP}"/Contents/Resources/lib/python3.*/lib-dynload)
# Build list of missing @rpath dylibs to a temp file to avoid subshell issues
TMPFILE=$(mktemp)
for so in "$DYNLOAD"/*.so; do
    otool -L "$so" 2>/dev/null | sed -n 's/.*@rpath\/\([^ ]*\).*/\1/p'
done | sort -u > "$TMPFILE"

while read -r lib; do
    [ -z "$lib" ] && continue
    src=""
    [ -f "${PYTHON_LIB}/${lib}" ] && src="${PYTHON_LIB}/${lib}"
    [ -z "$src" ] && [ -f "/opt/homebrew/lib/${lib}" ] && src="/opt/homebrew/lib/${lib}"
    [ -z "$src" ] && [ -f "/usr/local/lib/${lib}" ] && src="/usr/local/lib/${lib}"
    dst="${FRAMEWORKS}/${lib}"
    if [ -n "$src" ] && [ ! -f "$dst" ]; then
        cp "$src" "$dst"
        echo "  ${lib}"
    fi
done < "$TMPFILE"
rm -f "$TMPFILE"

# Also copy libpython dylib if not already bundled
LIBPYTHON=$(ls "${FRAMEWORKS}"/libpython*.dylib 2>/dev/null || true)
if [ -z "$LIBPYTHON" ]; then
    PYTHON_HOME=$(${PYTHON} -c 'import sys; print(sys.base_prefix)')
    LIBPYTHON_SRC=$(find "${PYTHON_HOME}" -name 'libpython*.dylib' -maxdepth 3 2>/dev/null | head -1)
    if [ -n "$LIBPYTHON_SRC" ] && [ ! -f "${FRAMEWORKS}/$(basename "$LIBPYTHON_SRC")" ]; then
        cp "$LIBPYTHON_SRC" "${FRAMEWORKS}/"
        echo "  $(basename "$LIBPYTHON_SRC")"
    fi
fi

echo "==> Creating DMG..."
DMG_DIR="dist/${APP_NAME}_dmg"
DMG_FILE="dist/${APP_NAME}.dmg"
rm -rf "${DMG_DIR}" "${DMG_FILE}"
mkdir -p "${DMG_DIR}"
cp -R "${DIST_APP}" "${DMG_DIR}/"
# Create symlink to /Applications for drag-to-install
ln -s /Applications "${DMG_DIR}/Applications"
hdiutil create -volname "${DISPLAY_NAME}" -srcfolder "${DMG_DIR}" -ov -format UDZO "${DMG_FILE}"
rm -rf "${DMG_DIR}"

echo "==> Done: ${DIST_APP}"
echo "         ${DMG_FILE}"
