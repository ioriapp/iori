use super::super::linux_install::quote;
use super::{
    config,
    output::parse_line,
    platform,
    remote::{self, Shell},
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashMap, process::Stdio, sync::Arc};
use tauri::Emitter;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{Mutex, mpsc, oneshot, watch},
};
use zeroize::Zeroizing;

#[derive(Default)]
pub struct State {
    session: Mutex<Option<Session>>,
    answers: Arc<Mutex<HashMap<String, oneshot::Sender<Option<String>>>>>,
}
struct Session {
    id: String,
    commands: mpsc::UnboundedSender<Request>,
    cancel: watch::Sender<bool>,
    done: watch::Receiver<bool>,
    shell: Option<Shell>,
}
pub(super) struct Request {
    shell: Shell,
    script: String,
    reply: oneshot::Sender<Result<Vec<Value>, String>>,
}
pub(super) fn emit(app: &tauri::AppHandle, id: &str, value: Value) {
    let _ = app.emit("native://ssh-setup", json!({"session": id, "value": value}));
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
    let mut slot = state.session.lock().await;
    if slot.as_ref().is_none_or(|current| current.id != session) {
        return Ok(());
    }
    if let Some(session) = slot.as_mut() {
        let _ = session.cancel.send(true);
        while !*session.done.borrow() {
            if session.done.changed().await.is_err() {
                break;
            }
        }
    }
    *slot = None;
    state.answers.lock().await.clear();
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
) -> Result<Value, String> {
    let destination = config::destination(&destination)?;
    let mut slot = state.session.lock().await;
    if slot.is_some() {
        return Err("Cancel the previous SSH connection first".into());
    }
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
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            platform::missing_client().into()
        } else {
            error.to_string()
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
    *slot = Some(Session {
        id: session.clone(),
        commands: commands.clone(),
        cancel,
        done,
        shell: None,
    });
    drop(slot);
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
                    if request.notification {
                        emit(
                            &app,
                            &session,
                            json!({"type":"prompt", "id":id, "prompt":request.prompt, "notification":true}),
                        );
                        let mut closed = String::new();
                        let _ = tokio::select! { result = socket.read_line(&mut closed) => result, _ = inner_cancel.changed() => Ok(0) };
                        emit(&app, &session, json!({"type":"promptClosed", "id":id}));
                        return Ok(());
                    }
                    let (send, receive) = oneshot::channel();
                    answers.lock().await.insert(id.clone(), send);
                    emit(
                        &app,
                        &session,
                        json!({"type":"prompt", "id":id, "prompt":request.prompt}),
                    );
                    let answer = tokio::select! { answer = receive => answer.unwrap_or(None), _ = inner_cancel.changed() => None };
                    answers.lock().await.remove(&id);
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
    let errors = last_error.clone();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                *errors.lock().await = line;
            }
        }
    });
    let connected_session = session.clone();
    let mut cancel_rx = cancelled;
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(output).lines();
        let mut pending: Option<oneshot::Sender<Result<Vec<Value>, String>>> = None;
        let mut values: Vec<Value> = Vec::new();
        let outcome: Result<(), String> = async {
            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => { break; }
                    request = requests.recv(), if pending.is_none() => {
                        let Some(request) = request else { break };
                        let script = remote::command(request.shell, &request.script);
                        last_error.lock().await.clear();
                        pending = Some(request.reply);
                        input.write_all(script.as_bytes()).await.map_err(|e| e.to_string())?;
                    }
                    line = lines.next_line() => {
                        let Some(line) = line.map_err(|e| e.to_string())? else { return Err("SSH connection closed".into()) };
                        let parsed = if line.trim() == "IORI_SETUP_PROBE_DONE" { Some(json!({"type":"done","code":0})) } else { parse_line(&line)? };
                        if let Some(value) = parsed {
                            if value["type"] == "done" {
                                if let Some(reply) = pending.take() {
                                    let result = if value["code"] == 0 { Ok(std::mem::take(&mut values)) } else { let stage = values.iter().find(|v| v["type"] == "error").and_then(|v| v["stage"].as_str()).unwrap_or("command").to_string(); values.clear(); Err(format!("SSH_COMMAND_FAILED:{}:{stage}\n{}", value["code"], last_error.lock().await)) };
                                    let _ = reply.send(result);
                                }
                            } else if value["type"] == "stage" || value["type"] == "linger" || (value["type"] == "firewall" && value["command"].is_string()) { emit(&app, &session, value); }
                            else { values.push(value); }
                        } else if !line.trim().is_empty() { *last_error.lock().await = line; }
                    }
                }
            }
            Ok(())
        }.await;
        let _ = child.start_kill();
        let status = child.wait().await;
        let _ = stderr_task.await;
        let was_cancelled = *cancel_rx.borrow();
        let message = if was_cancelled {
            "Cancelled".into()
        } else {
            let detail = last_error.lock().await.clone();
            let detail = if detail.is_empty() {
                outcome.err().unwrap_or_default()
            } else {
                detail
            };
            match status {
                Ok(status) => match status.code() {
                    Some(code) => format!("SSH_EXIT:{code}\n{detail}"),
                    None => format!("SSH_CLOSED\n{detail}"),
                },
                Err(error) => format!("SSH_CLOSED\n{error}: {detail}"),
            }
        };
        if !was_cancelled {
            emit(&app, &session, json!({"type":"closed", "message":message}));
        }
        let _ = finish_cancel.send(true);
        ask_task.abort();
        if let Some(reply) = pending {
            let _ = reply.send(Err(message));
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
    if let Some(connection) = state
        .session
        .lock()
        .await
        .as_mut()
        .filter(|s| s.id == connected_session)
    {
        connection.shell = Some(shell);
    }
    let host = if machine["installed"] == true {
        request(&commands, shell, remote::control(shell, "host.info"))
            .await
            .ok()
    } else {
        None
    };
    machine["host"] = host
        .as_ref()
        .and_then(|values| {
            values
                .iter()
                .find(|v| v["type"] == "control" && v["ok"] == true)
        })
        .map(|v| v["result"].clone())
        .unwrap_or(Value::Null);
    Ok(machine)
}
pub(super) async fn request(
    commands: &mpsc::UnboundedSender<Request>,
    shell: Shell,
    script: String,
) -> Result<Vec<Value>, String> {
    let (reply, receive) = oneshot::channel();
    commands
        .send(Request {
            shell,
            script,
            reply,
        })
        .map_err(|_| "SSH connection closed")?;
    receive.await.map_err(|_| "SSH connection closed")?
}

#[tauri::command]
pub async fn native_ssh_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    session: String,
    installed: bool,
    running: bool,
    allow_connections: bool,
) -> Result<Value, String> {
    let (commands, shell) = {
        let slot = state.session.lock().await;
        let connection = slot
            .as_ref()
            .filter(|s| s.id == session)
            .ok_or("SSH connection closed")?;
        (
            connection.commands.clone(),
            connection
                .shell
                .ok_or("Missing SSH destination information")?,
        )
    };
    if matches!(shell, Shell::Windows) {
        return super::windows::install(
            &app,
            &session,
            &commands,
            installed,
            running,
            allow_connections,
        )
        .await;
    }
    if !installed {
        emit(
            &app,
            &session,
            json!({"type":"stage","stage":"verification"}),
        );
        request(
            &commands,
            shell,
            super::super::linux_install::installer(&app).await?,
        )
        .await?;
    } else if !running {
        request(
            &commands,
            shell,
            super::super::linux_install::START_EXISTING.into(),
        )
        .await?;
    }
    emit(&app, &session, json!({"type":"stage","stage":"register"}));
    let values = request(&commands, shell, remote::control(shell, "invite.create")).await?;
    let response = values
        .iter()
        .find(|v| v["type"] == "control")
        .ok_or("Host did not respond")?;
    if response["ok"] != true {
        return Err(format!(
            "IORI_CONTROL_ERROR: {}",
            response["error"]["message"]
                .as_str()
                .unwrap_or("Host did not respond")
        ));
    }
    Ok(response["result"].clone())
}

#[tauri::command]
pub async fn native_ssh_uninstall_result(
    state: tauri::State<'_, State>,
    session: String,
    receipt_path: String,
    remove: bool,
) -> Result<Value, String> {
    let (commands, shell) = {
        let slot = state.session.lock().await;
        let connection = slot
            .as_ref()
            .filter(|s| s.id == session)
            .ok_or("SSH connection closed")?;
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
    let values = request(&commands, shell, script).await?;
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
        request(&commands, shell, script).await?;
    }
    Ok(value["status"].clone())
}
