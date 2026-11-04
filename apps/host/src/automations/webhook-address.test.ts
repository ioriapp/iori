import assert from "node:assert/strict";
import { test } from "node:test";
import {
  webhookAddressAllowed,
  webhookAddressPriority,
} from "./webhook-address.ts";

test("private webhook addresses are ordered by their network range", () => {
  const addresses = [
    "fe80::1%eth0",
    "fd00::1",
    "169.254.1.1",
    "100.64.1.1",
    "172.17.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "192.168.2.1",
  ];
  assert.deepEqual(
    addresses.sort(
      (a, b) => webhookAddressPriority(a) - webhookAddressPriority(b),
    ),
    [
      "192.168.1.1",
      "192.168.2.1",
      "10.0.0.1",
      "172.17.0.1",
      "100.64.1.1",
      "169.254.1.1",
      "fd00::1",
      "fe80::1%eth0",
    ],
  );
});

test("webhook scope accepts the complete IPv4 loopback range, including mapped IPv6", () => {
  for (const address of ["127.0.0.0", "127.0.0.1", "127.255.255.255"]) {
    for (const value of [address, `::ffff:${address}`]) {
      assert.equal(webhookAddressAllowed(value, "local"), true, value);
      assert.equal(webhookAddressAllowed(value, "lan"), true, value);
    }
  }
  for (const address of ["126.255.255.255", "128.0.0.0"]) {
    assert.equal(webhookAddressAllowed(address, "local"), false, address);
    assert.equal(webhookAddressAllowed(address, "lan"), false, address);
  }
  assert.equal(webhookAddressAllowed("::1", "local"), true);
  assert.equal(webhookAddressAllowed("0:0:0:0:0:0:0:1", "local"), true);
  assert.equal(webhookAddressAllowed("::ffff:7f00:1", "local"), true);
});

test("LAN scope includes each private IPv4 range and excludes adjacent addresses", () => {
  const ranges = [
    ["9.255.255.255", "10.0.0.0", "10.255.255.255", "11.0.0.0"],
    ["172.15.255.255", "172.16.0.0", "172.31.255.255", "172.32.0.0"],
    ["192.167.255.255", "192.168.0.0", "192.168.255.255", "192.169.0.0"],
    ["169.253.255.255", "169.254.0.0", "169.254.255.255", "169.255.0.0"],
    ["100.63.255.255", "100.64.0.0", "100.127.255.255", "100.128.0.0"],
  ];
  for (const [before, first, last, after] of ranges) {
    for (const [address, allowed] of [
      [before, false],
      [first, true],
      [last, true],
      [after, false],
    ] as const) {
      for (const value of [address!, `::ffff:${address}`]) {
        assert.equal(webhookAddressAllowed(value, "lan"), allowed, value);
        assert.equal(webhookAddressAllowed(value, "local"), false, value);
      }
    }
  }
  assert.equal(webhookAddressAllowed("::ffff:c0a8:1", "lan"), true);
  assert.equal(webhookAddressAllowed("::ffff:0808:0808", "lan"), false);
});

test("LAN scope includes IPv6 private and link-local ranges, excluding their neighbors", () => {
  for (const address of [
    "fc00::",
    "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe80::",
    "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe80::1%eth0",
  ]) {
    assert.equal(webhookAddressAllowed(address, "lan"), true, address);
    assert.equal(webhookAddressAllowed(address, "local"), false, address);
  }
  for (const address of [
    "fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe00::",
    "fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fec0::",
    "::",
    "::2",
    "2001:db8::1",
    "8.8.8.8",
    "0.0.0.0",
    "not an address",
  ]) {
    assert.equal(webhookAddressAllowed(address, "lan"), false, address);
    assert.equal(webhookAddressAllowed(address, "local"), false, address);
  }
});
