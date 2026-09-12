import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`);
const activation = await jiti.import(
  resolve(new URL("../lib/tool-activation.ts", import.meta.url).pathname),
);

function makeHosts() {
  const handlers = new Map();
  const shared = { active: ["read", "document_analysis_load", "document_analysis_list", "Agent"] };
  const writes = { bridge: 0, permission: 0 };
  const make = (role) => ({
    on(name, handler) {
      const registered = handlers.get(name) ?? [];
      registered.push(handler);
      handlers.set(name, registered);
    },
    getActiveTools() { return [...shared.active]; },
    setActiveTools(names) { writes[role] += 1; shared.active = [...new Set(names)]; },
  });
  return { bridge: make("bridge"), permission: make("permission"), handlers, active: () => [...shared.active], writes };
}

async function emit(handlers, event, context) {
  for (const handler of handlers.get(event) ?? []) await handler({}, context);
}

function installPermissionReconciler(hosts, allowedNames) {
  activation.setPermissionAllowedTools(hosts.permission, allowedNames);
  activation.registerToolActivationReconciler(
    hosts.permission,
    "pi-permission-system",
    (names) => hosts.permission.setActiveTools(activation.filterToolNamesForActivation(hosts.permission, names)),
  );
}

const group = {
  id: "document-analysis.operations",
  owner: "document-analysis-bridge",
  tools: ["document_analysis_list", "document_analysis_status"],
  defaultActive: false,
};
const allowedNames = [
  "read", "document_analysis_load", "document_analysis_list", "Agent",
];

for (const order of ["bridge-first", "permission-first"]) {
  test(`activation groups honor permission reconciliation (${order})`, async () => {
    const hosts = makeHosts();
    const sessionId = `tool-activation-${order}-${process.pid}-${Date.now()}`;
    const context = { sessionManager: { getSessionId: () => sessionId } };

    if (order === "bridge-first") {
      activation.registerToolActivationGroup(hosts.bridge, group);
      activation.resetToolActivationGroups(hosts.permission);
    } else {
      activation.resetToolActivationGroups(hosts.permission);
      activation.registerToolActivationGroup(hosts.bridge, group);
    }
    await emit(hosts.handlers, "session_start", context);
    installPermissionReconciler(hosts, allowedNames);

    assert.equal(activation.isToolActivationActive(hosts.permission, "document_analysis_list"), false);
    assert.deepEqual(
      activation.filterToolNamesForActivation(hosts.permission, hosts.active()),
      ["read", "document_analysis_load", "Agent"],
    );
    assert.deepEqual(hosts.active(), ["read", "document_analysis_load", "Agent"]);

    const added = activation.activateToolActivationGroup(hosts.bridge, group.id);
    assert.deepEqual(added, ["document_analysis_list"]);
    assert.deepEqual(
      hosts.active(),
      ["read", "document_analysis_load", "document_analysis_list", "Agent"],
    );
    assert.equal(hosts.writes.bridge, 0, "bridge must not reconcile active tools");
    assert.ok(hosts.writes.permission > 0, "permission reconciler must own the setter");

    // Repeated loading is idempotent and preserves unrelated/core tools.
    assert.deepEqual(activation.activateToolActivationGroup(hosts.bridge, group.id), []);
    assert.deepEqual(hosts.active(), ["read", "document_analysis_load", "document_analysis_list", "Agent"]);

    // A later permission reconciliation cannot turn the group back off after
    // the loader explicitly activated it.
    hosts.permission.setActiveTools(activation.setPermissionAllowedTools(hosts.permission, [
      "read", "document_analysis_load", "document_analysis_list", "Agent",
    ]));
    assert.ok(hosts.active().includes("document_analysis_list"));

    await emit(hosts.handlers, "session_shutdown", context);
  });
}

test("activation fails closed without a reconciler and restores state after callback failure", async () => {
  const hosts = makeHosts();
  const sessionId = `tool-activation-fail-${process.pid}-${Date.now()}`;
  const context = { sessionManager: { getSessionId: () => sessionId } };
  activation.registerToolActivationGroup(hosts.bridge, group);
  activation.resetToolActivationGroups(hosts.permission);
  await emit(hosts.handlers, "session_start", context);
  activation.setPermissionAllowedTools(hosts.permission, allowedNames);

  assert.throws(
    () => activation.activateToolActivationGroup(hosts.bridge, group.id),
    /reconciliation is not registered/,
  );
  assert.equal(activation.isToolActivationActive(hosts.bridge, "document_analysis_list"), false);
  assert.deepEqual(hosts.active(), ["read", "document_analysis_load", "document_analysis_list", "Agent"]);

  let failReconciliation = false;
  activation.registerToolActivationReconciler(hosts.permission, "pi-permission-system", (names) => {
    if (failReconciliation) throw new Error("stale setter");
    hosts.permission.setActiveTools(activation.filterToolNamesForActivation(hosts.permission, names));
  });
  failReconciliation = true;
  assert.throws(
    () => activation.activateToolActivationGroup(hosts.bridge, group.id),
    /Tool activation failed.*stale setter/,
  );
  assert.equal(activation.isToolActivationActive(hosts.bridge, "document_analysis_list"), false);
  await emit(hosts.handlers, "session_shutdown", context);
});

test("permission-denied tools stay absent and a fresh session does not use a stale callback", async () => {
  const hosts = makeHosts();
  const sessionA = `tool-activation-a-${process.pid}-${Date.now()}`;
  const contextA = { sessionManager: { getSessionId: () => sessionA } };
  activation.registerToolActivationGroup(hosts.bridge, group);
  activation.resetToolActivationGroups(hosts.permission);
  await emit(hosts.handlers, "session_start", contextA);
  installPermissionReconciler(hosts, ["read", "document_analysis_load", "Agent"]);

  assert.deepEqual(activation.activateToolActivationGroup(hosts.bridge, group.id), []);
  assert.deepEqual(hosts.active(), ["read", "document_analysis_load", "Agent"]);
  await emit(hosts.handlers, "session_shutdown", contextA);

  const sessionB = `${sessionA}-replacement`;
  const contextB = { sessionManager: { getSessionId: () => sessionB } };
  await emit(hosts.handlers, "session_start", contextB);
  // The old callback is not a valid permission snapshot for the new session.
  assert.throws(
    () => activation.activateToolActivationGroup(hosts.bridge, group.id),
    /reconciliation is not registered/,
  );
  assert.equal(activation.isToolActivationActive(hosts.bridge, "document_analysis_list"), false);
  await emit(hosts.handlers, "session_shutdown", contextB);
});

test("activation groups reject ambiguous ownership", () => {
  const hosts = makeHosts().bridge;
  activation.registerToolActivationGroup(hosts, {
    id: "group-a",
    owner: "test-a",
    tools: ["shared-tool"],
  });
  assert.throws(() => activation.registerToolActivationGroup(hosts, {
    id: "group-b",
    owner: "test-b",
    tools: ["shared-tool"],
  }), /belongs to both/);
});
