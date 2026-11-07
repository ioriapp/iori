use super::super::linux_install::quote;
use super::{
    config,
    output::{self, Failure, parse_line},
    platform,
    remote::{self, Shell},
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Emitter;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{Mutex, mpsc, oneshot, watch},
};
use zeroize::Zeroizing;

#[derive(Default)]
pub struct State {
    sessions: Mutex<HashMap<String, Session>>,
    answers: Arc<Mutex<HashMap<String, oneshot::Sender<Option<String>>>>>,
}
struct Session {
    commands: mpsc::UnboundedSender<Request>,
    cancel: watch::Sender<bool>,
    done: watch::Receiver<bool>,
    shell: Option<Shell>,
    machine: Value,
}
pub(super) struct Request {
    shell: Shell,
    script: String,
    reply: oneshot::Sender<Result<Vec<Value>, Failure>>,
}
pub(super) fn emit(app: &tauri::AppHandle, id: &str, value: Value) {
    let _ = app.emit("native://ssh-setup", json!({"session": id, "value": value}));
}

#[tauri::command]
pub async fn native_ssh_client() -> Value {
    json!({"available": platform::command().arg("-V").output().await.is_ok()})
}

#[tauri::command]
pub fn native_ssh_candidates() -> Result<Vec<String>, String> {
    config::candidates(&platform::home()?)
}

#[tauri::command]
pub async fn native_ssh_cancel(
    state: tauri::State<'_, State>,
    session: String,
) -> Result<(), String> {
    let mut slots = state.sessions.lock().await;
    if let Some(session) = slots.get_mut(&session) {
        let _ = session.cancel.send(true);
        while !*session.done.borrow() {
            if session.done.changed().await.is_err() {
                break;
            }
        }
    }
    slots.remove(&session);
    Ok(())
}
#[tauri::command]
pub async fn native_ssh_answer(
    state: tauri::State<'_, State>,
    prompt: String,
    answer: Option<String>,
) -> Result<(), String> {
    if let Some(sender) = state.answers.lock().await.remove(&prompt) {
        let _ = sender.send(answer);
    }
    Ok(())
}

#[tauri::command]
pub async fn native_ssh_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    destination: String,
    session: String,
    purpose: String,
) -> Result<Value, Failure> {
    let closed = Arc::new(AtomicBool::new(false));
    emit(&app, &session, json!({"type":"stage","stage":"connect"}));
    let result = connect(
        &app,
        &state,
        &destination,
        &session,
        &purpose,
        closed.clone(),
    )
    .await;
    if let Err(failure) = &result
        && !closed.swap(true, Ordering::SeqCst)
    {
        // Probe failures also own a live SSH process. Close it before reporting
        // a closed session, preserving the original failure rather than cancel.
        let _ = native_ssh_cancel(state, session.clone()).await;
        emit(&app, &session, json!({"type":"closed","failure":failure}));
    }
    result
}

async fn connect(
    app: &tauri::AppHandle,
    state: &State,
    destination: &str,
    session: &str,
    purpose: &str,
    closed: Arc<AtomicBool>,
) -> Result<Value, Failure> {
    let destination = config::destination(destination)?;
    let session = session.to_string();
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|e| e.to_string())?;
    let token = Zeroizing::new(
        iroh::SecretKey::generate()
            .to_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
    );
    // Resolve aliases with OpenSSH itself. Removal guidance must name the
    // known_hosts address, never the user's ~/.ssh/config alias.
    let configuration = platform::command()
        .args(["-G", &destination])
        .output()
        .await
        .map_err(|error| {
            Failure::new(
                if error.kind() == std::io::ErrorKind::NotFound {
                    "clientMissing"
                } else {
                    "probe"
                },
                error.to_string(),
            )
        })?;
    let configuration = String::from_utf8_lossy(&configuration.stdout);
    let hostname = configuration
        .lines()
        .find_map(|line| line.strip_prefix("hostname "))
        .unwrap_or(&destination);
    let port = configuration
        .lines()
        .find_map(|line| line.strip_prefix("port "))
        .unwrap_or("22");
    let address = if port == "22" {
        hostname.to_string()
    } else {
        format!("[{hostname}]:{port}")
    };
    let mut command = platform::command();
    command
        // Enter cmd on Windows before reading the protocol. On Unix the
        // missing cmd.exe is followed by exec sh. Keep cmd's command echo so
        // its prompt cannot share a line with a protocol response.
        .args(["-T", &destination, "cmd.exe /d ; exec sh"])
        .env(
            "SSH_ASKPASS",
            std::env::current_exe().map_err(|e| e.to_string())?,
        )
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("LC_ALL", "C")
        .env(
            "IORI_SSH_ASKPASS_ADDRESS",
            listener
                .local_addr()
                .map_err(|e| e.to_string())?
                .to_string(),
        )
        .env("IORI_SSH_ASKPASS_TOKEN", token.as_str())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if std::env::var_os("DISPLAY").is_none() {
        command.env("DISPLAY", "iori:0");
    }
    let mut slots = state.sessions.lock().await;
    if slots.contains_key(&session) {
        return Err("Cancel the previous SSH connection first".into());
    }
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Failure::new("clientMissing", platform::missing_client())
        } else {
            Failure::new("probe", error.to_string())
        }
    })?;
    let mut input = child
        .stdin
        .take()
        .ok_or("Could not open the SSH input stream")?;
    let output = child
        .stdout
        .take()
        .ok_or("Could not open the SSH output stream")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Could not open the SSH error stream")?;
    let (cancel, cancelled) = watch::channel(false);
    let (done_tx, done) = watch::channel(false);
    let (commands, mut requests) = mpsc::unbounded_channel::<Request>();
    let finish_cancel = cancel.clone();
    slots.insert(
        session.clone(),
        Session {
            commands: commands.clone(),
            cancel,
            done,
            shell: None,
            machine: Value::Null,
        },
    );
    drop(slots);
    let declined = Arc::new(AtomicBool::new(false));
    let ask_declined = declined.clone();
    let decline_cancel = finish_cancel.clone();
    let attempts = Arc::new(Mutex::new(HashMap::<String, u64>::new()));
    let answers = state.answers.clone();
    let ask_app = app.clone();
    let ask_session = session.clone();
    let mut ask_cancel = cancelled.clone();
    let ask_task = tauri::async_runtime::spawn(async move {
        loop {
            let socket = tokio::select! { result = listener.accept() => match result { Ok((socket, _)) => socket, Err(_) => break }, _ = ask_cancel.changed() => break };
            let answers = answers.clone();
            let token = token.clone();
            let app = ask_app.clone();
            let session = ask_session.clone();
            let mut cancel = ask_cancel.clone();
            let declined = ask_declined.clone();
            let decline_cancel = decline_cancel.clone();
            let attempts = attempts.clone();
            tauri::async_runtime::spawn(async move {
                let mut inner_cancel = cancel.clone();
                let result = async {
                    let mut socket = BufReader::new(socket);
                    let mut line = Zeroizing::new(String::new());
                    socket
                        .read_line(&mut line)
                        .await
                        .map_err(|e| e.to_string())?;
                    #[derive(Deserialize)]
                    struct Prompt {
                        token: String,
                        prompt: String,
                        notification: bool,
                    }
                    let request: Prompt = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                    if request.token != *token {
                        return Err("Invalid askpass token".to_string());
                    }
                    let id = iroh::SecretKey::generate().public().to_string();
                    let mut prompt = output::prompt(&id, &request.prompt, request.notification);
                    let mut counts = attempts.lock().await;
                    let count = counts
                        .entry(prompt["kind"].as_str().unwrap_or("other").to_string())
                        .or_default();
                    *count += 1;
                    prompt["attempt"] = json!(*count);
                    drop(counts);
                    if request.notification {
                        emit(&app, &session, json!({"type":"prompt", "prompt":prompt}));
                        let mut closed = String::new();
                        let _ = tokio::select! { result = socket.read_line(&mut closed) => result, _ = inner_cancel.changed() => Ok(0) };
                        emit(&app, &session, json!({"type":"promptClosed", "id":id}));
                        return Ok(());
                    }
                    let (send, receive) = oneshot::channel();
                    answers.lock().await.insert(id.clone(), send);
                    emit(&app, &session, json!({"type":"prompt", "prompt":prompt}));
                    let answer = tokio::select! { answer = receive => answer.unwrap_or(None), _ = inner_cancel.changed() => None };
                    if answer.is_none() && !*inner_cancel.borrow() {
                        declined.store(true, Ordering::SeqCst);
                        let _ = decline_cancel.send(true);
                    }
                    answers.lock().await.remove(&id);
                    emit(&app, &session, json!({"type":"promptClosed", "id":id}));
                    let response = Zeroizing::new(
                        serde_json::to_string(&answer).map_err(|e| e.to_string())? + "\n",
                    );
                    socket
                        .get_mut()
                        .write_all(response.as_bytes())
                        .await
                        .map_err(|e| e.to_string())
                };
                let _ =
                    tokio::select! { result = result => result, _ = cancel.changed() => Ok(()) };
            });
        }
    });
    let last_error = Arc::new(Mutex::new(String::new()));
    let logging = Arc::new(AtomicBool::new(false));
    let stderr_logging = logging.clone();
    let stderr_app = app.clone();
    let stderr_session = session.clone();
    let errors = last_error.clone();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if output::log_line(&line) {
                if stderr_logging.load(Ordering::SeqCst) {
                    emit(
                        &stderr_app,
                        &stderr_session,
                        json!({"type":"output","line":line}),
                    );
                }
                let mut errors = errors.lock().await;
                errors.push_str(&line);
                errors.push('\n');
            }
        }
    });
    let connected_session = session.clone();
    let mut cancel_rx = cancelled;
    let event_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(output).lines();
        let mut pending: Option<oneshot::Sender<Result<Vec<Value>, Failure>>> = None;
        let mut values: Vec<Value> = Vec::new();
        let mut authenticated = false;
        let outcome: Result<(), String> = async {
            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => { break; }
                    request = requests.recv(), if pending.is_none() => {
                        let Some(request) = request else { break };
                        let script = remote::command(request.shell, &request.script);
                        last_error.lock().await.clear();
                        logging.store(!matches!(request.shell, Shell::Probe), Ordering::SeqCst);
                        pending = Some(request.reply);
                        input.write_all(script.as_bytes()).await.map_err(|e| e.to_string())?;
                    }
                    line = lines.next_line() => {
                        let Some(line) = line.map_err(|e| e.to_string())? else { return Err("SSH connection closed".into()) };
                        let parsed = if line.trim() == "IORI_SETUP_PROBE_DONE" { Some(json!({"type":"done","code":0})) } else { parse_line(&line)? };
                        if let Some(value) = parsed {
                            if value["type"] == "done" {
                                if let Some(reply) = pending.take() {
                                    let result = if value["code"] == 0 { Ok(std::mem::take(&mut values)) } else {
                                        let stage = values.iter().find(|v| v["type"] == "error").and_then(|v| v["stage"].as_str()).map(str::to_string);
                                        values.clear();
                                        Err(Failure::command(last_error.lock().await.clone(), stage, value["code"].as_i64().unwrap_or(1) as i32))
                                    };
                                    let _ = reply.send(result);
                                }
                            } else if value["type"] == "stage" || value["type"] == "linger" { emit(&event_app, &session, value); }
                            else { if value["type"] == "machine" { authenticated = true; } values.push(value); }
                        } else if output::log_line(&line) && logging.load(Ordering::SeqCst) {
                            emit(&event_app, &session, json!({"type":"output","line":line}));
                            let mut errors = last_error.lock().await;
                            errors.push_str(&line);
                            errors.push('\n');
                        }
                    }
                }
            }
            Ok(())
        }.await;
        let _ = child.start_kill();
        let status = child.wait().await;
        let _ = stderr_task.await;
        let was_cancelled = *cancel_rx.borrow();
        let failure = if declined.load(Ordering::SeqCst) {
            Failure::new("declined", "")
        } else if was_cancelled {
            Failure::new("cancelled", "")
        } else {
            let detail = last_error.lock().await.clone();
            let detail = if detail.is_empty() {
                outcome.err().unwrap_or_default()
            } else {
                detail
            };
            let code = status.ok().and_then(|status| status.code());
            if authenticated {
                Failure {
                    exit_code: code,
                    ..Failure::new("disconnected", detail)
                }
            } else {
                Failure::connection(detail, code, &address)
            }
        };
        if !closed.swap(true, Ordering::SeqCst) {
            emit(
                &event_app,
                &session,
                json!({"type":"closed", "failure":failure}),
            );
        }
        let _ = finish_cancel.send(true);
        ask_task.abort();
        if let Some(reply) = pending {
            let _ = reply.send(Err(failure));
        }
        let _ = done_tx.send(true);
    });
    let values = request(&commands, Shell::Probe, remote::probe()).await?;
    let mut machine = values
        .iter()
        .find(|v| v["type"] == "machine" && v["os"] == "TGludXg=")
        .or_else(|| {
            values
                .iter()
                .find(|v| v["type"] == "machine" && v["os"] == "V2luZG93cw==")
        })
        .or_else(|| values.iter().find(|v| v["type"] == "machine"))
        .cloned()
        .ok_or("Missing SSH destination information")?;
    for key in ["os", "cpu", "user", "home"] {
        let decoded = machine[key]
            .as_str()
            .and_then(|value| base64::engine::general_purpose::STANDARD.decode(value).ok())
            .and_then(|bytes| String::from_utf8(bytes).ok());
        machine[key] = match decoded {
            Some(value) => Value::String(value),
            None if key == "user" || key == "home" => Value::Null,
            None => return Err("Invalid SSH destination information".into()),
        };
    }
    if !machine["installed"].is_boolean() {
        return Err("Invalid SSH destination information".into());
    }
    let shell = if machine["os"] == "Windows" {
        Shell::Windows
    } else {
        Shell::Linux
    };
    if let Some(connection) = state.sessions.lock().await.get_mut(&connected_session) {
        connection.shell = Some(shell);
    }
    machine["arch"] = json!(match machine["cpu"]
        .as_str()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "x86_64" | "amd64" => "x64",
        "aarch64" | "arm64" => "arm64",
        _ => "other",
    });
    let host = if purpose != "uninstall" && machine["installed"] == true {
        match request(&commands, shell, remote::control(shell, "host.info")).await {
            Ok(values) => Some(values),
            Err(failure) if failure.kind == "install" => None,
            Err(failure) => return Err(failure),
        }
    } else {
        None
    };
    if let Some(host) = host.as_ref().and_then(|values| {
        values
            .iter()
            .find(|v| v["type"] == "control" && v["ok"] == true)
    }) {
        machine["host"] = host["result"].clone();
    }
    for key in ["user", "home"] {
        if machine[key].is_null() {
            machine.as_object_mut().unwrap().remove(key);
        }
    }
    if let Some(connection) = state.sessions.lock().await.get_mut(&connected_session) {
        connection.machine = machine.clone();
    }
    Ok(machine)
}
pub(super) async fn request(
    commands: &mpsc::UnboundedSender<Request>,
    shell: Shell,
    script: String,
) -> Result<Vec<Value>, Failure> {
    let (reply, receive) = oneshot::channel();
    commands
        .send(Request {
            shell,
            script,
            reply,
        })
        .map_err(|_| Failure::new("disconnected", "SSH connection closed"))?;
    receive
        .await
        .map_err(|_| Failure::new("disconnected", "SSH connection closed"))?
}

#[tauri::command]
pub async fn native_ssh_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    session: String,
    mode: String,
) -> Result<Value, Failure> {
    let (commands, shell, machine) = {
        let slots = state.sessions.lock().await;
        let connection = slots
            .get(&session)
            .ok_or_else(|| Failure::new("disconnected", "SSH connection closed"))?;
        (
            connection.commands.clone(),
            connection
                .shell
                .ok_or("Missing SSH destination information")?,
            connection.machine.clone(),
        )
    };
    let host_version = machine["host"]["version"].as_str();
    let result = async {
        if matches!(shell, Shell::Windows) {
            let administrator = machine["administrator"] == true;
            if mode == "install" && !administrator {
                return Err(Failure::new(
                    "probe",
                    "Administrator privileges are required",
                ));
            }
            return super::windows::install(&app, &session, &commands, &mode, administrator).await;
        }
        if mode == "install" || mode == "update" {
            emit(
                &app,
                &session,
                json!({"type":"stage","stage":"verification"}),
            );
            request(
                &commands,
                shell,
                super::super::linux_install::installer(&app)
                    .await
                    .map_err(|detail| Failure {
                        stage: Some("verification".into()),
                        ..Failure::new("install", detail)
                    })?,
            )
            .await?;
        } else if machine["host"].is_null() {
            emit(&app, &session, json!({"type":"stage","stage":"start"}));
            request(
                &commands,
                shell,
                super::super::linux_install::START_EXISTING.into(),
            )
            .await
            .map_err(|mut failure| {
                if failure.kind == "install" {
                    failure.stage = Some("start".into());
                }
                failure
            })?;
        }
        emit(&app, &session, json!({"type":"stage","stage":"register"}));
        let values = request(&commands, shell, remote::control(shell, "invite.create")).await?;
        invite(&values)
    }
    .await;
    result.map_err(|mut failure: Failure| {
        if failure.kind == "control"
            && failure.stage.as_deref() == Some("register")
            && mode == "register"
            && let Some(version) = host_version
            && semver::Version::parse(version)
                .is_ok_and(|version| version < app.package_info().version)
        {
            failure.kind = "controlOutdated";
            failure.host_version = Some(version.into());
        }
        failure
    })
}

pub(super) fn invite(values: &[Value]) -> Result<Value, Failure> {
    let response = values
        .iter()
        .find(|v| v["type"] == "control")
        .ok_or_else(|| Failure::new("control", "Host did not respond"))?;
    if response["ok"] != true {
        return Err(Failure {
            stage: Some("register".into()),
            ..Failure::new(
                "control",
                response["error"]["message"]
                    .as_str()
                    .unwrap_or("Host did not respond"),
            )
        });
    }
    Ok(json!({"type":"invite", "invite":response["result"]["invite"]}))
}

#[tauri::command]
pub async fn native_ssh_uninstall_result(
    state: tauri::State<'_, State>,
    session: String,
    receipt_path: String,
    remove: bool,
) -> Result<Value, String> {
    let (commands, shell) = {
        let slots = state.sessions.lock().await;
        let connection = slots.get(&session).ok_or("SSH connection closed")?;
        (
            connection.commands.clone(),
            connection
                .shell
                .ok_or("Missing SSH destination information")?,
        )
    };
    let script = if matches!(shell, Shell::Windows) {
        format!(
            "$file={};if(Test-Path -LiteralPath $file){{[Console]::WriteLine('IORI_SETUP ' + [IO.File]::ReadAllText($file))}}",
            remote::literal(&receipt_path)
        )
    } else {
        format!(
            "file={}; if [ -f \"$file\" ]; then printf 'IORI_SETUP '; cat -- \"$file\"; printf '\\n'; fi",
            quote(&receipt_path)
        )
    };
    let values = request(&commands, shell, script)
        .await
        .map_err(|failure| failure.detail)?;
    let Some(value) = values.first() else {
        return Ok(Value::Null);
    };
    if remove {
        let script = if matches!(shell, Shell::Windows) {
            format!(
                "Remove-Item -LiteralPath {} -Force",
                remote::literal(&receipt_path)
            )
        } else {
            format!("rm -f -- {}", quote(&receipt_path))
        };
        request(&commands, shell, script)
            .await
            .map_err(|failure| failure.detail)?;
    }
    Ok(value["status"].clone())
}
