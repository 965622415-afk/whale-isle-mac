#!/bin/sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf '%s\n' "用法：$0 输出目录 [Swift 构建缓存目录]" >&2
  exit 2
fi

package_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
mkdir -p "$1"
output_dir=$(CDPATH= cd "$1" && pwd)
app="$output_dir/鲸屿.app"
if [ -e "$app" ] || [ -L "$app" ]; then
  printf '%s\n' "输出目录里已有鲸屿.app，请先移走它或换一个输出目录。" >&2
  exit 1
fi

staging_dir=$(mktemp -d "$output_dir/.Jingyu-build.XXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
trap 'exit 1' HUP INT TERM

scratch_dir="$staging_dir/swift"
if [ "$#" -eq 2 ]; then
  mkdir -p "$2"
  scratch_dir=$(CDPATH= cd "$2" && pwd)
fi
mkdir -p "$scratch_dir/cache" "$scratch_dir/config" "$scratch_dir/security" "$scratch_dir/modules"
export CLANG_MODULE_CACHE_PATH="$scratch_dir/modules"
export SWIFTPM_MODULECACHE_OVERRIDE="$scratch_dir/modules"

build() {
  /usr/bin/swift build --package-path "$package_dir" \
    --scratch-path "$scratch_dir/build" --cache-path "$scratch_dir/cache" \
    --config-path "$scratch_dir/config" --security-path "$scratch_dir/security" \
    --configuration release "$@"
}

build --product Jingyu
bin_dir=$(build --show-bin-path)

bundle="$staging_dir/鲸屿.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
/usr/bin/install -m 755 "$bin_dir/Jingyu" "$bundle/Contents/MacOS/Jingyu"
/usr/bin/install -m 644 "$package_dir/Info.plist" "$bundle/Contents/Info.plist"
/usr/bin/plutil -lint "$bundle/Contents/Info.plist"

/usr/bin/swift "$package_dir/Tools/make-icon.swift" "$bundle/Contents/Resources/Jingyu.icns"

/usr/bin/codesign --sign - --timestamp=none "$bundle"
/usr/bin/codesign --verify --strict "$bundle"
if [ -e "$app" ] || [ -L "$app" ]; then
  printf '%s\n' "构建期间输出目录出现了鲸屿.app，请换一个目录后重试。" >&2
  exit 1
fi
mv "$bundle" "$app"
printf '%s\n' "$app"
