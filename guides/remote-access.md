# Remote access

[日本語](remote-access.ja.md)

iori Clients connect directly to a Host over a LAN or VPN. When you are away from home, use a VPN that includes both devices, or configure your own iroh relay.

Both methods use the usual iori device registration. A relay only forwards encrypted iori traffic; it does not register a device or grant it access to the Host.

## Use a VPN

This is the simplest option when you can run a VPN on both the Host PC and your phone. The steps below use Tailscale. [WireGuard](https://www.wireguard.com/) or another VPN works the same way when it gives the Host a reachable VPN address and routes traffic from your phone to that address.

### What you need

- iori Host running on a Windows or Linux PC.
- Tailscale installed on the Host PC and your Android phone. Sign both devices in to the same tailnet, with access controls that allow them to connect.
- On Windows, administrator approval to allow iori Host through Windows Firewall.

Install Tailscale using its instructions for [Windows](https://tailscale.com/docs/install/windows), [Linux](https://tailscale.com/docs/install/linux), and [Android](https://tailscale.com/docs/install/android). You do not need a subnet router when Tailscale runs on the Host PC itself.

If iori Host runs inside WSL, first follow [Running iori Host in WSL](wsl.md) for mirrored networking and the Windows Hyper-V firewall rule. For Tailscale, see its [Windows and WSL guidance](https://tailscale.com/docs/install/windows/wsl2); it recommends running Tailscale on Windows rather than inside WSL.

### Set it up

1. Install Tailscale on the Host PC and phone, then sign in to the same tailnet. Confirm that both devices are online.
2. On a Windows Host, open iori Client on the Host PC and select **Allow connections from other devices** in the Host's **Connection** settings. Approve the Windows prompt. This iori firewall rule applies to all network profiles and does not restrict network interfaces, including VPN interfaces. On Linux, allow incoming UDP traffic to the port listed in the Host's **Connection** settings if its firewall blocks it.
3. With Tailscale running on the Host PC, use a registered iori Client to open **Devices** and select **Invite a new device**. On your phone, open iori Client, choose **Connect with an invitation**, then scan the QR code or paste the invitation text.
4. Away from home, connect Tailscale on your phone and open the registered Host in iori Client.

The Host includes IP addresses reported by the operating system, except loopback and IPv4 or IPv6 link-local addresses. This includes Tailscale or WireGuard addresses when the operating system reports them. The Client tries the addresses in the invitation. You do not need to copy the VPN address into iori settings when you create the invitation after the VPN is running.

### If the connection fails

- Confirm that Tailscale is running on both devices, they are in the same tailnet, and the tailnet's access controls allow the connection. See Tailscale's [device connection guide](https://tailscale.com/docs/how-to/connect-to-devices).
- Check the Host firewall and VPN access policy. On Windows, enable **Allow connections from other devices** in the Host's **Connection** settings. The iori rule allows all network profiles and does not limit the interface; another firewall rule or VPN policy can still block the connection. On Linux, allow incoming UDP traffic to the port listed in the Host's **Connection** settings.
- If you created the invitation before the VPN was connected on the Host, create a new invitation after it is connected.
- If the Host's VPN address changed while the Client was disconnected, replace the old IP address in iori Client's **Settings** for that Host under **Connection**, keeping the port shown with the address. When a Client is connected, iori adds address changes it receives from the Host.

## Use your own iroh relay

A relay lets a registered Client reach the Host when a direct connection is unavailable. You run and maintain the relay server; iori does not provide one.

### What you need

- A server running `iroh-relay`, reachable from the internet.
- A DNS name pointing to that server. For the ACME configuration shown in the self-hosting guide, the server must accept traffic on ports 80 and 443 and have a writable certificate directory and a contact email.
- The HTTPS URL for the relay. Use HTTPS for a public server, especially when it requires an access token.

Use the [`iroh-relay` repository documentation](https://github.com/n0-computer/iroh/blob/main/iroh-relay/README.md) for server settings and access modes. The [self-hosting guide](https://docs.iroh.computer/iroh-services/relays/self-hosted) lists available binaries and shows a basic HTTPS configuration. The relay's [health check](https://docs.iroh.computer/iroh-services/relays/self-hosted#simple-health-check) is available at `https://<relay-hostname>/healthz`.

### Set it up

1. Install and start `iroh-relay` on the server. Use its HTTPS URL, for example `https://relay.example.org/`.
2. In iori Client, open the Host's **Connection** settings. Enter the URL in **Relay URL** and, if the relay requires it, enter the same shared token configured on the relay. Save the settings. Registered Clients receive the relay settings from the Host; no relay settings are needed on the phone.
3. If the relay requires a token, register the phone with the Host over the home LAN or a VPN first. Invitations include the relay URL but do not include its token. If the relay does not require a token, you can set its URL before creating an invitation and register the phone through the relay.
4. Open the Host in iori Client from outside the home network. iori tries a direct connection first and uses the relay when a direct path is unavailable. Saving relay settings briefly reconnects the Host's registered Clients.

### If the connection fails

- Open `https://<relay-hostname>/healthz` and confirm that the relay responds. Check that DNS points to the server, HTTPS uses a valid certificate, and the required ports are reachable.
- Confirm that the URL in iori Client matches the running relay and that its access token matches the relay configuration.
- If a token is required, make sure the phone was registered over the LAN or VPN before it tries to use the relay.
- In the Host's **Connection** settings, check whether iori reports the connection route as **Relay** or **Direct**.
