export declare class BiStream {
  read(maxLength: number): Promise<Buffer | null>;
  write(bytes: Buffer): Promise<void>;
  finish(): Promise<void>;
  reset(errorCode: number): Promise<void>;
  stop(errorCode: number): Promise<void>;
  bytesRead(): Promise<number>;
  stopped(): Promise<void>;
}
export type JsBiStream = BiStream;

export declare class Connection {
  get remoteEndpointId(): string;
  get remotePublicKeyHex(): string;
  paths(): Array<PathSnapshot>;
  openBi(): Promise<JsBiStream>;
  acceptBi(): Promise<JsBiStream>;
  close(errorCode: number, reason: Buffer): void;
  closed(): Promise<string>;
}
export type JsConnection = Connection;

export declare class Endpoint {
  static bind(
    secretKey: Buffer,
    bindAddresses: Array<string>,
    relayUrl?: string | undefined | null,
    relayToken?: string | undefined | null,
  ): Promise<Endpoint>;
  get endpointId(): string;
  get publicKeyHex(): string;
  get boundSockets(): Array<string>;
  addExternalAddr(address: string): Promise<void>;
  accept(): Promise<JsIncoming | null>;
  connect(
    peerPublicKey: Buffer,
    directAddresses: Array<string>,
  ): Promise<JsConnection>;
  close(): Promise<void>;
}
export type JsEndpoint = Endpoint;

export declare class Incoming {
  handshake(): Promise<JsConnection>;
  refuse(): Promise<void>;
}
export type JsIncoming = Incoming;

export declare function generateIdentity(): Identity;

export interface Identity {
  secretKey: Buffer;
  endpointId: string;
  publicKeyHex: string;
}

export declare function identityFromSecretKey(secretKey: Buffer): Identity;

export interface PathSnapshot {
  isSelected: boolean;
  isIp: boolean;
  isRelay: boolean;
  remoteAddr: string;
}

export declare function protectUserData(data: Buffer): Buffer;

export declare function unprotectUserData(data: Buffer): Buffer;
