import { createContext, useContext, useState } from "react";
import { useCurrentIconDefinition, useHostIcon } from "./cli-icon-images.ts";
import { Bot } from "lucide-react";
import type { CliSummary } from "@iori/protocol";

export const CliIconHost = createContext("");

// Bundled names only select local assets. User icons come from Host bytes.
const assets = import.meta.glob<string>(
  "../third-party/cli-icons/*.{svg,png}",
  { eager: true, query: "?url", import: "default" },
);

/** Unknown/custom CLIs use the incumbent Bot icon, distinct from a shell. */
export function CliIcon({
  cli,
  size = 16,
  hostKey,
}: {
  cli: CliSummary;
  size?: number;
  hostKey?: string;
}) {
  const contextHost = useContext(CliIconHost);
  const host = hostKey ?? contextHost;
  const current = useCurrentIconDefinition(host, cli);
  const icon = current.icon;
  const hostLight = useHostIcon(
    host,
    icon?.source === "host" ? icon.light : undefined,
  );
  const hostDark = useHostIcon(
    host,
    icon?.source === "host" ? icon.dark : undefined,
  );
  const light =
    icon?.source === "host"
      ? hostLight
      : assets[`../third-party/cli-icons/${icon?.light}`];
  const dark =
    (icon?.source === "host"
      ? hostDark
      : assets[`../third-party/cli-icons/${icon?.dark}`]) ?? light;
  const [failed, setFailed] = useState<string>();
  const source = `${light}\0${dark}`;
  const loading =
    icon?.source === "host" &&
    (hostLight === undefined || (!!icon.dark && hostDark === undefined));
  const frame = { width: size, height: size };
  if (loading)
    return <span className="cli-icon" style={frame} aria-hidden="true" />;
  if (!light || failed === source)
    return (
      <span className="cli-icon" style={frame} aria-hidden="true">
        <Bot size={size} style={{ width: "100%", height: "100%" }} />
      </span>
    );
  return (
    <span className="cli-icon" style={frame} aria-hidden="true">
      <img
        onError={() => setFailed(source)}
        className="cli-icon-light"
        src={light}
        width={size}
        height={size}
        alt=""
      />
      <img
        onError={() => setFailed(source)}
        className="cli-icon-dark"
        src={dark ?? light}
        width={size}
        height={size}
        alt=""
      />
    </span>
  );
}
