# Host の iroh addon

Node.js 24からRustのirohを呼ぶ製品用の通信部品です。endpointの設定は[共有crate](../../../crates/iori-iroh-config/)に置き、製品Clientも同じ設定を使います。要求・応答の形式、招待、端末の登録と認可は、このaddonを呼ぶHost側が持ちます。

## build

repository rootで依存を準備してから実行します。

```sh
pnpm install --frozen-lockfile
node scripts/run-bounded-check.mjs pnpm --filter @iori/host build:native
```

Windowsでは既存MSVCのDeveloper環境で同じpnpmコマンドを実行します。release用は`pnpm --filter @iori/host-iroh-native build:release`です。生成物はこのdirectoryの`iori_iroh_host_native.node`と`index.d.ts`です。配布時は対象OSでbuildした`.node`を`index.js`と同じ場所へ置きます。

## Host runtime

Hostの要求・出来事・SQLite保存は`apps/host/src/`にあります。開発中は`pnpm --filter @iori/host dev`でHostを起動し、別の端末から`pnpm --filter @iori/host invite`を実行すると招待を作れます。Hostは初めての起動で`49171`番portを試し、使用中なら空きportを選んで、記録したportに以後も待ち受けます。検証時は`IORI_HOST_PORT`で指定できます。招待CLIは表示したQRと文字列を使って端末が登録されるまで待ち、`Ctrl+C`で待機だけをやめます。

Hostはloopback TCPの手元口とランダムtokenを使います。portとtokenはHost専用保存先の`control.json`に置き、Linuxでは`0600`、Windowsでは現在のユーザーだけに許可したACLを設定します。HostのSQLiteと鍵も同じ本人専用directoryに保存します。

## JavaScript API

`index.js`はCommonJSです。ES Modulesからはdefault importできます。型はbuildで生成する`index.d.ts`を参照してください。

| API                                                                     | 結果・責務                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `generateIdentity()`                                                    | 新しい32byteの秘密鍵、公開鍵のhex、endpoint IDを返す           |
| `identityFromSecretKey(secretKey)`                                      | 保存した32byteの秘密鍵から同じidentityを得る                   |
| `Endpoint.bind(secretKey, bindAddresses)`                               | 数値IP:portへbindする。未指定アドレスで全interfaceに待ち受ける |
| `endpoint.endpointId`, `endpoint.publicKeyHex`, `endpoint.boundSockets` | endpointの公開鍵と実際の待受socket                             |
| `endpoint.addExternalAddr(address)`                                     | 相手へ知らせる直接アドレスを追加する                           |
| `endpoint.accept()`                                                     | handshake前のIncomingを返す。endpoint終了時はnull              |
| `incoming.handshake()`                                                  | 相手の鍵を確認してConnectionを返す                             |
| `incoming.refuse()`                                                     | handshakeを始めずにIncomingを拒否する                          |
| `endpoint.connect(peerPublicKey, directAddresses)`                      | 指定した相手の公開鍵と数値IP:portで接続する                    |
| `endpoint.close()`                                                      | endpointと接続を閉じる                                         |
| `connection.remoteEndpointId`, `connection.remotePublicKeyHex`          | handshakeで確認した相手の公開鍵                                |
| `connection.paths()`                                                    | 選択中か、直接IP経路か、Relay経路か、相手アドレスのsnapshot    |
| `connection.openBi()`, `connection.acceptBi()`                          | 双方向streamを開く・受け取る                                   |
| `connection.close(errorCode, reason)`                                   | 接続を閉じる。reasonはBuffer                                   |
| `connection.closed()`                                                   | 通信ライブラリの切断通知を待ち、理由の文字列を返す             |
| `stream.read(maxLength)`                                                | 最大指定byte数をBufferで返す。受信終了時はnull                 |
| `stream.write(bytes)`, `stream.finish()`                                | Bufferを書き、送信側を終了する                                 |
| `stream.reset(errorCode)`, `stream.stop(errorCode)`                     | 保留中のwrite・readを待たず、streamの送信・受信を中断する      |
| `stream.bytesRead()`                                                    | 受信したbyte数を返す                                           |
| `protectUserData(bytes)`, `unprotectUserData(bytes)`                    | Windowsの現在のユーザー向けDPAPIで保護・復号する               |
| `restrictToCurrentUser(path)`                                           | Windowsの保存先へ現在のユーザーだけが使えるACLを設定する       |

接続の待機やstreamの読み書きはPromiseを返します。公開鍵は32byteのBuffer、bind/connectのアドレスは数値IPのsocket addressです。Hostは`0.0.0.0:<port>`と`[::]:<port>`を指定して、全interfaceの同じportで待ち受けます。Clientの接続先には具体的なHostのIPを渡します。この実装が使う[irohのbind_addr](https://docs.rs/iroh/1.1.0/iroh/endpoint/struct.Builder.html#method.bind_addr)はfamilyごとに1回までなので、`bindAddresses`はIPv4・IPv6それぞれ1つまでです。irohには同familyの複数socket用の別APIもあります。秘密鍵は保存のためのBufferで、ログや応答へ含めません。

Relay・公開探索・自動ポート開放・GSO・MTU探索は共有設定で無効です。ALPNは`iori`、keep-alive・idleはirohの既定値です。addonに固定の時間切れ、独自の生存確認、要求の再送はありません。

Hostの秘密鍵ファイルはWindowsでは`protectUserData`でDPAPI保護し、専用保存先とそのファイルへ`restrictToCurrentUser`を適用します。LinuxではHost側が専用directoryを`0700`、鍵ファイルを`0600`にします。LinuxでのDPAPI関数は入力Bufferをそのまま返します。
