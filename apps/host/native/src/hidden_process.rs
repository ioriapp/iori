use napi::{Error, bindgen_prelude::Buffer};
use napi_derive::napi;

#[napi(object)]
pub struct HiddenProcessOptions {
    pub executable: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Vec<String>,
    pub stdin: bool,
    pub stderr: bool,
    pub verbatim_arguments: bool,
}

#[cfg(any(windows, test))]
fn build_windows_command_line(
    executable: &str,
    args: &[String],
    verbatim_arguments: bool,
) -> Result<Vec<u16>, String> {
    let mut line = String::new();
    for (index, arg) in std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .enumerate()
    {
        if arg.contains('\0') {
            return Err("NUL in process argument".into());
        }
        if index > 0 {
            line.push(' ');
        }
        if (index > 0 && verbatim_arguments) || (!arg.is_empty() && !arg.contains([' ', '\t', '"']))
        {
            line.push_str(arg);
            continue;
        }
        line.push('"');
        let mut slashes = 0;
        for ch in arg.chars() {
            if ch == '\\' {
                slashes += 1;
                continue;
            }
            let count = if ch == '"' { 2 * slashes + 1 } else { slashes };
            line.extend(std::iter::repeat_n('\\', count));
            line.push(ch);
            slashes = 0;
        }
        line.extend(std::iter::repeat_n('\\', 2 * slashes));
        line.push('"');
    }
    Ok(line.encode_utf16().chain([0]).collect())
}

#[cfg(any(windows, test))]
fn build_windows_environment_block(entries: &[String]) -> Result<Vec<u16>, String> {
    let mut sorted = Vec::with_capacity(entries.len());
    for entry in entries {
        // Windows also uses names such as "=C:" for per-drive directories.
        let separator = entry.char_indices().find(|(i, c)| *i > 0 && *c == '=');
        let Some((end, _)) = separator else {
            return Err("expected KEY=VALUE in process environment".into());
        };
        if entry.contains('\0') {
            return Err("NUL in process environment".into());
        }
        sorted.push((entry[..end].to_ascii_uppercase(), entry));
    }
    sorted.sort_by(|(a, _), (b, _)| a.cmp(b));
    let mut block = Vec::new();
    for (_, entry) in sorted {
        block.extend(entry.encode_utf16().chain([0]));
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

#[napi]
pub struct HiddenProcess {
    #[cfg(windows)]
    child: windows::Process,
}

#[cfg(not(windows))]
fn unsupported<T>() -> napi::Result<T> {
    Err(Error::from_reason(
        "hidden process is only supported on Windows",
    ))
}

#[napi]
impl HiddenProcess {
    #[napi(factory)]
    pub fn spawn(options: HiddenProcessOptions) -> napi::Result<Self> {
        #[cfg(windows)]
        {
            Ok(Self {
                child: windows::Process::spawn(options)?,
            })
        }
        #[cfg(not(windows))]
        {
            let _ = options;
            unsupported()
        }
    }

    #[napi]
    pub async fn write_stdin(&self, data: Buffer) -> napi::Result<()> {
        #[cfg(windows)]
        {
            self.child.write_stdin(data).await
        }
        #[cfg(not(windows))]
        {
            let _ = data;
            unsupported()
        }
    }

    #[napi]
    pub fn close_stdin(&self) {
        #[cfg(windows)]
        self.child.close_stdin();
    }

    #[napi]
    pub async fn read_stdout(&self) -> napi::Result<Option<Buffer>> {
        #[cfg(windows)]
        {
            self.child.stdout.read().await
        }
        #[cfg(not(windows))]
        unsupported()
    }

    #[napi]
    pub async fn read_stderr(&self) -> napi::Result<Option<Buffer>> {
        #[cfg(windows)]
        {
            self.child.stderr.read().await
        }
        #[cfg(not(windows))]
        unsupported()
    }

    #[napi]
    pub fn kill(&self) {
        #[cfg(windows)]
        self.child.kill();
    }

    #[napi]
    pub async fn wait(&self) -> napi::Result<Option<i32>> {
        #[cfg(windows)]
        {
            self.child.wait().await.map(Some)
        }
        #[cfg(not(windows))]
        unsupported()
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        fs::File,
        io::{self, Write},
        mem::{size_of, size_of_val},
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        ptr::{null, null_mut},
        sync::{Arc, Mutex},
    };
    use windows_sys::Win32::{
        Foundation::{
            ERROR_BROKEN_PIPE, GENERIC_READ, GENERIC_WRITE, HANDLE, HANDLE_FLAG_INHERIT,
            INVALID_HANDLE_VALUE, SetHandleInformation, WAIT_OBJECT_0,
        },
        Security::SECURITY_ATTRIBUTES,
        Storage::FileSystem::{
            CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING, ReadFile,
        },
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT,
                JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject,
            },
            Pipes::CreatePipe,
            Threading::{
                CREATE_NEW_CONSOLE, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
                DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess,
                INFINITE, InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROCESS_INFORMATION, STARTF_USESHOWWINDOW,
                STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW, TerminateProcess,
                UpdateProcThreadAttribute, WaitForSingleObject,
            },
        },
        UI::WindowsAndMessaging::SW_HIDE,
    };

    fn checked(ok: i32) -> io::Result<()> {
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    // Every handle passed here comes directly from a successful Win32 creation call.
    unsafe fn owned(raw: HANDLE) -> OwnedHandle {
        unsafe { OwnedHandle::from_raw_handle(raw) }
    }

    // Return (child end, parent end). The parent end never enters an inheritance list.
    fn stdio(
        sa: &SECURITY_ATTRIBUTES,
        piped: bool,
        input: bool,
    ) -> io::Result<(OwnedHandle, Option<OwnedHandle>)> {
        if !piped {
            let nul = [b'N' as u16, b'U' as u16, b'L' as u16, 0];
            let handle = unsafe {
                CreateFileW(
                    nul.as_ptr(),
                    if input { GENERIC_READ } else { GENERIC_WRITE },
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    sa,
                    OPEN_EXISTING,
                    0,
                    null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            return Ok((unsafe { owned(handle) }, None));
        }
        let (mut read, mut write) = (null_mut(), null_mut());
        checked(unsafe { CreatePipe(&mut read, &mut write, sa, 0) })?;
        let (read, write) = unsafe { (owned(read), owned(write)) };
        let (child, parent) = if input { (read, write) } else { (write, read) };
        checked(unsafe { SetHandleInformation(parent.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) })?;
        Ok((child, Some(parent)))
    }

    // Win32 requires pointer-aligned storage and borrows the handles until CreateProcessW returns.
    struct Attributes(Vec<usize>);

    impl Attributes {
        fn for_handles(handles: &[HANDLE]) -> io::Result<Self> {
            let mut bytes = 0;
            unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes) };
            if bytes == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
            checked(unsafe {
                InitializeProcThreadAttributeList(storage.as_mut_ptr().cast(), 1, 0, &mut bytes)
            })?;
            let mut list = Self(storage);
            checked(unsafe {
                UpdateProcThreadAttribute(
                    list.pointer(),
                    0,
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                    handles.as_ptr().cast(),
                    size_of_val(handles),
                    null_mut(),
                    null(),
                )
            })?;
            Ok(list)
        }

        fn pointer(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            self.0.as_mut_ptr().cast()
        }
    }

    impl Drop for Attributes {
        fn drop(&mut self) {
            unsafe { DeleteProcThreadAttributeList(self.pointer()) };
        }
    }

    fn set_job_limits(job: &OwnedHandle, flags: JOB_OBJECT_LIMIT) -> io::Result<()> {
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = flags;
        checked(unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                size_of_val(&limits) as u32,
            )
        })
    }

    fn assign_job(process: &OwnedHandle) -> Option<Arc<OwnedHandle>> {
        let raw = unsafe { CreateJobObjectW(null(), null()) };
        if raw.is_null() {
            return None;
        }
        let job = unsafe { owned(raw) };
        set_job_limits(
            &job,
            JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        )
        .ok()?;
        checked(unsafe { AssignProcessToJobObject(raw, process.as_raw_handle()) }).ok()?;
        Some(Arc::new(job))
    }

    async fn blocking<T: Send + 'static>(
        f: impl FnOnce() -> io::Result<T> + Send + 'static,
    ) -> napi::Result<T> {
        tokio::task::spawn_blocking(f)
            .await
            .map_err(|e| Error::from_reason(e.to_string()))?
            .map_err(Into::into)
    }

    pub(super) struct Output(Arc<Mutex<Option<OwnedHandle>>>);

    impl Output {
        pub(super) async fn read(&self) -> napi::Result<Option<Buffer>> {
            let pipe = Arc::clone(&self.0);
            blocking(move || {
                let mut slot = pipe.lock().expect("poisoned output pipe");
                let Some(handle) = slot.as_ref() else {
                    return Ok(None);
                };
                let mut data = vec![0; 16 * 1024];
                let mut count = 0;
                let result = checked(unsafe {
                    ReadFile(
                        handle.as_raw_handle(),
                        data.as_mut_ptr(),
                        data.len() as u32,
                        &mut count,
                        null_mut(),
                    )
                });
                if let Err(error) = result {
                    slot.take();
                    if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                        return Ok(None);
                    }
                    return Err(error);
                }
                if count == 0 {
                    slot.take();
                    return Ok(None);
                }
                data.truncate(count as usize);
                Ok(Some(data.into()))
            })
            .await
        }
    }

    pub(super) struct Process {
        process: Arc<OwnedHandle>,
        job: Option<Arc<OwnedHandle>>,
        stdin: Mutex<Option<Arc<File>>>,
        pub(super) stdout: Output,
        pub(super) stderr: Output,
    }

    impl Process {
        pub(super) fn spawn(options: HiddenProcessOptions) -> napi::Result<Self> {
            let mut command = build_windows_command_line(
                &options.executable,
                &options.args,
                options.verbatim_arguments,
            )
            .map_err(Error::from_reason)?;
            let env = build_windows_environment_block(&options.env).map_err(Error::from_reason)?;
            if options.cwd.contains('\0') {
                return Err(Error::from_reason("NUL in process directory"));
            }
            let cwd: Vec<_> = options.cwd.encode_utf16().chain([0]).collect();
            let executable: Vec<_> = options.executable.encode_utf16().chain([0]).collect();
            let sa = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                bInheritHandle: 1,
                ..Default::default()
            };
            let (input, stdin) = stdio(&sa, options.stdin, true)?;
            let (output, stdout) = stdio(&sa, true, false)?;
            let (error, stderr) = stdio(&sa, options.stderr, false)?;
            // Each child end comes from a separate CreatePipe or CreateFileW.
            let handles = [
                input.as_raw_handle(),
                output.as_raw_handle(),
                error.as_raw_handle(),
            ];
            let mut attrs = Attributes::for_handles(&handles)?;
            let startup = STARTUPINFOEXW {
                StartupInfo: STARTUPINFOW {
                    cb: size_of::<STARTUPINFOEXW>() as u32,
                    dwFlags: STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES,
                    wShowWindow: SW_HIDE as u16,
                    hStdInput: handles[0],
                    hStdOutput: handles[1],
                    hStdError: handles[2],
                    ..Default::default()
                },
                lpAttributeList: attrs.pointer(),
            };
            let mut info = PROCESS_INFORMATION::default();
            let result = checked(unsafe {
                CreateProcessW(
                    executable.as_ptr(),
                    command.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    CREATE_NEW_CONSOLE | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
                    env.as_ptr().cast(),
                    cwd.as_ptr(),
                    (&raw const startup).cast(),
                    &mut info,
                )
            });
            drop((attrs, input, output, error));
            result?;
            let process = unsafe { owned(info.hProcess) };
            drop(unsafe { owned(info.hThread) });
            let job = assign_job(&process);
            Ok(Self {
                process: Arc::new(process),
                job,
                stdin: Mutex::new(stdin.map(|h| Arc::new(File::from(h)))),
                stdout: Output(Arc::new(Mutex::new(stdout))),
                stderr: Output(Arc::new(Mutex::new(stderr))),
            })
        }

        pub(super) async fn write_stdin(&self, data: Buffer) -> napi::Result<()> {
            // An in-flight write holds its own reference. Closing stdin or killing
            // the process from the JS thread never waits on a blocked pipe write.
            let file = self
                .stdin
                .lock()
                .expect("poisoned stdin")
                .clone()
                .ok_or_else(|| Error::from_reason("stdin closed"))?;
            blocking(move || (&*file).write_all(&data)).await
        }

        pub(super) fn close_stdin(&self) {
            self.stdin.lock().expect("poisoned stdin").take();
        }

        pub(super) fn kill(&self) {
            unsafe {
                if let Some(job) = &self.job {
                    TerminateJobObject(job.as_raw_handle(), 1);
                }
                TerminateProcess(self.process.as_raw_handle(), 1);
            }
            self.close_stdin();
        }

        pub(super) async fn wait(&self) -> napi::Result<i32> {
            let process = Arc::clone(&self.process);
            let job = self.job.clone();
            blocking(move || {
                if unsafe { WaitForSingleObject(process.as_raw_handle(), INFINITE) }
                    != WAIT_OBJECT_0
                {
                    return Err(io::Error::last_os_error());
                }
                // Shared services started by a finished CLI can outlive the job handle.
                if let Some(job) = job {
                    set_job_limits(&job, JOB_OBJECT_LIMIT_BREAKAWAY_OK)?;
                }
                let mut code = 0;
                checked(unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut code) })?;
                Ok(code as i32)
            })
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().collect()
    }

    #[test]
    fn command_line_preserves_windows_arguments() {
        let args = ["plain", "", "a\tb", "two words\\", r#"a\\"b"#, "日本語"].map(String::from);
        assert_eq!(
            build_windows_command_line("C:\\Program Files\\shell.exe", &args, false).unwrap(),
            wide(concat!(
                r#""C:\Program Files\shell.exe" plain "" "#,
                "\"a\tb\" ",
                r#""two words\\" "a\\\\\"b" 日本語"#,
                "\0"
            ))
        );
    }

    #[test]
    fn cmd_receives_its_script_verbatim() {
        let args = ["/s", "/c", r#""echo "a b" & exit""#].map(String::from);
        assert_eq!(
            build_windows_command_line("C:\\my cmd.exe", &args, true).unwrap(),
            wide("\"C:\\my cmd.exe\" /s /c \"echo \"a b\" & exit\"\0")
        );
        for verbatim in [true, false] {
            assert!(build_windows_command_line("a\0b", &[], verbatim).is_err());
            assert!(build_windows_command_line("cmd", &["a\0b".into()], verbatim).is_err());
        }
    }

    #[test]
    fn environment_sorts_names_and_preserves_values_and_terminators() {
        let entries = ["Zoo=", "path=日本語", "alpha=a=b"].map(String::from);
        assert_eq!(
            build_windows_environment_block(&entries).unwrap(),
            wide("alpha=a=b\0path=日本語\0Zoo=\0\0")
        );
        assert_eq!(build_windows_environment_block(&[]).unwrap(), [0, 0]);
        for entry in ["NO_EQUALS", "K=bad\0tail"] {
            assert!(build_windows_environment_block(&[entry.into()]).is_err());
        }
    }
}
