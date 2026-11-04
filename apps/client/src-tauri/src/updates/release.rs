use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::de::DeserializeOwned;

pub(crate) fn verify<T: DeserializeOwned>(bytes: &[u8], signature: &[u8]) -> Result<T, String> {
    let key: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(include_str!("../../../../../release-public-key.txt").trim())
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Invalid release public key")?;
    VerifyingKey::from_bytes(&key)
        .map_err(|e| e.to_string())?
        .verify_strict(
            bytes,
            &Signature::from_slice(signature).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}

pub(crate) fn allowed(url: &reqwest::Url, source: &reqwest::Url) -> bool {
    let hosts: Vec<&str> =
        serde_json::from_str(include_str!("../../../../../release-redirect-hosts.json"))
            .expect("Release redirect hosts");
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && (url.origin() == source.origin()
            || (url.port().is_none() && url.host_str().is_some_and(|host| hosts.contains(&host))))
}

#[derive(serde::Deserialize)]
pub(crate) struct GithubRelease {
    tag_name: String,
    draft: bool,
}

pub(crate) fn newest(releases: &[GithubRelease]) -> Option<semver::Version> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            release
                .tag_name
                .strip_prefix('v')
                .and_then(|tag| tag.parse::<semver::Version>().ok())
        })
        .max_by(|a, b| a.cmp_precedence(b))
}

fn api(source: &str) -> Result<reqwest::Url, String> {
    let source = reqwest::Url::parse(source).map_err(|e| e.to_string())?;
    let segments: Vec<_> = source
        .path()
        .trim_end_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    if source.scheme() != "https"
        || source.host_str() != Some("github.com")
        || segments.len() != 3
        || segments[2] != "releases"
    {
        return Err("Release source is not a GitHub repository".into());
    }
    reqwest::Url::parse(&format!(
        "https://api.github.com/repos/{}/{}/releases?per_page=100",
        segments[0], segments[1]
    ))
    .map_err(|e| e.to_string())
}

pub(crate) fn client() -> Result<reqwest::Client, super::Failure> {
    let builder = reqwest::Client::builder().user_agent("iori");
    #[cfg(target_os = "android")]
    let builder = {
        // Android's platform verifier needs a separate JVM integration.
        let certificates = webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .map(|certificate| reqwest::Certificate::from_der(certificate.as_ref()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| super::Failure::Source.log(e))?;
        builder.tls_certs_only(certificates)
    };
    super::http(builder)
        .build()
        .map_err(|e| super::Failure::Source.log(e))
}

pub(crate) async fn endpoint(
    development: bool,
    name: &str,
) -> Result<Option<String>, super::Failure> {
    let source = super::RELEASES.trim();
    if !development {
        return Ok(Some(format!("{source}/latest/download/{name}")));
    }
    // One list request per check; stable checks do not use the API.
    let response = client()?
        .get(api(source).map_err(|e| super::Failure::Source.log(e))?)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| super::Failure::Source.log(e))?
        .error_for_status()
        .map_err(|e| super::Failure::Source.log(e))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| super::Failure::Source.log(e))?;
    let releases: Vec<GithubRelease> =
        serde_json::from_slice(&bytes).map_err(|e| super::Failure::Source.log(e))?;
    Ok(newest(&releases).map(|version| format!("{source}/download/v{version}/{name}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_release_uses_semver_and_includes_prereleases_but_not_drafts() {
        let releases = serde_json::from_str::<Vec<GithubRelease>>(
            r#"[
            {"tag_name":"v1.9.0", "draft":false},
            {"tag_name":"v2.0.0-beta.2", "draft":false},
            {"tag_name":"v2.0.0-beta.11", "draft":false},
            {"tag_name":"v3.0.0", "draft":true},
            {"tag_name":"not-a-version", "draft":false}
        ]"#,
        )
        .unwrap();
        assert_eq!(newest(&releases).unwrap().to_string(), "2.0.0-beta.11");
        assert!(newest(&[]).is_none());
        let stable = GithubRelease {
            tag_name: "v2.0.0".into(),
            draft: false,
        };
        assert_eq!(
            newest(&[releases.into_iter().nth(2).unwrap(), stable])
                .unwrap()
                .to_string(),
            "2.0.0"
        );
    }

    #[test]
    fn redirects_only_allow_https_source_origin_or_exact_asset_hosts() {
        let source = reqwest::Url::parse("https://github.com/example/fork/releases").unwrap();
        for (url, expected) in [
            (
                "https://github.com/example/fork/releases/download/v1.0.0/release.json",
                true,
            ),
            (
                "https://release-assets.githubusercontent.com/github-production-release-asset/123?signature=example",
                true,
            ),
            ("http://release-assets.githubusercontent.com/asset", false),
            (
                "https://release-assets.githubusercontent.com.attacker.test/asset",
                false,
            ),
            ("https://attacker.test/asset", false),
            (
                "https://release-assets.githubusercontent.com:444/asset",
                false,
            ),
            (
                "https://user@release-assets.githubusercontent.com/asset",
                false,
            ),
            (
                "http://github.com/example/fork/releases/download/v1.0.0/release.json",
                false,
            ),
        ] {
            assert_eq!(
                allowed(&reqwest::Url::parse(url).unwrap(), &source),
                expected,
                "{url}"
            );
        }
    }
}
