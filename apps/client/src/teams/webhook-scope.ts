export type WebhookScope = "lan" | "local";

/** A Windows Host opens its firewall only for the UDP connection, so a
 * Webhook from the LAN would not arrive. It is offered this machine only. */
export function webhookScopes(hostOs: string | undefined): WebhookScope[] {
  return hostOs === "Windows" ? ["local"] : ["lan", "local"];
}
