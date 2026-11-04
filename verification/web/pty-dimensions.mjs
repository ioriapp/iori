import { DaemonChannel } from "../../apps/host/src/terminal/daemon/channel.ts";

// Observe the real Host -> PTY owner calls. Never forward launch arguments,
// environment, input, or output, which may contain credentials or user data.
export function observePtyDimensions(publish) {
  const call = DaemonChannel.prototype.call;
  DaemonChannel.prototype.call = function (method, ...args) {
    let dimensions;
    if (method === "spawn") {
      const request = args[0];
      dimensions = {
        terminalId: request.id,
        cols: request.options.cols,
        rows: request.options.rows,
      };
    } else if (method === "resize") {
      dimensions = { terminalId: args[0], cols: args[1], rows: args[2] };
    }
    const at = Date.now();
    const result = call.call(this, method, ...args);
    if (dimensions)
      void result.then(
        () =>
          publish({ kind: method, at, appliedAt: Date.now(), ...dimensions }),
        () => {},
      );
    return result;
  };
}
