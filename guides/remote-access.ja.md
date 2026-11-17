# 外出先から iori に接続する

[English](remote-access.md)

iori Client は、LAN または VPN 経由で iori Host に直接接続します。家の外から接続するには、Host とスマートフォンを同じ VPN に接続するか、自分で iroh-relay を用意します。

どちらの方法でも、通常の iori のデバイス登録を使います。Relay は暗号化された iori の通信を中継するだけで、デバイスの登録や Host へのアクセス許可は行いません。

## VPN を使う

Host の PC とスマートフォンの両方で VPN を使える場合は、この方法が簡単です。以下では Tailscale を例にします。[WireGuard](https://www.wireguard.com/) などの VPN でも、Host にスマートフォンから接続できる VPN アドレスが割り当てられ、そのアドレスへの通信経路があれば同じように使えます。

### 必要なもの

- Windows または Linux の PC で動作する iori Host。
- Host の PC と Android スマートフォンにインストールした Tailscale。同じ tailnet にサインインし、アクセス制御で相互の接続を許可します。
- Windows Host の場合は、Windows ファイアウォールで iori Host の接続を許可するための管理者承認。

Tailscale のインストール方法は[Windows](https://tailscale.com/docs/install/windows)、[Linux](https://tailscale.com/docs/install/linux)、[Android](https://tailscale.com/docs/install/android)を参照してください。Host の PC 自体で Tailscale を使う場合、サブネットルーターの設定は必要ありません。

iori Host を WSL で動かす場合は、先に[WSL で iori Host を動かす](wsl.ja.md)の手順で mirrored のネットワークと Windows Hyper-V ファイアウォールを設定します。Tailscale は[Windows と WSL の手順](https://tailscale.com/docs/install/windows/wsl2)を参照してください。Tailscale は WSL 内ではなく Windows にインストールする方法を推奨しています。

### 設定する

1. Host の PC とスマートフォンに Tailscale をインストールし、同じ tailnet にサインインします。両方のデバイスがオンラインであることを確認します。
2. Windows Host の場合は、Host の PC で iori Client を開き、Host の「接続」の設定から「ほかのデバイスからの接続を許可する」を選びます。Windows の確認画面で許可します。この iori のファイアウォール規則は全てのネットワーク プロファイルを対象にし、VPN インターフェースを制限しません。Linux の場合は、Host の「接続」に表示されるポートへの受信 UDP 通信をファイアウォールで許可します。
3. Host の PC で Tailscale を起動した状態で、登録済みの iori Client の「デバイス」から「新しいデバイスを招待する」を選びます。スマートフォンの iori Client で「招待で接続する」を選び、QR コードを読み取るか、招待コードを貼り付けます。
4. 外出先ではスマートフォンで Tailscale に接続してから、iori Client で登録済みの Host を開きます。

Host は、OS が返すアドレスのうち、ループバックと IPv4・IPv6 のリンクローカルアドレスを除いたものを招待に含めます。OS が Tailscale や WireGuard のアドレスを返す場合は、そのアドレスも含まれます。Client は招待に含まれる各アドレスへ接続します。VPN の接続後に招待を発行すれば、VPN のアドレスを iori の設定へ手動で入力する必要はありません。

### 接続できない場合

- Tailscale が両方のデバイスで起動していて、同じ tailnet に参加し、tailnet のアクセス制御で接続が許可されていることを確認します。詳しくは Tailscale の[デバイスへの接続](https://tailscale.com/docs/how-to/connect-to-devices)を参照してください。
- Host のファイアウォールと VPN のアクセス制御を確認します。Windows では Host の「接続」の設定で「ほかのデバイスからの接続を許可する」を有効にします。iori の規則は全てのネットワーク プロファイルを対象にし、インターフェースを制限しません。別のファイアウォール規則や VPN のアクセス制御で接続がブロックされることがあります。Linux では Host の「接続」に表示されるポートへの受信 UDP 通信を許可します。
- Host で VPN に接続する前に発行した招待は、新しいアドレスを含まないことがあります。VPN に接続してから招待を発行し直します。
- Client の切断中に Host の VPN アドレスが変わった場合は、iori Client の「設定」で対象の Host を選び、「接続」で古い IP アドレスを新しいものに置き換えます。アドレスに表示されているポート番号はそのまま使います。Client の接続中に Host からアドレス変更を受け取ると、iori が接続先に追加します。

## 自分で用意した iroh-relay を使う

直接接続できないときに、登録済みの Client から Host へ接続できます。Relay サーバーは自分で用意し、管理します。iori が提供する Relay はありません。

### 必要なもの

- インターネットから接続できるサーバーで動作する `iroh-relay`。
- サーバーを指す DNS 名。セルフホストの手順で紹介されている ACME の設定を使う場合は、80 番と 443 番ポートで接続できること、証明書の保存先と連絡先メールアドレスが必要です。
- Relay の HTTPS URL。公開サーバーでは、特にアクセストークンを使う場合に HTTPS を使います。

サーバーの設定とアクセス制御は、[`iroh-relay` のリポジトリの説明](https://github.com/n0-computer/iroh/blob/main/iroh-relay/README.md)を参照してください。[セルフホストの手順](https://docs.iroh.computer/iroh-services/relays/self-hosted)には利用できるバイナリと HTTPS の基本設定が記載されています。Relay の[ヘルスチェック](https://docs.iroh.computer/iroh-services/relays/self-hosted#simple-health-check)は `https://<relay-hostname>/healthz` で確認できます。

### 設定する

1. サーバーに `iroh-relay` をインストールして起動します。`https://relay.example.org/` のように、Relay の HTTPS URL を用意します。
2. iori Client で Host の「接続」の設定を開き、「RelayのURL」に URL を入力します。Relay が必要とする場合は、Relay に設定したアクセストークンも入力して保存します。登録済みの Client は Host から Relay の設定を受け取るため、スマートフォン側に Relay を設定する必要はありません。
3. Relay がアクセストークンを必須にする場合は、先に家の LAN または VPN 経由でスマートフォンを Host に登録します。招待には Relay の URL が含まれますが、アクセストークンは含まれません。Relay がトークンを求めない場合は、招待を発行する前に URL を設定すれば、Relay 経由でスマートフォンを登録できます。
4. 家の外から iori Client で Host を開きます。iori は直接接続を試し、直接接続できないときに Relay を使います。Relay の設定を保存すると、登録済みの Client は一度切断して再接続します。

### 接続できない場合

- `https://<relay-hostname>/healthz` を開き、Relay が応答することを確認します。DNS がサーバーを指していること、有効な証明書で HTTPS 接続できること、必要なポートへ接続できることを確認します。
- iori Client に設定した URL が起動中の Relay と一致し、アクセストークンを使う場合は Relay の設定と一致していることを確認します。
- アクセストークンが必要な場合は、スマートフォンを LAN または VPN 経由で先に登録します。
- Host の「接続」の設定で、接続の経路が「Relay」または「直接」と表示されていることを確認します。
