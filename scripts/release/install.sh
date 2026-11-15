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
  first=true
  if [ -f "$destination/iori-host" ]; then first=false; fi
  mkdir -p "$HOME/.local/lib" "$HOME/.local/bin" "$HOME/.config/systemd/user"
  work=$(mktemp -d "$HOME/.local/lib/.iori-host-XXXXXXXX")
  setup_cleanup() {
    code=$?
    trap - EXIT HUP INT TERM PIPE
    rm -rf "$work"
    if [ "$code" -ne 0 ] && [ "${IORI_SETUP_CLIENT:-}" = 1 ]; then
      printf 'IORI_SETUP {"type":"error","stage":"%s","code":%s}\n' "$stage" "$code"
    fi
  }
  if [ "${IORI_SETUP_CLIENT:-}" = 1 ]; then
    trap setup_cleanup EXIT
    trap 'exit 1' HUP PIPE INT TERM
  else
    trap 'rm -rf "$work"' EXIT HUP INT TERM
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -fSL "$base/iori-host-linux-x64.tar.gz" -o "$work/host.tar.gz"
  elif command -v wget >/dev/null 2>&1; then
    wget "$base/iori-host-linux-x64.tar.gz" -O "$work/host.tar.gz"
  else
    printf '%s\n' 'curl or wget is required to download iori Host.' >&2
    exit 1
  fi
  if [ -n "${IORI_EXPECTED_SHA256:-}" ]; then
    setup_stage verification
    printf '%s  %s\n' "$IORI_EXPECTED_SHA256" "$work/host.tar.gz" | sha256sum -c -
  fi
  setup_stage extract
  mkdir "$work/host"
  tar -xzf "$work/host.tar.gz" -C "$work/host"
  if [ "$first" = false ]; then
    if "$work/host/runtime/node" "$work/host/terminal-daemon.mjs" --status; then
      printf '%s\n' '実行中のTerminalとエージェントは止まりません。全端末の接続が一度切れ、iori Hostが起動し直すと自動で戻ります。'
    else
      printf '%s\n' '実行中のTerminalとCLIの画面のプロセスを止めて更新します。ioriのTerminalから実行した場合は、このTerminalも閉じます。会話はCLIに保存されており、更新後に再開できます。'
    fi
    mv "$destination" "$work/previous"
  fi
  mv "$work/host" "$destination"
  rm -rf "$work/previous"
  ln -sf "$destination/iori-host" "$HOME/.local/bin/iori-host"
  unit_file="$HOME/.config/systemd/user/iori-host.service"
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
  } > "$unit_file"
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
  systemctl --user daemon-reload
  if [ "$first" = true ]; then
    systemctl --user enable --now iori-host.service
  else
    systemctl --user enable iori-host.service
    systemctl --user restart iori-host.service
  fi
  printf '%s\n' 'iori Hostを起動しました。'
  if [ "$first" = true ] && [ "${IORI_SETUP_CLIENT:-}" != 1 ]; then
    if [ "$wrote_xdg_env" = true ]; then
      "$destination/iori-host" invite
    else
      env -u XDG_DATA_HOME "$destination/iori-host" invite
    fi
  fi
}
install_iori_host
