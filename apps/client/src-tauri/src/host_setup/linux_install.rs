use serde_json::Value;

pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

// Both local and SSH setup use the signed release for this Client's version.
pub async fn asset_hash(app: &tauri::AppHandle, asset_name: &str) -> Result<String, String> {
    let client = crate::updates::http(reqwest::Client::builder())
        .build()
        .map_err(|e| e.to_string())?;
    let base = format!(
        "{}v{}/",
        crate::updates::distribution(),
        app.package_info().version
    );
    let bytes = client
        .get(format!("{base}release.json"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let signature = client
        .get(format!("{base}release.json.sig"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let manifest: Value = crate::updates::release::verify(&bytes, &signature)?;
    if manifest["version"].as_str() != Some(&app.package_info().version.to_string()) {
        return Err("Release version does not match this Client".into());
    }
    let hash = manifest["assets"]
        .as_array()
        .and_then(|assets| assets.iter().find(|a| a["name"] == asset_name))
        .and_then(|a| a["sha256"].as_str())
        .ok_or(if asset_name == "iori-host-linux-x64.tar.gz" {
            "Missing Linux Host release"
        } else {
            "Could not verify iori Host. Retry downloading."
        })?;
    if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid release SHA-256".into());
    }
    Ok(hash.to_string())
}

pub async fn installer(app: &tauri::AppHandle) -> Result<String, String> {
    let hash = asset_hash(app, "iori-host-linux-x64.tar.gz").await?;
    Ok(format!(
        "IORI_SETUP_CLIENT=1 IORI_VERSION={} IORI_EXPECTED_SHA256={} sh -c {} </dev/null",
        quote(&app.package_info().version.to_string()),
        quote(&hash),
        quote(
            &include_str!("../../../../../scripts/release/install.sh").replace(
                "__IORI_RELEASE_SOURCE__",
                include_str!("../../../../../release-source.txt").trim(),
            )
        )
    ))
}

pub const START_EXISTING: &str = r#"if ! loginctl --no-ask-password enable-linger "$(id -un)"; then
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" = no ]; then
    printf 'IORI_SETUP {"type":"linger","enabled":false}\n'
  fi
fi
systemctl --user start iori-host.service </dev/null"#;
