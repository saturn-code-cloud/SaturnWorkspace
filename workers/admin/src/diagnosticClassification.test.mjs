import assert from "node:assert/strict";
import test from "node:test";

import { classifyDiagnostic, isActionableCrash } from "./diagnosticClassification.js";

test("expected prevention and validation states are not crashes", () => {
  for (const message of [
    "cancelled",
    "session_ip_already_used",
    "invalid_email_requires_at",
  ]) {
    assert.equal(classifyDiagnostic({ error_type: "HandledApiError", message }), "expected");
    assert.equal(isActionableCrash({ error_type: "HandledApiError", message }), false);
  }
});

test("recoverable operational failures are warnings", () => {
  assert.equal(classifyDiagnostic({ error_type: "GoogleDriveAutoSyncFailed", message: "Scheduled Google Drive sync failed." }), "warning");
  assert.equal(classifyDiagnostic({ error_type: "UpdateManifestError", message: "Update manifest signature is missing." }), "warning");
  assert.equal(classifyDiagnostic({ error_type: "HandledApiError", message: "[WinError 10060] timed out" }), "warning");
});

test("unknown provider and runtime failures remain actionable", () => {
  assert.equal(classifyDiagnostic({ error_type: "HandledApiError", message: "startup_preload_missing" }), "error");
  assert.equal(classifyDiagnostic({ error_type: "TimeoutError", message: "timed out", raw_payload: { context: "app.main" } }), "error");
  assert.equal(classifyDiagnostic({ error_type: "PreviousRunUnclosed", message: "previous_run_unclosed", raw_payload: { severity: "warning" } }), "warning");
  assert.equal(classifyDiagnostic({ error_type: "HandledApiError", message: "AdsPower rejected profile start" }), "error");
  assert.equal(classifyDiagnostic({ error_type: "FrontendStartupTimeout", message: "Frontend did not become ready" }), "error");
  assert.equal(classifyDiagnostic({ error_type: "OSError", message: "[Errno 22] Invalid argument" }), "error");
});

test("valid trace follow-ups are internal supplements while malformed ones remain visible", () => {
  const trace = {
    format: "saturnws.technical-trace.v1",
    run_id: "2ecda24e-2b8f-4381-9d16-15aefde2d32a",
    parent_event_id: "00000000-0000-4000-8000-000000000001",
  };
  assert.equal(classifyDiagnostic({ error_type: "DiagnosticTraceFollowup", raw_payload: { trace } }), "supplement");
  assert.equal(classifyDiagnostic({ error_type: "DiagnosticTraceFollowup", raw_payload: { trace: { ...trace, parent_event_id: "invalid" } } }), "error");
});
