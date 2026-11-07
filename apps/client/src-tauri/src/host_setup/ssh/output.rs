use serde::Serialize;
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub kind: &'static str,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_version: Option<String>,
}
impl Failure {
    pub fn new(kind: &'static str, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
            stage: None,
            exit_code: None,
            address: None,
            host_version: None,
        }
    }
    pub fn connection(detail: String, code: Option<i32>, address: &str) -> Self {
        let kind = if detail.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
            || detail.contains("Host key verification failed")
        {
            "hostKeyChanged"
        } else if detail.contains("Connection refused") {
            "refused"
        } else if detail.contains("Could not resolve hostname") {
            "unresolved"
        } else if detail.contains("Connection timed out")
            || detail.contains("Operation timed out")
            || detail.contains("No route to host")
        {
            "timeout"
        } else if detail.contains("Permission denied")
            || detail.contains("Too many authentication failures")
        {
            "authFailed"
        } else {
            "disconnected"
        };
        let mut failure = Self::new(kind, detail);
        failure.exit_code = code;
        if kind == "hostKeyChanged" {
            failure.address = Some(address.into());
        }
        failure
    }
    pub fn command(detail: String, stage: Option<String>, code: i32) -> Self {
        let kind = if detail.contains("curl or wget is required") {
            "downloadTools"
        } else {
            "install"
        };
        Self {
            stage,
            exit_code: Some(code),
            ..Self::new(kind, detail)
        }
    }
}
impl From<String> for Failure {
    fn from(detail: String) -> Self {
        Self::new("probe", detail)
    }
}
impl From<&str> for Failure {
    fn from(detail: &str) -> Self {
        Self::new("probe", detail)
    }
}

pub fn parse_line(line: &str) -> Result<Option<Value>, String> {
    line.strip_prefix("IORI_SETUP ")
        .map(|json| {
            serde_json::from_str(json)
                .map_err(|_| "Invalid response from the SSH destination".into())
        })
        .transpose()
}

// The Windows shell echoes the transferred script (including encoded control
// commands). Only actual script output belongs in the visible log.
pub fn log_line(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && !line.contains("-EncodedCommand")
        && !line.starts_with("IORI_SETUP ")
        && !(trimmed.as_bytes().get(1) == Some(&b':') && trimmed.contains('>'))
}

pub fn prompt(id: &str, text: &str, notification: bool) -> Value {
    let mut value = json!({"id":id,"kind":"other","text":text,"attempt":1});
    if notification {
        value["kind"] = json!("notification");
    } else if let Some(rest) = text.strip_prefix("Enter passphrase for key '") {
        value["kind"] = json!("passphrase");
        if let Some(key) = rest.strip_suffix("': ").or_else(|| rest.strip_suffix("':")) {
            value["key"] = json!(key);
        }
    } else if let Some(login) = text.trim_end().strip_suffix("'s password:") {
        value["kind"] = json!("password");
        if let Some((user, host)) = login.rsplit_once('@') {
            value["user"] = json!(user);
            value["host"] = json!(host);
        } else {
            value["host"] = json!(login);
        }
    } else if let Some(rest) = text.strip_prefix("The authenticity of host '") {
        value["kind"] = json!("hostKeyNew");
        if let Some((target, _)) = rest.split_once('\'') {
            if let Some((host, address)) = target.rsplit_once(" (") {
                value["host"] = json!(host);
                value["address"] = json!(address.trim_end_matches(')'));
            } else {
                value["host"] = json!(target);
            }
        }
        for line in text.lines() {
            if let Some((algorithm, fingerprint)) = line.split_once(" key fingerprint is ") {
                value["fingerprint"] =
                    json!(format!("{algorithm} {}", fingerprint.trim_end_matches('.')));
                break;
            }
        }
    }
    value
}
