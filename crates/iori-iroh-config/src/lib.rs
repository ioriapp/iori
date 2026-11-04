use std::net::SocketAddr;

use iroh::{
    SecretKey,
    endpoint::{Builder, PortmapperConfig, QuicTransportConfig, RelayMode},
};

pub const ALPN: &[u8] = b"iori";

pub fn endpoint_builder(
    secret_key: SecretKey,
    bind_addresses: &[SocketAddr],
    relays: Vec<iroh::RelayConfig>,
) -> Result<Builder, String> {
    if bind_addresses.is_empty() {
        return Err("at least one explicit bind address is required".to_owned());
    }

    let mut has_ipv4 = false;
    let mut has_ipv6 = false;
    for address in bind_addresses {
        let family_seen = if address.is_ipv4() {
            &mut has_ipv4
        } else {
            &mut has_ipv6
        };
        if *family_seen {
            return Err(format!(
                "at most one bind address per IP family is supported: {address}"
            ));
        }
        *family_seen = true;
    }

    let transport_config = QuicTransportConfig::builder()
        .enable_segmentation_offload(false)
        .mtu_discovery_config(None)
        .build();
    let mut builder = Builder::new(iroh::endpoint::presets::Minimal)
        .clear_address_lookup()
        .relay_mode(if relays.is_empty() {
            RelayMode::Disabled
        } else {
            RelayMode::Custom(relays.into_iter().collect())
        })
        .portmapper_config(PortmapperConfig::Disabled)
        .clear_ip_transports()
        .secret_key(secret_key)
        .alpns(vec![ALPN.to_vec()])
        .transport_config(transport_config);

    for address in bind_addresses {
        builder = builder
            .bind_addr(*address)
            .map_err(|error| error.to_string())?;
    }

    Ok(builder)
}

/// Parse credentials without including secrets in errors.
pub fn relay_config(url: &str, token: Option<&str>) -> Result<iroh::RelayConfig, String> {
    let url: iroh::RelayUrl = url.parse().map_err(|_| "invalid Relay URL".to_owned())?;
    let mut config = iroh::RelayConfig::from(url);
    if let Some(token) = token {
        config = config.with_auth_token(token);
    }
    Ok(config)
}
