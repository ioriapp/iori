#[cfg(windows)]
use napi::Error;
use napi_derive::napi;
#[cfg(windows)]
use std::path::Path;

#[napi(catch_unwind)]
pub fn restrict_to_current_user(
    path: String,
    require_current_owner: Option<bool>,
) -> napi::Result<()> {
    #[cfg(windows)]
    {
        if require_current_owner.unwrap_or(false) {
            verify_windows_current_owner(Path::new(&path))?;
        }
        restrict_windows_acl(Path::new(&path))?;
    }

    #[cfg(not(windows))]
    {
        let _ = (path, require_current_owner);
    }

    Ok(())
}

#[napi(catch_unwind)]
pub fn restrict_terminal_pipe(path: String) -> napi::Result<()> {
    #[cfg(windows)]
    {
        // A newly created pipe can be owned by the Administrators group when
        // the process is elevated. Grant the actual token user, not that group.
        let sid = current_windows_user_sid()?;
        set_windows_acl(Path::new(&path), &format!("D:P(A;;FA;;;{sid})"))?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

#[cfg(windows)]
fn verify_windows_current_owner(path: &Path) -> napi::Result<()> {
    use std::{iter::once, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree},
        Security::{
            Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT},
            EqualSid, GetTokenInformation, OWNER_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER,
            TokenUser,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(once(0)).collect();
    let mut descriptor = std::ptr::null_mut();
    let mut owner = std::ptr::null_mut();
    // SAFETY: the path is NUL-terminated and both outputs remain valid until LocalFree below.
    let result = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if result != 0 {
        return Err(Error::from_reason("could not read command directory owner"));
    }
    let mut handle = std::ptr::null_mut();
    // SAFETY: the process pseudo-handle is valid and `handle` receives an owned token handle.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) } == 0 {
        // SAFETY: GetNamedSecurityInfoW allocated the descriptor.
        unsafe { LocalFree(descriptor) };
        return Err(Error::from_reason("could not read current command user"));
    }
    // A usize buffer provides alignment for TOKEN_USER as well as its trailing SID.
    let mut needed = 0;
    // SAFETY: the token handle is live; a null buffer requests its required size.
    unsafe {
        GetTokenInformation(handle, TokenUser, std::ptr::null_mut(), 0, &mut needed);
    }
    let mut token = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
    let owned = if owner.is_null() || (needed as usize) < std::mem::size_of::<TOKEN_USER>() {
        false
    } else {
        // SAFETY: the aligned buffer holds at least `needed` bytes. The SID in
        // TOKEN_USER and the owner SID remain live through the comparison.
        unsafe {
            GetTokenInformation(
                handle,
                TokenUser,
                token.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ) != 0
                && EqualSid(owner, (*token.as_ptr().cast::<TOKEN_USER>()).User.Sid) != 0
        }
    };
    // SAFETY: GetNamedSecurityInfoW allocated the descriptor; no SID is used afterwards.
    unsafe {
        LocalFree(descriptor);
        CloseHandle(handle);
    };
    if !owned {
        return Err(Error::from_reason(
            "command directory belongs to another user",
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn current_windows_user_sid() -> napi::Result<String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree},
        Security::{
            Authorization::ConvertSidToStringSidW, GetTokenInformation, TOKEN_QUERY, TOKEN_USER,
            TokenUser,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };
    let mut handle = std::ptr::null_mut();
    // SAFETY: the process pseudo-handle is valid; the output receives an owned handle.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) } == 0 {
        return Err(Error::from_reason("could not read terminal pipe user"));
    }
    let mut needed = 0;
    // SAFETY: a null buffer requests the token information size.
    unsafe {
        GetTokenInformation(handle, TokenUser, std::ptr::null_mut(), 0, &mut needed);
    }
    let mut token = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
    let mut sid_text = std::ptr::null_mut();
    // SAFETY: the aligned buffer holds TOKEN_USER and its SID throughout conversion.
    let converted = (needed as usize) >= std::mem::size_of::<TOKEN_USER>()
        && unsafe {
            GetTokenInformation(
                handle,
                TokenUser,
                token.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ) != 0
                && ConvertSidToStringSidW(
                    (*token.as_ptr().cast::<TOKEN_USER>()).User.Sid,
                    &mut sid_text,
                ) != 0
        };
    // SAFETY: this handle was returned by OpenProcessToken and is no longer used.
    unsafe {
        CloseHandle(handle);
    }
    if !converted {
        return Err(Error::from_reason("could not identify terminal pipe user"));
    }
    // SAFETY: ConvertSidToStringSidW returned a NUL-terminated allocation.
    let text = unsafe {
        let mut length = 0;
        while *sid_text.add(length) != 0 {
            length += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(sid_text, length))
    };
    // SAFETY: the string was allocated by ConvertSidToStringSidW.
    unsafe {
        LocalFree(sid_text.cast());
    }
    Ok(text)
}

#[cfg(windows)]
fn restrict_windows_acl(path: &Path) -> napi::Result<()> {
    let metadata = std::fs::metadata(path)
        .map_err(|_| Error::from_reason("could not read Host storage path"))?;
    let sid = current_windows_user_sid()?;
    // Inherited OWNER RIGHTS would refer to a sandbox account when that account
    // creates a mailbox request. Keep the Host user able to read and remove it.
    set_windows_acl(
        path,
        &if metadata.is_dir() {
            format!("D:P(A;OICI;FA;;;{sid})")
        } else {
            format!("D:P(A;;FA;;;{sid})")
        },
    )
}

#[cfg(windows)]
fn set_windows_acl(path: &Path, sddl: &str) -> napi::Result<()> {
    use std::{ffi::c_void, iter::once, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SE_FILE_OBJECT,
                SetNamedSecurityInfoW,
            },
            DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl,
            PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
        },
    };

    let sddl: Vec<u16> = sddl.encode_utf16().chain(once(0)).collect();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: `sddl` is NUL-terminated and the output pointer remains valid below.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    };
    if converted == 0 || descriptor.is_null() {
        return Err(Error::from_reason("could not build Host storage ACL"));
    }

    let mut dacl = std::ptr::null_mut();
    let mut dacl_present = 0;
    let mut dacl_defaulted = 0;
    // SAFETY: `descriptor` was returned by ConvertStringSecurityDescriptorToSecurityDescriptorW.
    let found_dacl = unsafe {
        GetSecurityDescriptorDacl(
            descriptor,
            &mut dacl_present,
            &mut dacl,
            &mut dacl_defaulted,
        )
    };
    if found_dacl == 0 || dacl_present == 0 || dacl.is_null() {
        // SAFETY: the descriptor was allocated by the Windows security API.
        unsafe { LocalFree(descriptor.cast()) };
        return Err(Error::from_reason("could not read Host storage ACL"));
    }

    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(once(0)).collect();
    // SAFETY: `path_wide` is NUL-terminated; `dacl` belongs to the live descriptor.
    let result = unsafe {
        SetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl,
            std::ptr::null_mut(),
        )
    };
    // SAFETY: the descriptor was allocated by the Windows security API.
    unsafe { LocalFree(descriptor.cast::<c_void>()) };
    if result != 0 {
        return Err(Error::from_reason(format!(
            "could not restrict Host storage ACL (Windows error {result})"
        )));
    }
    Ok(())
}
