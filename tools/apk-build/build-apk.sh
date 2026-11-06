#!/usr/bin/env bash
# Build APK "Ôn tập CNXHKH" (WebView) — không cần Gradle.
set -e

ROOT="/c/test-system/tools/apk-build"
APP="$ROOT/app"
BT="$ROOT/sdk/android-14"                 # build-tools 34.0.0
PLATFORM_JAR="$ROOT/sdk/android-34/android.jar"
OUT="$ROOT/build"
FINAL="/c/test-system/dist/OnThiCNXHKH.apk"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

echo "==> 1/7 aapt2 compile resources"
"$BT/aapt2.exe" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> 2/7 aapt2 link"
"$BT/aapt2.exe" link \
  -o "$OUT/app-unsigned.apk" \
  -I "$PLATFORM_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$APP/assets" \
  --min-sdk-version 21 \
  --target-sdk-version 34 \
  "$OUT/res.zip"

echo "==> 3/7 javac"
javac -source 1.8 -target 1.8 \
  -classpath "$PLATFORM_JAR" \
  -d "$OUT/classes" \
  "$APP/src/vn/cnxhkh/onthi/MainActivity.java"

echo "==> 4/7 d8 (dex)"
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release --lib "$PLATFORM_JAR" \
  --output "$OUT/dex" \
  "$OUT/classes/vn/cnxhkh/onthi/MainActivity.class"

echo "==> 5/7 thêm classes.dex vào APK"
cd "$OUT/dex"
jar -uf "$OUT/app-unsigned.apk" classes.dex

echo "==> 6/7 zipalign"
"$BT/zipalign.exe" -f 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"

echo "==> 7/7 ký APK"
KS="$OUT/debug.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android \
    -dname "CN=OnThiCNXHKH,O=CNXHKH,C=VN" >/dev/null 2>&1
fi
java -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$FINAL" "$OUT/app-aligned.apk"

echo "==> Kiểm tra chữ ký"
java -jar "$BT/lib/apksigner.jar" verify "$FINAL"

echo ""
echo "HOÀN TẤT: $FINAL"
ls -la "$FINAL"
