#!/bin/bash
set -e

APP_NAME="智慧树自动刷课"
DIST_APP="dist/${APP_NAME}.app"
FRAMEWORKS="${DIST_APP}/Contents/Frameworks"
PYTHON=".venv/bin/python3"
PYTHON_LIB="$(${PYTHON} -c 'import sys; print(sys.base_prefix)')/lib"

echo "==> Building with py2app..."
${PYTHON} scripts/setup_mac.py py2app

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

echo "==> Done: ${DIST_APP}"
