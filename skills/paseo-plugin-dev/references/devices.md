# Device testing

Phones found the bugs web runs could not: an out-of-memory crash on a 300-column sheet (42k native views), a stale scroll offset after zoom, ignored text ellipsis on Android. Budget for at least one device pass per release that touches UI.

## Android (real phone)

Ask the user first, and agree when they will unlock and hand over the phone.

1. `ppd daemon up`, `ppd install <plugin>`.
2. `ppd android status --serial <serial>`: reads screen, keyguard, foreground app and whether `sh.paseo` is installed. If it warns locked, asleep or another app in front, ask the user; wait rather than sending input.
3. `ppd android up --serial <serial>`: `adb reverse tcp:<port> tcp:<port>`. Ask the user to add the host `localhost:<port>` in the Paseo app.
4. Drive and capture:
   - Keep the adb path and its arguments as separate argv entries (an adb path stored together with `-s ...` in one quoted variable fails as "no such file").
   - Screenshot: `adb -s <serial> exec-out screencap -p > shot.png`.
   - Logs: `adb -s <serial> logcat -d | grep -E "ReactNativeJS|sh.paseo"`.
   - Before any `input` command, confirm `sh.paseo` is the foreground app. Swipes start away from the screen edges; edge swipes trigger system BACK.
   - Multi-touch (pinch) cannot be injected with `input`, and `sendevent` is denied without root. Use an `app_process` injector or an existing mobile automation server with multi-touch.
   - Montages: generate in Node (`pngjs`); Pillow is often missing.
5. `ppd android down --serial <serial>` and ask the user to remove the host entry in the app.

With both USB and wireless debugging on, the phone appears twice; that is why every call pins `-s`.

## iOS simulator (Xcode 27)

Paseo does not ship a simulator build, so you build the app from source. Plan about an hour and 15 GB free disk (`ppd doctor` shows both).

- Xcode 27 ships no Simulator.app, so `expo run:ios` fails. Build with `xcodebuild`, install with `xcrun simctl install`, run Metro with `expo start --dev-client`.
- Pods below iOS 15 are rejected: build with `IPHONEOS_DEPLOYMENT_TARGET=15.1`.
- `npm run ios` skips `npm run build:app-deps`; run it first or Metro cannot resolve workspace packages.
- Paseo may crash at launch on the iOS 27 SDK (UIScene required, getpaseo/paseo#7140). Last resort: patch the binary's SDK version with `vtool` and re-sign ad hoc with the original entitlements.
- Installing CocoaPods with Homebrew can relink `openssl@3`; note it for the user.
- Synthetic pinch does not reach the app through simctl; use an XCUITest runner.
- Check the app version you built matches what you report.
