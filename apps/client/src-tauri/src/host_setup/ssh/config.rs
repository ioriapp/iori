use std::{collections::HashSet, path::Path};

pub fn destination(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.starts_with('-')
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Enter [user@]host or ssh://[user@]host[:port].".into());
    }
    Ok(value.into())
}

// OpenSSH config tokens allow quoted paths and comments outside quotes.
fn tokens(line: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut token = String::new();
    let mut quoted = false;
    for c in line.chars() {
        match c {
            '"' => quoted = !quoted,
            '#' if !quoted => break,
            '=' if !quoted && result.is_empty() => {
                if !token.is_empty() {
                    result.push(std::mem::take(&mut token));
                }
            }
            c if c.is_whitespace() && !quoted => {
                if !token.is_empty() {
                    result.push(std::mem::take(&mut token));
                }
            }
            c => token.push(c),
        }
    }
    if !token.is_empty() {
        result.push(token);
    }
    result
}
pub fn candidates(home: &Path) -> Result<Vec<String>, String> {
    fn read(
        file: &Path,
        home: &Path,
        stack: &mut HashSet<std::path::PathBuf>,
        names: &mut Vec<String>,
    ) -> Result<(), String> {
        let canonical = match std::fs::canonicalize(file) {
            Ok(path) => path,
            Err(_) => return Ok(()),
        };
        if !stack.insert(canonical.clone()) {
            return Ok(());
        }
        let Ok(bytes) = std::fs::read(file) else {
            stack.remove(&canonical);
            return Ok(());
        };
        let contents = String::from_utf8_lossy(&bytes);
        for line in contents.lines() {
            let parts = tokens(line);
            let Some(key) = parts.first() else { continue };
            if key.eq_ignore_ascii_case("Host") {
                for name in &parts[1..] {
                    if !name.contains(['*', '?', '!']) && !names.contains(name) {
                        names.push(name.clone());
                    }
                }
            } else if key.eq_ignore_ascii_case("Include") {
                for pattern in &parts[1..] {
                    let path = if let Some(tail) = pattern.strip_prefix("~/") {
                        home.join(tail)
                    } else {
                        let path = std::path::PathBuf::from(pattern);
                        if path.is_absolute() {
                            path
                        } else {
                            home.join(".ssh").join(path)
                        }
                    };
                    if let Ok(files) = glob::glob(&path.to_string_lossy()) {
                        for file in files.flatten() {
                            read(&file, home, stack, names)?;
                        }
                    }
                }
            }
        }
        stack.remove(&canonical);
        Ok(())
    }
    let mut names = Vec::new();
    read(
        &home.join(".ssh/config"),
        home,
        &mut HashSet::new(),
        &mut names,
    )?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ssh_destinations_reject_options_whitespace_and_controls() {
        for input in [
            "server",
            "user@server",
            "user@domain@server",
            "ssh://user@server:2222",
            "ssh://user@[::1]:2222",
        ] {
            assert!(destination(input).is_ok(), "{input}");
        }
        for input in ["-oProxyCommand=command", "", "a b", "server\n", "server\0"] {
            assert!(destination(input).is_err(), "{input}");
        }
    }
    #[test]
    fn config_tokens_preserve_quoted_include_paths_and_ignore_comments() {
        assert_eq!(
            tokens("Include \"hosts with spaces/*.conf\" other/* # note"),
            ["Include", "hosts with spaces/*.conf", "other/*"]
        );
        assert_eq!(
            tokens("Host=server other * !excluded"),
            ["Host", "server", "other", "*", "!excluded"]
        );
    }
}
