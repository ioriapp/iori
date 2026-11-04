use serde_json::Value;

pub fn parse_line(line: &str) -> Result<Option<Value>, String> {
    line.strip_prefix("IORI_SETUP ")
        .map(|json| {
            serde_json::from_str(json)
                .map_err(|_| "Invalid response from the SSH destination".into())
        })
        .transpose()
}
