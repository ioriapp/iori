#!/bin/sh
install_iori_host() {
  set -eu
  base='__IORI_RELEASE_SOURCE__'
  setup_stage() {
    stage=$1
    if [ "${IORI_SETUP_CLIENT:-}" = 1 ]; then
      printf 'IORI_SETUP {"type":"stage","stage":"%s"}\n' "$stage"
    fi
  }
  setup_stage download
  if [ -n "${IORI_VERSION:-}" ]; then
    base="$base/download/v$IORI_VERSION"
  else
    base="$base/latest/download"
  fi
  destination="$HOME/.local/lib/iori-host"
  unit_file="$HOME/.config/systemd/user/iori-host.service"
  first=true
  if [ -f "$destination/iori-host" ]; then first=false; fi
  mkdir -p "$HOME/.local/lib" "$HOME/.local/bin" "$HOME/.config/systemd/user"
  work=$(mktemp -d "$HOME/.local/lib/.iori-host-XXXXXXXX")
  rollback=false
  unit_replaced=false
  start_requested=false
  handed_off=false
  setup_cleanup() {
    code=$?
    trap - EXIT
    trap '' HUP INT TERM PIPE
    restored=true
    if [ "$handed_off" = false ]; then
      if [ "$rollback" = true ]; then
        if [ "$start_requested" = true ]; then
          if [ "$first" = true ] && [ ! -e "$work/previous.service" ] && [ ! -L "$work/previous.service" ]; then
            systemctl --user disable --now iori-host.service || true
          else
            systemctl --user stop iori-host.service || true
          fi
        fi
        if [ ! -d "$work/host" ]; then
          mv -T "$destination" "$work/host" || restored=false
        fi
        if [ -d "$work/previous" ]; then
          mv -T "$work/previous" "$destination" || restored=false
        fi
        if [ "$unit_replaced" = true ]; then
          if [ -e "$work/previous.service" ] || [ -L "$work/previous.service" ]; then
            mv -fT "$work/previous.service" "$unit_file" || restored=false
          else
            rm -f "$unit_file" || restored=false
          fi
          if systemctl --user daemon-reload && [ "$restored" = true ] && [ "$first" = false ] && [ -f "$unit_file" ]; then
            systemctl --user restart iori-host.service || true
          fi
        fi
      fi
      if [ "$restored" = true ]; then rm -rf "$work" || true; fi
    fi
    if [ "$code" -ne 0 ] && [ "${IORI_SETUP_CLIENT:-}" = 1 ]; then
      printf 'IORI_SETUP {"type":"error","stage":"%s","code":%s}\n' "$stage" "$code"
    fi
    exit "$code"
  }
  trap setup_cleanup EXIT
  trap 'exit 1' HUP PIPE INT TERM
  download() {
    if command -v curl >/dev/null 2>&1; then
      curl -fSL "$base/$1" -o "$2"
    elif command -v wget >/dev/null 2>&1; then
      wget "$base/$1" -O "$2"
    else
      printf '%s\n' 'curl or wget is required to download iori Host.' >&2
      exit 1
    fi
  }
  asset=iori-host-linux-x64.tar.gz
  expected_sha256=${IORI_EXPECTED_SHA256:-}
  expected_size=''
  if [ -z "$expected_sha256" ]; then
    if ! command -v openssl >/dev/null 2>&1; then
      printf '%s\n' 'openssl is required to verify iori Host.' >&2
      exit 1
    fi
    download release.json "$work/release.json"
    download release.json.sig "$work/release.json.sig"
    setup_stage verification
    # release-public-key.txt contains the raw 32-byte Ed25519 key in base64.
    release_public_key=${IORI_RELEASE_PUBLIC_KEY:-u3a8q9j/g7UgqFM2kDVhtOdDzd0dOsiFO/kpbF6Abns=}
    printf '%s' "$release_public_key" | base64 -d > "$work/release-key.raw"
    [ "$(wc -c < "$work/release-key.raw")" -eq 32 ]
    { printf '\060\052\060\005\006\003\053\145\160\003\041\000'; cat "$work/release-key.raw"; } > "$work/release-key.der"
    openssl pkeyutl -verify -rawin -pubin -keyform DER -inkey "$work/release-key.der" \
      -in "$work/release.json" -sigfile "$work/release.json.sig" > /dev/null
    if ! awk -v asset="$asset" -v req_ver="${IORI_VERSION:-}" '
      { buf = buf " " $0 }
      END {
        ver = ""
        if (match(buf, /"version"[ \t\r\n]*:[ \t\r\n]*"[^"]*"/)) {
          v = substr(buf, RSTART, RLENGTH)
          sub(/^"version"[ \t\r\n]*:[ \t\r\n]*"/, "", v)
          sub(/"$/, "", v)
          ver = v
        }
        if (req_ver != "" && ver != req_ver) exit 1
        if (!match(buf, /"assets"[ \t\r\n]*:[ \t\r\n]*\[/)) exit 1
        rest = substr(buf, RSTART + RLENGTH)
        end_bracket = index(rest, "]")
        if (end_bracket == 0) exit 1
        arr = substr(rest, 1, end_bracket - 1)
        matches = 0
        found_size = ""
        found_sha = ""
        while (match(arr, /\{[^{}]*\}/)) {
          obj = substr(arr, RSTART, RLENGTH)
          arr = substr(arr, RSTART + RLENGTH)
          n = ""
          if (match(obj, /"name"[ \t\r\n]*:[ \t\r\n]*"[^"]*"/)) {
            n = substr(obj, RSTART, RLENGTH)
            sub(/^"name"[ \t\r\n]*:[ \t\r\n]*"/, "", n)
            sub(/"$/, "", n)
          }
          if (n != asset) continue
          matches++
          sz = ""
          if (match(obj, /"size"[ \t\r\n]*:[ \t\r\n]*[0-9]+[ \t\r\n]*[,}]/)) {
            sz = substr(obj, RSTART, RLENGTH)
            sub(/^"size"[ \t\r\n]*:[ \t\r\n]*/, "", sz)
            sub(/[ \t\r\n]*[,}]$/, "", sz)
          }
          sh = ""
          if (match(obj, /"sha256"[ \t\r\n]*:[ \t\r\n]*"[^"]*"/)) {
            sh = substr(obj, RSTART, RLENGTH)
            sub(/^"sha256"[ \t\r\n]*:[ \t\r\n]*"/, "", sh)
            sub(/"$/, "", sh)
          }
          found_size = sz
          found_sha = sh
        }
        if (matches != 1) exit 1
        if (found_size !~ /^[1-9][0-9]*$/ || length(found_size) > 15) exit 1
        if (length(found_sha) != 64 || found_sha !~ /^[a-f0-9]+$/) exit 1
        print found_size, found_sha
      }
    ' "$work/release.json" > "$work/expected"; then
      printf '%s\n' 'Could not verify iori Host. Retry downloading.' >&2
      exit 1
    fi
    read -r expected_size expected_sha256 < "$work/expected"
    setup_stage download
  fi
  download "$asset" "$work/host.tar.gz"
  setup_stage verification
  if [ -n "$expected_size" ] && [ "$(wc -c < "$work/host.tar.gz")" -ne "$expected_size" ]; then
    printf '%s\n' 'Could not verify iori Host. Retry downloading.' >&2
    exit 1
  fi
  printf '%s  %s\n' "$expected_sha256" "$work/host.tar.gz" | sha256sum -c -
  setup_stage extract
  mkdir "$work/host"
  tar -xzf "$work/host.tar.gz" -C "$work/host"
  if [ "$first" = false ]; then
    if "$work/host/runtime/node" "$work/host/terminal-daemon.mjs" --status; then
      printf '%s\n' '実行中のTerminalとエージェントは止まりません。全端末の接続が一度切れ、iori Hostが起動し直すと自動で戻ります。'
    else
      printf '%s\n' '実行中のTerminalとCLIの画面のプロセスを止めて更新します。ioriのTerminalから実行した場合は、このTerminalも閉じます。会話はCLIに保存されており、更新後に再開できます。'
    fi
  fi
  if [ -e "$unit_file" ] || [ -L "$unit_file" ]; then
    cp -pP "$unit_file" "$work/previous.service"
  fi
  xdg_env_line=''
  wrote_xdg_env=false
  if [ "$first" = false ]; then
    if [ -f "$unit_file" ]; then
      xdg_env_line=$(sed -n '/^Environment="XDG_DATA_HOME=/{p;q;}' "$unit_file")
    fi
  else
    case "${XDG_DATA_HOME:-}" in
      /*)
        if [ "$(printf '%s' "$XDG_DATA_HOME" | wc -c)" -eq "$(printf '%s' "$XDG_DATA_HOME" | LC_ALL=C tr -d '[:cntrl:]' | wc -c)" ]; then
          escaped_xdg=$(printf '%s\n' "$XDG_DATA_HOME" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')
          xdg_env_line="Environment=\"XDG_DATA_HOME=$escaped_xdg\""
          wrote_xdg_env=true
        fi
        ;;
    esac
  fi
  {
    cat <<UNIT
[Unit]
Description=iori Host
[Service]
Type=notify
NotifyAccess=all
Restart=on-failure
TimeoutStartSec=infinity
ExecStart="$destination/iori-host"
UNIT
    if [ -n "$xdg_env_line" ]; then
      printf '%s\n' "$xdg_env_line"
    fi
    cat <<'UNIT'
[Install]
WantedBy=default.target
UNIT
  } > "$work/iori-host.service"
  setup_stage service
  if [ "${IORI_SETUP_CLIENT:-}" = 1 ]; then
    if ! loginctl --no-ask-password enable-linger "$(id -un)"; then
      if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" = no ]; then
        printf 'IORI_SETUP {"type":"linger","enabled":false}\n'
      fi
    fi
  elif [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" = no ]; then
    if loginctl --no-ask-password enable-linger "$(id -un)"; then
      printf '%s\n' 'ログアウト後もiori Hostを動かす設定を有効にしました。'
    else
      printf 'ログアウト後も動かすには、管理者が次を実行してください: sudo loginctl enable-linger %s\n' "$(id -un)"
    fi
  fi
  setup_stage start
  if [ "$first" = true ]; then
    rollback=true
    mv -T "$work/host" "$destination"
    unit_replaced=true
    mv -fT "$work/iori-host.service" "$unit_file"
    systemctl --user daemon-reload
    start_requested=true
    systemctl --user enable --now iori-host.service
    rollback=false
    ln -sf "$destination/iori-host" "$HOME/.local/bin/iori-host"
    printf '%s\n' 'iori Hostを起動しました。'
    if [ "${IORI_SETUP_CLIENT:-}" != 1 ]; then
      if [ "$wrote_xdg_env" = true ]; then
        "$destination/iori-host" invite
      else
        env -u XDG_DATA_HOME "$destination/iori-host" invite
      fi
    fi
  else
    # Replacing an incompatible terminal daemon terminates the old daemon's
    # transient unit cgroup with SIGTERM during restart. Run the swap, restart
    # and rollback in a separate scope so an update from inside an iori
    # Terminal finishes instead of rolling back on SIGTERM.
    cat <<'APPLY' > "$work/apply-update.sh"
#!/bin/sh
set -eu
rollback=true
unit_replaced=false
start_requested=false
cleanup() {
  code=$?
  trap - EXIT
  trap '' HUP INT TERM PIPE
  restored=true
  if [ "$rollback" = true ]; then
    if [ "$start_requested" = true ]; then
      systemctl --user stop iori-host.service || true
    fi
    if [ ! -d "$IORI_WORK/host" ]; then
      mv -T "$IORI_DESTINATION" "$IORI_WORK/host" || restored=false
    fi
    if [ -d "$IORI_WORK/previous" ]; then
      mv -T "$IORI_WORK/previous" "$IORI_DESTINATION" || restored=false
    fi
    if [ "$unit_replaced" = true ]; then
      if [ -e "$IORI_WORK/previous.service" ] || [ -L "$IORI_WORK/previous.service" ]; then
        mv -fT "$IORI_WORK/previous.service" "$IORI_UNIT_FILE" || restored=false
      else
        rm -f "$IORI_UNIT_FILE" || restored=false
      fi
      if systemctl --user daemon-reload && [ "$restored" = true ] && [ -f "$IORI_UNIT_FILE" ]; then
        systemctl --user restart iori-host.service || true
      fi
    fi
  fi
  if [ "$restored" = true ]; then rm -rf "$IORI_WORK" || true; fi
  exit "$code"
}
trap cleanup EXIT
trap '' HUP PIPE
trap 'exit 1' INT TERM
mv -T "$IORI_DESTINATION" "$IORI_WORK/previous"
mv -T "$IORI_WORK/host" "$IORI_DESTINATION"
unit_replaced=true
mv -fT "$IORI_WORK/iori-host.service" "$IORI_UNIT_FILE"
systemctl --user daemon-reload
systemctl --user enable iori-host.service
start_requested=true
systemctl --user restart iori-host.service
rollback=false
ln -sf "$IORI_DESTINATION/iori-host" "$HOME/.local/bin/iori-host"
printf '%s\n' 'iori Hostを起動しました。' || true
APPLY
    handed_off=true
    if [ "${IORI_SETUP_CLIENT:-}" != 1 ] && command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet true </dev/null 2>/dev/null; then
      IORI_WORK="$work" IORI_DESTINATION="$destination" IORI_UNIT_FILE="$unit_file" \
        systemd-run --user --scope --quiet -- sh "$work/apply-update.sh" </dev/null
    else
      IORI_WORK="$work" IORI_DESTINATION="$destination" IORI_UNIT_FILE="$unit_file" \
        sh "$work/apply-update.sh" </dev/null
    fi
  fi
}
install_iori_host
