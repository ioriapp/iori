use notify::{RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::{
    env, fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::mpsc,
};
use uuid::Uuid;

fn failure(message: &str) -> io::Error {
    io::Error::other(message)
}

struct ExchangeFiles {
    temporary: PathBuf,
    response: PathBuf,
}
impl Drop for ExchangeFiles {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.temporary);
        let _ = fs::remove_file(&self.response);
    }
}

fn exchange(directory: &Path, envelope: &Value) -> io::Result<Value> {
    let id = Uuid::new_v4();
    let request = directory.join(format!("{id}.request.json"));
    let files = ExchangeFiles {
        temporary: directory.join(format!("{id}.request.json.tmp")),
        response: directory.join(format!("{id}.response.json")),
    };
    let (sender, changes) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(sender)
        .map_err(|_| failure("Could not watch the iori command response."))?;
    // Watch before publishing; also watch the parent to observe session removal.
    for path in [Some(directory), directory.parent()].into_iter().flatten() {
        watcher
            .watch(path, RecursiveMode::NonRecursive)
            .map_err(|_| failure("The iori team CLI session has ended."))?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&files.temporary)?;
    output.write_all(&serde_json::to_vec(envelope)?)?;
    drop(output);
    fs::rename(&files.temporary, request)?;
    loop {
        match fs::read(&files.response) {
            Ok(bytes) => {
                return serde_json::from_slice(&bytes)
                    .map_err(|_| failure("Could not read the iori command response."));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if !directory.try_exists()? {
                    return Err(failure("The iori team CLI session has ended."));
                }
            }
            Err(_) => return Err(failure("Could not read the iori command response.")),
        }
        // Completion is driven by filesystem events, without a time limit.
        match changes.recv() {
            Ok(Ok(_)) => {}
            _ => return Err(failure("The iori team CLI session has ended.")),
        }
    }
}

fn run() -> io::Result<i32> {
    let mut argv: Vec<String> = env::args_os()
        .skip(1)
        .map(|argument| {
            argument
                .into_string()
                .map_err(|_| failure("Invalid command argument."))
        })
        .collect::<io::Result<_>>()?;
    let json_output = argv.iter().any(|argument| argument == "--json");
    argv.retain(|argument| argument != "--json");
    if let Some(index) = argv.iter().position(|argument| argument == "--file") {
        let file = argv
            .get(index + 1)
            .filter(|file| !file.is_empty())
            .ok_or_else(|| failure("Use one of --body or --file."))?;
        if argv.iter().any(|argument| argument == "--body") {
            return Err(failure("Use one of --body or --file."));
        }
        let root = fs::canonicalize(env::current_dir()?)?;
        let file = fs::canonicalize(file)?;
        if !file.starts_with(root) {
            return Err(failure(
                "--file は作業フォルダーの中のファイルだけ読めます。他は --body - で渡してください",
            ));
        }
        let body = String::from_utf8_lossy(&fs::read(file)?).into_owned();
        argv.splice(index..index + 2, ["--body".into(), body]);
    }
    if let Some(index) = argv.iter().position(|argument| argument == "--body")
        && argv.get(index + 1).is_some_and(|body| body == "-")
    {
        let mut bytes = Vec::new();
        io::stdin().read_to_end(&mut bytes)?;
        argv[index + 1] = String::from_utf8_lossy(&bytes).into_owned();
    }
    let required = |name| {
        env::var(name)
            .ok()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| failure("iori is available in an iori team CLI only."))
    };
    let directory = required("IORI_COMMAND_DIRECTORY")?;
    let auth = required("IORI_COMMAND_AUTH")?;
    let session = required("IORI_COMMAND_SESSION")?;
    let result = exchange(
        Path::new(&directory),
        &json!({ "session": session, "auth": auth, "argv": argv }),
    )?;
    let ok = result["ok"].as_bool().unwrap_or(false);
    let output = if json_output {
        let value = match result.get("data") {
            Some(data) => json!({ "ok": ok, "data": data }),
            None => json!({ "ok": ok, "text": result["text"] }),
        };
        serde_json::to_string(&value)?
    } else {
        result["text"].as_str().unwrap_or("").to_owned()
    };
    writeln!(io::stdout().lock(), "{output}")?;
    Ok(if ok { 0 } else { 1 })
}

fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            // Never print the routing environment or request envelope.
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
