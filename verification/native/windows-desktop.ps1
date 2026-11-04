$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IoriOsInput {
 public delegate bool EnumWindowCallback(IntPtr window,IntPtr data);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowCallback callback,IntPtr data);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window,uint command);
 [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr window);
 public static IntPtr FindMainWindow(uint processId) {
  IntPtr result=IntPtr.Zero;
  EnumWindows((window,data)=>{uint owner;GetWindowThreadProcessId(window,out owner);if(owner==processId && GetWindow(window,4)==IntPtr.Zero && GetWindowTextLength(window)>0){result=window;return false;}return true;},IntPtr.Zero);
  return result;
 }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window,ref Point point);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
 [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
 [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr handle,int index,System.Text.StringBuilder data,int length,out int needed);
 [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
}
'@
function Click-Element($element, $right = $false) {
 $r=$element.Current.BoundingRectangle
 if($r.Width -le 0 -or $r.Height -le 0){throw 'OS element has no visible bounds'}
 if(-not [IoriOsInput]::SetCursorPos([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2))){throw 'The verification desktop did not accept OS pointer input'}
 [IoriOsInput]::mouse_event($(if($right){8}else{2}),0,0,0,[UIntPtr]::Zero)
 [IoriOsInput]::mouse_event($(if($right){16}else{4}),0,0,0,[UIntPtr]::Zero)
}
function Elements($type) {
 $condition=if($type){[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,$type)}else{[System.Windows.Automation.Condition]::TrueCondition}
 [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
}
function Named-Elements($names) {
 $conditions=@($names | ForEach-Object {[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$_)} )
 $condition=if($conditions.Count -eq 1){$conditions[0]}else{[System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]$conditions)}
 [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
}
function Owned-WindowProcess {
 # The same executable also serves as a windowless SSH askpass helper.
 Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $clientPath -and [IoriOsInput]::FindMainWindow($_.ProcessId) -ne [IntPtr]::Zero}
}
function Owned-Window($processId) {
 # Minimized or hidden, the process reports another top-level window as its
 # main window. Keep the window first resolved while it belongs to the process.
 if($windowHandle){
  $known=[IntPtr][long]$windowHandle;[uint32]$owner=0
  $null=[IoriOsInput]::GetWindowThreadProcessId($known,[ref]$owner)
  if([IoriOsInput]::IsWindow($known) -and $owner -eq $processId){return $known}
 }
 $handle=(Get-Process -Id $processId).MainWindowHandle
 if($handle -eq [IntPtr]::Zero){$handle=[IoriOsInput]::FindMainWindow($processId)}
 $handle
}
function Capture($r) {
 if($r.Width -le 0 -or $r.Height -le 0){return $false}
 $bitmap=[Drawing.Bitmap]::new([int]$r.Width,[int]$r.Height)
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 try { $graphics.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bitmap.Size);$bitmap.Save($imageFile,[Drawing.Imaging.ImageFormat]::Png) }
 finally { $graphics.Dispose();$bitmap.Dispose() }
 return $true
}
if($readyFile){[IO.File]::WriteAllText($readyFile,'ready')}
try {
 $result=@{found=$false;captured=$false}
 $notificationState=0;$null=[IoriOsInput]::SHQueryUserNotificationState([ref]$notificationState)
 $result.userNotificationState=$notificationState
 $inputDesktop=[IoriOsInput]::OpenInputDesktop(0,$false,1)
 $result.inputDesktopAccessible=$inputDesktop -ne [IntPtr]::Zero
 if($inputDesktop -ne [IntPtr]::Zero){
  $name=[Text.StringBuilder]::new(256);$needed=0
  if([IoriOsInput]::GetUserObjectInformation($inputDesktop,2,$name,512,[ref]$needed)){$result.inputDesktop=$name.ToString()}
  $null=[IoriOsInput]::CloseDesktop($inputDesktop)
 }
 if($operation -eq 'identity') {
  $result.processes=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'iori-client.exe'} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate)
  $result.startApps=@(Get-StartApps | Where-Object {$_.Name -eq $productName})
  $shell=New-Object -ComObject Shell.Application
  $result.shortcuts=@()
  $result.verificationShortcuts=@()
  $links=New-Object -ComObject WScript.Shell
  foreach($root in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'),[Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'))){
   foreach($file in @(Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | Where-Object {$_.BaseName -match '^iori.*Test'})){
    $link=$links.CreateShortcut($file.FullName)
    $result.verificationShortcuts+=@{path=$file.FullName;target=$link.TargetPath}
   }
   foreach($file in @(Get-ChildItem -LiteralPath $root -Filter ($productName+'.lnk') -Recurse -ErrorAction SilentlyContinue)){
    $folder=$shell.NameSpace($file.DirectoryName);$item=$folder.ParseName($file.Name)
    $link=$links.CreateShortcut($file.FullName)
    $result.shortcuts+=@{path=$file.FullName;target=$link.TargetPath;appId=$item.ExtendedProperty('System.AppUserModel.ID');activator=$item.ExtendedProperty('System.AppUserModel.ToastActivatorCLSID')}
   }
  }
  $result.verificationRegistrations=@()
  foreach($root in @('HKCU:\Software\Classes','HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings')){
   $result.verificationRegistrations+=@(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | Where-Object {$_.PSChildName -match '^iori.*test|^io\.github\.ioriapp\.iori\..*test'} | Select-Object -ExpandProperty Name)
  }
  $null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]
  $null=[Windows.UI.Notifications.ToastNotificationHistory,Windows.UI.Notifications,ContentType=WindowsRuntime]
  $null=[Windows.UI.Notifications.ToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime]
  $history=[Windows.UI.Notifications.ToastNotificationManager]::History
  $result.notifications=@()
  foreach($id in @($applicationId,'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe')){
   foreach($entry in @($history.GetHistory($id))){
    $toast=[Windows.UI.Notifications.ToastNotification]$entry
    $xml=$toast.Content
    $launch=[string]$xml.DocumentElement.GetAttribute('launch')
    $parsed=[xml]$xml.GetXml()
    $title=[string]$parsed.toast.visual.binding.text[0]
    $kind=if($title -match 'Codex (承認待ち|Waiting for approval)$'){'waiting'}elseif($title -match 'Codex (完了|Done)$'){'done'}elseif($title -match '(使える候補がありません|No available candidate)$'){'candidate'}else{''}
    if(-not $kind){continue}
    $result.notifications+=@{appId=$id;tag=$toast.Tag;kind=$kind;activation=[string]$xml.DocumentElement.GetAttribute('activationType');scenario=[string]$xml.DocumentElement.GetAttribute('scenario');duration=[string]$xml.DocumentElement.GetAttribute('duration');launchScheme=($launch -split ':')[0];fixtureBody=$xml.GetXml().Contains('console.log(42)')}
   }
  }
  $result.found=$true
 } elseif($operation -eq 'start-menu-open') {
  $shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) ($productName+'.lnk')
  $link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  if($link.TargetPath -ne $clientPath){throw 'Start menu shortcut does not belong to this run'}
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  $listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port='+$port
  Start-Process -FilePath $shortcut
  $result.found=$true;$result.debugPort=$port;$result.shortcut=$shortcut
 } elseif($operation -eq 'foreground-read') {
  [uint32]$foregroundPid=0
  $null=[IoriOsInput]::GetWindowThreadProcessId([IoriOsInput]::GetForegroundWindow(),[ref]$foregroundPid)
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$foregroundPid)
  $result.found=$process.ExecutablePath -eq $clientPath
  $result.processId=$foregroundPid
  $active=[System.Windows.Automation.AutomationElement]::FromHandle([IoriOsInput]::GetForegroundWindow())
  $result.windowsSecurityWarning=$active.Current.Name -in @('Windows セキュリティ','Windows Security')
 } elseif($operation -eq 'window-health-read') {
  # Observe after an Owner's manual operation without UI Automation or WebDriver.
  $process=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $clientPath})
  $result.clientProcesses=$process.Count
  $result.windows=@($process | ForEach-Object {
   $handle=[IoriOsInput]::FindMainWindow($_.ProcessId)
   @{processId=$_.ProcessId;found=$handle -ne [IntPtr]::Zero;hung=$(if($handle -ne [IntPtr]::Zero){[IoriOsInput]::IsHungAppWindow($handle)}else{$null})}
  })
  [uint32]$foregroundPid=0
  $null=[IoriOsInput]::GetWindowThreadProcessId([IoriOsInput]::GetForegroundWindow(),[ref]$foregroundPid)
  $result.foreground=$foregroundPid -in $process.ProcessId
  $result.foregroundProcessId=$foregroundPid
  $result.rules=@(Get-NetFirewallApplicationFilter | Where-Object {$_.Program -ieq $programPath} | Get-NetFirewallRule | ForEach-Object {
   $port=$_ | Get-NetFirewallPortFilter
   @{name=$_.Name;displayName=$_.DisplayName;profile=[string]$_.Profile;action=[string]$_.Action;direction=[string]$_.Direction;enabled=[string]$_.Enabled;protocol=[string]$port.Protocol}
  })
  $result.found=$process.Count -gt 0
 } elseif($operation -eq 'window-consent-click') {
  # Before the click only, resolve the owned window and the supplied button
  # position. No UI Automation, screenshot or WebDriver runs during consent.
  $process=@(Owned-WindowProcess)
  if($process.Count -ne 1){throw 'Expected the owned verification Client'}
  $handle=[IoriOsInput]::FindMainWindow($process[0].ProcessId)
  if($handle -eq [IntPtr]::Zero){throw 'The owned verification window was not found'}
  $pointer=$pointerJson | ConvertFrom-Json
  $origin=[IoriOsInput+Point]::new();$null=[IoriOsInput]::ClientToScreen($handle,[ref]$origin)
  $scale=[IoriOsInput]::GetDpiForWindow($handle)/96
  $null=[IoriOsInput]::SetForegroundWindow($handle)
  $null=[IoriOsInput]::SetCursorPos([int]($origin.X+$pointer.x*$scale),[int]($origin.Y+$pointer.y*$scale))
  [IoriOsInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [IoriOsInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
  while(-not [Diagnostics.Process]::GetProcessesByName('consent').Count){[Threading.Thread]::Sleep(100)}
  $result.consentObserved=$true
  # Capture the Client's PowerShell operation while consent is open. Consent
  # closing starts elevation; rule creation can still be running afterwards.
  $operations=@(Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -eq $process[0].ProcessId -and $_.Name -eq 'powershell.exe'} | ForEach-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue})
  $result.hostProcessesAtConsent=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -ieq $programPath}).Count
  while([Diagnostics.Process]::GetProcessesByName('consent').Count){[Threading.Thread]::Sleep(100)}
  $result.consentClosedAt=[DateTime]::UtcNow.ToString('o')
  foreach($pending in $operations){$pending.WaitForExit();$pending.Dispose()}
  $result.rules=@(Get-NetFirewallApplicationFilter | Where-Object {$_.Program -ieq $programPath} | Get-NetFirewallRule | ForEach-Object {
   $port=$_ | Get-NetFirewallPortFilter
   @{name=$_.Name;displayName=$_.DisplayName;profile=[string]$_.Profile;action=[string]$_.Action;direction=[string]$_.Direction;enabled=[string]$_.Enabled;protocol=[string]$port.Protocol}
  })
  $result.clientProcesses=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $clientPath}).Count
  [uint32]$foregroundPid=0
  $null=[IoriOsInput]::GetWindowThreadProcessId([IoriOsInput]::GetForegroundWindow(),[ref]$foregroundPid)
  $foreground=Get-CimInstance Win32_Process -Filter ('ProcessId='+$foregroundPid)
  $result.foreground=$foreground.ExecutablePath -eq $clientPath
  $result.foregroundProcessId=$foregroundPid
  $result.found=$true
 } elseif($operation -eq 'probe') {
  $result.found=$true;$result.desktopClass=[System.Windows.Automation.AutomationElement]::RootElement.Current.ClassName
  $result.toastEnabled=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' -Name ToastEnabled -ErrorAction SilentlyContinue).ToastEnabled
  $result.powershellEnabled=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\Microsoft.Windows.PowerShell' -Name Enabled -ErrorAction SilentlyContinue).Enabled
  $settings=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe' -ErrorAction SilentlyContinue
  $result.debugToastBanner=$settings.ShowBanner
  $result.debugToastEnabled=$settings.Enabled
  $result.globalToastSetting=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings' -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -ErrorAction SilentlyContinue).NOC_GLOBAL_SETTING_TOASTS_ENABLED
  $null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]
  $null=[Windows.UI.Notifications.ToastNotifier,Windows.UI.Notifications,ContentType=WindowsRuntime]
  $null=[Windows.UI.Notifications.ToastNotificationHistory,Windows.UI.Notifications,ContentType=WindowsRuntime]
  $notifier=[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe')
  $result.powershellNotifierSetting=[string]$notifier.Setting
  $history=[Windows.UI.Notifications.ToastNotificationManager]::History
  if($history){$result.cliNotificationHistory=@($history.GetHistory('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe') | Where-Object {$_.Content.GetXml() -match 'Codex'}).Count}
 } elseif($operation -eq 'notification-settings-read') {
  $before=@(Get-Process -Name SystemSettings -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne [IntPtr]::Zero -and [IoriOsInput]::IsWindowVisible($_.MainWindowHandle)})
  $settingsOpened=-not $before.Count
  if($settingsOpened){Start-Process 'ms-settings:notifications'}
  try {
   $watch=[Diagnostics.Stopwatch]::StartNew()
   do {
    $toggle=@(Named-Elements @('応答不可','Do not disturb') | Select-Object -First 1)
    if(-not $toggle.Count){Start-Sleep -Milliseconds 100}
   } while(-not $toggle.Count -and $watch.Elapsed.TotalSeconds -lt 30)
   if($toggle.Count){
    $pattern=$toggle[0].GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $result.found=$true;$result.doNotDisturb=$pattern.Current.ToggleState.ToString()
   }
  } finally {
   foreach($process in @($(if($settingsOpened){Get-Process -Name SystemSettings -ErrorAction SilentlyContinue}))){
    if($process.MainWindowHandle -ne [IntPtr]::Zero){$null=[IoriOsInput]::PostMessage($process.MainWindowHandle,0x112,[IntPtr]0xF060,[IntPtr]::Zero)}
   }
  }
 } elseif($operation -eq 'protocol-open') {
  Start-Process -FilePath $activationUrl
  $result.found=$true
 } elseif($operation -eq 'toast-read' -or $operation -eq 'toast-click' -or $operation -eq 'history-click') {
  if($operation -eq 'history-click'){
   [IoriOsInput]::keybd_event(0x5B,0,0,[UIntPtr]::Zero)
   [IoriOsInput]::keybd_event(0x4E,0,0,[UIntPtr]::Zero)
   [IoriOsInput]::keybd_event(0x4E,0,2,[UIntPtr]::Zero)
   [IoriOsInput]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)
  }
  $watch=[Diagnostics.Stopwatch]::StartNew()
  do {
   $text=@(Named-Elements @('notification-repository / notification-worktree - Codex 承認待ち','notification-repository / notification-worktree - Codex 完了','notification-repository / notification-worktree - Codex Waiting for approval','notification-repository / notification-worktree - Codex Done') | Select-Object -First 1)
   if(-not $text.Count){
    $shells=@(Get-Process -Name ShellExperienceHost,ShellHost -ErrorAction SilentlyContinue)
    foreach($shell in $shells){
     $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$shell.Id)
     $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)
     foreach($window in $windows){
      $r=$window.Current.BoundingRectangle
      if($r.Width -lt 250 -or $r.Height -gt 350){continue}
      $children=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      $text=@($children | Where-Object {$_.Current.Name -match '^notification-repository / notification-worktree - Codex (承認待ち|入力待ち|完了|失敗|Waiting for approval|Needs input|Done|Failed)$'} | Select-Object -First 1)
      if($text.Count){break}
     }
     if($text.Count){break}
    }
   }
   if(-not $text.Count){Start-Sleep -Milliseconds 100}
  } while(-not $text.Count -and $watch.Elapsed.TotalSeconds -lt 30)
  if($text.Count) {
   $element=$text[0];$r=$element.Current.BoundingRectangle;$result.found=$true;$result.title=$element.Current.Name
   $parent=$element
   for($i=0;$i -lt 6;$i++) {
    $parent=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($parent)
    if(-not $parent){break}
    $candidate=$parent.Current.BoundingRectangle
    if($candidate.Width -ge 250 -and $candidate.Height -ge 60 -and $candidate.Height -le 350){$r=$candidate;break}
   }
   $result.captured=Capture $r
   if($operation -eq 'toast-click' -or $operation -eq 'history-click'){Click-Element $element}
  }
 } elseif($operation -in @('window-capture','window-state','window-pointer','window-restore','window-key')) {
  $process=@(Owned-WindowProcess)
  if($process.Count -ne 1){throw 'Expected the owned verification Client'}
  $handle=Owned-Window $process[0].ProcessId
  if($handle -eq [IntPtr]::Zero){throw 'The owned verification window was not found'}
  $result.found=$true;$result.handle=[long]$handle
  if($operation -eq 'window-restore' -or ($operation -eq 'window-capture' -and [IoriOsInput]::IsIconic($handle))){$null=[IoriOsInput]::ShowWindow($handle,9)}
  if($operation -in @('window-restore','window-capture')){$null=[IoriOsInput]::SetForegroundWindow($handle)}
  if($operation -eq 'window-pointer'){
   $pointer=$pointerJson | ConvertFrom-Json
   $origin=[IoriOsInput+Point]::new();$null=[IoriOsInput]::ClientToScreen($handle,[ref]$origin)
   $scale=[IoriOsInput]::GetDpiForWindow($handle)/96
   $null=[IoriOsInput]::SetForegroundWindow($handle)
   $null=[IoriOsInput]::SetCursorPos([int]($origin.X+$pointer.x*$scale),[int]($origin.Y+$pointer.y*$scale))
   if($pointer.action -eq 'click' -or $pointer.action -eq 'double'){
    $count=if($pointer.action -eq 'double'){2}else{1}
    for($i=0;$i -lt $count;$i++){
     [IoriOsInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
     [IoriOsInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    }
   } elseif($pointer.action -eq 'drag'){
    $steps=if($pointer.steps){[int]$pointer.steps}else{20}
    [IoriOsInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    for($i=1;$i -le $steps;$i++){
     $null=[IoriOsInput]::SetCursorPos([int]($origin.X+($pointer.x+($pointer.toX-$pointer.x)*$i/$steps)*$scale),[int]($origin.Y+($pointer.y+($pointer.toY-$pointer.y)*$i/$steps)*$scale))
     [Threading.Thread]::Sleep(10)
    }
    [IoriOsInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
   }
  }
  if($operation -eq 'window-key'){
   $null=[IoriOsInput]::SetForegroundWindow($handle)
   if([IoriOsInput]::GetForegroundWindow() -ne $handle){throw 'The owned verification window is not foreground'}
   $keys=@(($pointerJson | ConvertFrom-Json).keys)
   foreach($key in $keys){[IoriOsInput]::keybd_event([byte]$key,0,0,[UIntPtr]::Zero)}
   [array]::Reverse($keys)
   foreach($key in $keys){[IoriOsInput]::keybd_event([byte]$key,0,2,[UIntPtr]::Zero)}
  }
  $element=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $r=$element.Current.BoundingRectangle
  # A minimized window has an empty rectangle (Infinity), which JSON cannot hold.
  $result.bounds=if($r.IsEmpty){$null}else{@{x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}}
  $result.title=$element.Current.Name
  $result.dpi=[IoriOsInput]::GetDpiForWindow($handle)
  $result.maximized=[IoriOsInput]::IsZoomed($handle)
  $result.minimized=[IoriOsInput]::IsIconic($handle)
  $result.visible=[IoriOsInput]::IsWindowVisible($handle)
  $result.foreground=([IoriOsInput]::GetForegroundWindow() -eq $handle)
  if($operation -eq 'window-capture'){$result.captured=Capture $r}
 } elseif($operation -eq 'window-minimize') {
  $process=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $clientPath})
  if($process.Count -eq 1){
   $handle=Owned-Window $process[0].ProcessId;$result.handle=[long]$handle
   $null=[IoriOsInput]::PostMessage($handle,0x112,[IntPtr]0xF020,[IntPtr]::Zero)
   $watch=[Diagnostics.Stopwatch]::StartNew()
   do { $minimized=[IoriOsInput]::IsIconic($handle);if(-not $minimized){Start-Sleep -Milliseconds 100} } while(-not $minimized -and $watch.Elapsed.TotalSeconds -lt 30)
   $result.found=$true;$result.minimized=$minimized
  }
 } elseif($operation -eq 'window-close') {
  $process=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $clientPath} | Select-Object -First 1)
  if($process.Count) {
   $handle=Owned-Window $process[0].ProcessId;$result.handle=[long]$handle
   if($handle -ne [IntPtr]::Zero){
    # SC_CLOSE is the same OS command emitted by the title bar's X button.
    if(-not [IoriOsInput]::PostMessage($handle,0x112,[IntPtr]0xF060,[IntPtr]::Zero)){throw 'OS close command failed'}
    $result.found=$true
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while([IoriOsInput]::IsWindowVisible($handle) -and $watch.Elapsed.TotalSeconds -lt 30){Start-Sleep -Milliseconds 100}
    $result.hidden=-not [IoriOsInput]::IsWindowVisible($handle)
   }
  }
 } else {
  $client=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $clientPath} | Select-Object -First 1)
  $items=@(Named-Elements @('開く','終了','Open','Exit') | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -and $client.Count -and $_.Current.ProcessId -eq $client[0].ProcessId})
  $icon=@(Named-Elements @('iori') | Where-Object {$_.Current.BoundingRectangle.Width -gt 0 -and $_.Current.BoundingRectangle.Width -lt 128 -and $_.Current.BoundingRectangle.Height -lt 128} | Select-Object -First 1)
  if($items.Count) { $result.found=$true } elseif(-not $icon.Count) {
   $overflow=@(Elements ([System.Windows.Automation.ControlType]::Button) | Where-Object {$_.Current.AutomationId -eq 'SystemTrayIcon' -or $_.Current.Name -match 'Show hidden icons|表示されていないインジケーター|非表示のアイコン'} | Select-Object -First 1)
   if($overflow.Count){Click-Element $overflow[0];$result.overflowOpened=$true}
  } else {
   Click-Element $icon[0] $true
   $result.found=$true
   $result.menuOpened=$true
  }
  if($operation -eq 'tray-open' -or $operation -eq 'tray-exit' -or $operation -eq 'tray-read') {
   $watch=[Diagnostics.Stopwatch]::StartNew()
   while(-not $items.Count -and $watch.Elapsed.TotalSeconds -lt 30){
    $items=@(Named-Elements @('開く','終了','Open','Exit') | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -and $client.Count -and $_.Current.ProcessId -eq $client[0].ProcessId})
    if(-not $items.Count){Start-Sleep -Milliseconds 100}
   }
   if($items.Count) {
    $result.menu=@($items | ForEach-Object {$_.Current.Name})
    $r=$items[0].Current.BoundingRectangle
    $parent=[System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($items[0])
    if($parent){$r=$parent.Current.BoundingRectangle}
    $result.captured=Capture $r
    $wanted=if($operation -eq 'tray-exit'){'^(終了|Exit)$'}else{'^(開く|Open)$'}
    $selected=@($items | Where-Object {$_.Current.Name -match $wanted} | Select-Object -First 1)
    if($operation -ne 'tray-read' -and $selected.Count){Click-Element $selected[0];$result.acted=$true}
   }
  }
 }
 [IO.File]::WriteAllText($outputFile,(ConvertTo-Json -InputObject $result -Compress))
} catch {
 [IO.File]::WriteAllText($outputFile,(ConvertTo-Json -InputObject @{error='Windows OS UI operation failed: '+$_.Exception.Message} -Compress))
}
