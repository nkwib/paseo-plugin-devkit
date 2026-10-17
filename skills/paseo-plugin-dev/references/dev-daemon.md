# Isolated dev daemon, by hand

`ppd daemon up` automates this. Use it when you cannot run `ppd`, or to debug a failing start.

```sh
HOME_DIR="$(mktemp -d "$(cd "${TMPDIR:-/tmp}" && pwd -P)/ppd-manual-XXXXXX")"   # canonical path, never ~/.paseo
PORT=7811                                                                    # anything free except 6767
WEB_DIST=/Applications/Paseo.app/Contents/Resources/app-dist                 # macOS app; or a web export, see below

cat >"$HOME_DIR/config.json" <<EOF
{
  "version": 1,
  "daemon": { "listen": "127.0.0.1:$PORT", "relay": { "enabled": false }, "mcp": { "enabled": false } },
  "features": { "dictation": { "enabled": false }, "voiceMode": { "enabled": false },
                "webUi": { "enabled": true, "distDir": "$WEB_DIST" } },
  "pluginsEnabled": true
}
EOF

PASEO_HOME="$HOME_DIR" PASEO_LISTEN="127.0.0.1:$PORT" \
PASEO_WEB_UI_ENABLED=true PASEO_WEB_UI_DIST_DIR="$WEB_DIST" \
  nohup paseo daemon run --home "$HOME_DIR" >"$HOME_DIR/daemon.out" 2>&1 &
echo $! >"$HOME_DIR/ppd.pid"
```

Then every CLI call targets that home: `paseo plugin install /abs/plugin --home "$HOME_DIR"`.

## Gotchas

- Without `"pluginsEnabled": true` installed plugins load as disabled, with no error.
- Speech features download local models (hundreds of MB) into the temp home unless dictation and voice mode are off.
- `paseo` rejects `--home` together with `--host`. Use `--home` for local dev daemons.
- Start the daemon with `nohup ... &` and a pidfile, never as a long-running background tool call: harness limits (30 min, 2 h) kill it mid-run.
- Stop it with `kill "$(cat "$HOME_DIR/ppd.pid")"` after checking `ps -o command= -p <pid>` contains `--home $HOME_DIR`, then remove `$HOME_DIR`. Never `pkill paseo`: that matches the user's daemon too.
- The web UI connects to the daemon that serves it. Deep links (`/h/<serverId>/workspace/<id>`) work only after the root page has loaded once; `ppd web` handles this.
- Without the desktop app, build a web export from a Paseo checkout (`npm run build:daemon-web-ui`, output in `packages/server/dist/server/web-ui`) and pass it as `--web-dist`.
- A workspace makes plugin panels reachable: `paseo workspace create --isolation local --path <dir> --home "$HOME_DIR"`.
