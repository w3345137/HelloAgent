#!/usr/bin/env bash
set -e

VERSION=${1:-"1.0.0"}
PLATFORM=${2:-"$(uname -s)"}
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$BASE_DIR/build"
DIST_DIR="$BASE_DIR/dist"

echo "=== Hello Agent Packager ==="
echo "Version: $VERSION"
echo "Platform: $PLATFORM"
echo ""

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$BUILD_DIR" "$DIST_DIR"

copy_common() {
    local target="$1"
    mkdir -p "$target/Data/core"
    mkdir -p "$target/Data/modules/adapters"
    mkdir -p "$target/Data/tools"
    mkdir -p "$target/Data/config"
    mkdir -p "$target/Data/logs"
    mkdir -p "$target/web/lib"

    cp "$BASE_DIR/web/index.html" "$target/web/"
    cp -r "$BASE_DIR/web/lib/"* "$target/web/lib/" 2>/dev/null || true
    cp "$BASE_DIR/web/logo.png" "$target/web/" 2>/dev/null || true
    cp "$BASE_DIR/web/permissions.html" "$target/web/" 2>/dev/null || true

    cp "$BASE_DIR/src/core/"*.js "$target/Data/core/"
    cp "$BASE_DIR/src/modules/"*.js "$target/Data/modules/"
    cp "$BASE_DIR/src/modules/adapters/"*.js "$target/Data/modules/adapters/"
    cp "$BASE_DIR/src/tools/"*.js "$target/Data/tools/"
    cp "$BASE_DIR/src/config/"*.example "$target/Data/config/" 2>/dev/null || true
    cp "$BASE_DIR/package.json" "$target/Data/"

    cd "$target/Data"
    npm install --production --no-optional 2>/dev/null || npm install --production
    cd "$BASE_DIR"
}

if [[ "$PLATFORM" == "Darwin" || "$PLATFORM" == "macOS" ]]; then
    echo "📦 Building macOS .app..."
    APP="$BUILD_DIR/Hello Agent.app"
    mkdir -p "$APP/Contents/MacOS"
    mkdir -p "$APP/Contents/Resources"

    clang -fobjc-arc -framework Cocoa -framework WebKit \
        -o "$APP/Contents/MacOS/Hello Agent" \
        "$BASE_DIR/src/hello-agent-shell.m"

    NODE_BIN=$(which node)
    cp "$NODE_BIN" "$APP/Contents/MacOS/node"

    copy_common "$APP/Contents/Resources"

    cp "$BASE_DIR/logo/app-icon.icns" "$APP/Contents/Resources/app.icns" 2>/dev/null || true

    cat > "$APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Hello Agent</string>
    <key>CFBundleDisplayName</key><string>Hello Agent</string>
    <key>CFBundleIdentifier</key><string>com.helloagent.app</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleExecutable</key><string>Hello Agent</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleIconFile</key><string>app</string>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
PLIST

    cd "$BUILD_DIR"
    zip -r -9 "$DIST_DIR/Hello-Agent-macOS-v${VERSION}.zip" "Hello Agent.app"
    echo "✅ macOS build: dist/Hello-Agent-macOS-v${VERSION}.zip"

elif [[ "$PLATFORM" == "Linux" ]]; then
    echo "📦 Building Linux package..."
    PKG="$BUILD_DIR/hello-agent"
    mkdir -p "$PKG"

    copy_common "$PKG"
    cp "$BASE_DIR/scripts/linux/start.sh" "$PKG/start.sh"
    chmod +x "$PKG/start.sh"

    NODE_BIN=$(which node)
    cp "$NODE_BIN" "$PKG/node"

    cat > "$PKG/hello-agent.desktop" << DESKTOP
[Desktop Entry]
Name=Hello Agent
Comment=Self-evolving AI Agent
Exec=bash -c 'cd "\$(dirname "\$0")" && ./start.sh'
Icon=web/logo.png
Terminal=false
Type=Application
Categories=AI;Utility;
DESKTOP

    cd "$BUILD_DIR"
    tar czf "$DIST_DIR/Hello-Agent-Linux-v${VERSION}.tar.gz" hello-agent
    echo "✅ Linux build: dist/Hello-Agent-Linux-v${VERSION}.tar.gz"

elif [[ "$PLATFORM" == "Windows" || "$PLATFORM" == "MINGW" || "$PLATFORM" == "MSYS" ]]; then
    echo "📦 Building Windows package..."
    PKG="$BUILD_DIR/Hello-Agent"
    mkdir -p "$PKG"

    copy_common "$PKG"
    cp "$BASE_DIR/scripts/windows/start.bat" "$PKG/start.bat"
    cp "$BASE_DIR/scripts/windows/start.ps1" "$PKG/start.ps1"

    NODE_BIN=$(which node 2>/dev/null || which node.exe 2>/dev/null)
    cp "$NODE_BIN" "$PKG/" 2>/dev/null || echo "⚠️  Node.js binary not found, users need to install Node.js"

    cd "$BUILD_DIR"
    if command -v powershell.exe &>/dev/null; then
        powershell.exe -Command "Compress-Archive -Path 'Hello-Agent' -DestinationPath '$DIST_DIR/Hello-Agent-Windows-v${VERSION}.zip'"
    else
        zip -r -9 "$DIST_DIR/Hello-Agent-Windows-v${VERSION}.zip" Hello-Agent
    fi
    echo "✅ Windows build: dist/Hello-Agent-Windows-v${VERSION}.zip"
fi

echo ""
echo "🎉 Build complete! Check the dist/ directory."
