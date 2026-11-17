// Public media uses a fictional OS name, as the former README fixture did.
// Host, CLI, transport and saved records still use their real implementations.
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
os.hostname = () => "workstation";
syncBuiltinESMExports();
