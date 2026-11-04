import assert from "node:assert/strict";
import { test } from "node:test";
import { windowsLoginEnvironment } from "./windows-login-environment.ts";

test("builds the Windows login environment from registry JSON", () => {
  // Captured from the registry API on the Windows verification machine; the Japanese value and the
  // unexpanded reference retain the actual UTF-8 JSON representation.
  const captured = JSON.parse(
    `{"system":[],"user":[{"name":"IORI_VERIFY_VALUE_d5239858093c46e0b6ef4590a25179b0","type":"String","value":"8be75aa9-7770-45bd-a528-7a3e0d9358c7 日本語 with spaces"},{"name":"IORI_VERIFY_EXPAND_d5239858093c46e0b6ef4590a25179b0","type":"ExpandString","value":"%IORI_VERIFY_VALUE_d5239858093c46e0b6ef4590a25179b0%"},{"name":"IORI_VERIFY_EMPTY_d5239858093c46e0b6ef4590a25179b0","type":"String","value":""},{"name":"IORI_VERIFY_PATHPART_d5239858093c46e0b6ef4590a25179b0","type":"String","value":"expanded"}]}`,
  );
  const registry = JSON.stringify({
    // Captured from the system registry API on the Windows verification machine, in its original order.
    system: [
      {
        name: "ComSpec",
        type: "ExpandString",
        value: "%SystemRoot%\\system32\\cmd.exe",
      },
      {
        name: "DriverData",
        type: "String",
        value: "C:\\Windows\\System32\\Drivers\\DriverData",
      },
      {
        name: "OS",
        type: "String",
        value: "Windows_NT",
      },
      {
        name: "Path",
        type: "ExpandString",
        value:
          "%SystemRoot%\\system32;%SystemRoot%;%SystemRoot%\\System32\\Wbem;%SYSTEMROOT%\\System32\\WindowsPowerShell\\v1.0\\;%SYSTEMROOT%\\System32\\OpenSSH\\;C:\\Program Files\\Git\\cmd;C:\\Program Files\\PowerShell\\7\\",
      },
      {
        name: "PATHEXT",
        type: "String",
        value: ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
      },
      {
        name: "PROCESSOR_ARCHITECTURE",
        type: "String",
        value: "AMD64",
      },
      {
        name: "PSModulePath",
        type: "ExpandString",
        value:
          "%ProgramFiles%\\WindowsPowerShell\\Modules;%SystemRoot%\\system32\\WindowsPowerShell\\v1.0\\Modules",
      },
      {
        name: "TEMP",
        type: "ExpandString",
        value: "%SystemRoot%\\TEMP",
      },
      {
        name: "TMP",
        type: "ExpandString",
        value: "%SystemRoot%\\TEMP",
      },
      {
        name: "USERNAME",
        type: "String",
        value: "SYSTEM",
      },
      {
        name: "windir",
        type: "ExpandString",
        value: "%SystemRoot%",
      },
      {
        name: "NUMBER_OF_PROCESSORS",
        type: "String",
        value: "12",
      },
      {
        name: "PROCESSOR_LEVEL",
        type: "String",
        value: "26",
      },
      {
        name: "PROCESSOR_IDENTIFIER",
        type: "String",
        value: "AMD64 Family 26 Model 36 Stepping 0, AuthenticAMD",
      },
      {
        name: "PROCESSOR_REVISION",
        type: "String",
        value: "2400",
      },
      {
        name: "POWERSHELL_DISTRIBUTION_CHANNEL",
        type: "String",
        value: "MSI:Windows 10 Pro",
      },
    ],
    user: [
      ...captured.user,
      {
        name: "shared",
        type: "ExpandString",
        value: "%USERNAME% and %MISSING%",
      },
      { name: "PATH", type: "ExpandString", value: "%USERPROFILE%\\bin" },
    ],
  });
  assert.deepEqual(
    windowsLoginEnvironment(
      {
        SystemRoot: "C:\\Windows",
        ProgramFiles: "C:\\Program Files",
        USERPROFILE: "C:\\Users\\Person",
        Path: "old",
        USERNAME: "Person",
        TEMP: "C:\\Users\\Person\\Temp",
      },
      registry,
    ),
    {
      ComSpec: "C:\\Windows\\system32\\cmd.exe",
      DriverData: "C:\\Windows\\System32\\Drivers\\DriverData",
      OS: "Windows_NT",
      PATH: "C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\Wbem;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\;C:\\Windows\\System32\\OpenSSH\\;C:\\Program Files\\Git\\cmd;C:\\Program Files\\PowerShell\\7\\;C:\\Users\\Person\\bin",
      PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
      PROCESSOR_ARCHITECTURE: "AMD64",
      PSModulePath:
        "C:\\Program Files\\WindowsPowerShell\\Modules;C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules",
      TEMP: "C:\\Users\\Person\\Temp",
      TMP: "C:\\Windows\\TEMP",
      USERNAME: "Person",
      windir: "C:\\Windows",
      NUMBER_OF_PROCESSORS: "12",
      PROCESSOR_LEVEL: "26",
      PROCESSOR_IDENTIFIER: "AMD64 Family 26 Model 36 Stepping 0, AuthenticAMD",
      PROCESSOR_REVISION: "2400",
      POWERSHELL_DISTRIBUTION_CHANNEL: "MSI:Windows 10 Pro",
      SystemRoot: "C:\\Windows",
      ProgramFiles: "C:\\Program Files",
      USERPROFILE: "C:\\Users\\Person",
      shared: "Person and %MISSING%",
      IORI_VERIFY_VALUE_d5239858093c46e0b6ef4590a25179b0:
        "8be75aa9-7770-45bd-a528-7a3e0d9358c7 日本語 with spaces",
      IORI_VERIFY_EXPAND_d5239858093c46e0b6ef4590a25179b0:
        "8be75aa9-7770-45bd-a528-7a3e0d9358c7 日本語 with spaces",
      IORI_VERIFY_EMPTY_d5239858093c46e0b6ef4590a25179b0: "",
      IORI_VERIFY_PATHPART_d5239858093c46e0b6ef4590a25179b0: "expanded",
    },
  );
  assert.deepEqual(
    windowsLoginEnvironment(
      { Path: "base" },
      JSON.stringify({
        system: [{ name: "PATH", type: "String", value: "system" }],
        user: [{ name: "Path", type: "String", value: "" }],
      }),
    ),
    { Path: "system" },
  );
});
