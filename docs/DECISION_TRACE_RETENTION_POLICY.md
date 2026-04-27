# Decision Trace Retention and Compliance Policy

## Scope

This policy governs decision-trace storage used by Feature 4 explainability tooling:
- get_decision_trace
- get_decision_trace_dashboard

## Data classification

- Decision traces are operational telemetry artifacts, not clinical source-of-truth records.
- PHI-like fields are redacted at write time in the trace service.
- Any detected identifiers/tokens/contact strings are replaced with [REDACTED].

## Retention controls

Runtime controls are environment-driven:
- DECISION_TRACE_MAX_RECORDS (default 1000)
- DECISION_TRACE_MAX_AGE_MS (default 86400000, 24h)
- DECISION_TRACE_ARCHIVE_PATH (optional NDJSON append-only archive path)

Behavior:
- In-memory traces are bounded by both max records and max age.
- Completed/failed traces are optionally archived if DECISION_TRACE_ARCHIVE_PATH is set.
- Archive replay restores traces on restart (best effort) and reapplies redaction.

## Access model

- Decision trace tools are read-only MCP tools.
- Access to MCP tools must follow least-privilege runtime controls in deployment.
- No mutation/deletion tool is exposed through MCP for trace records.

## Operational checklist

- [ ] Set DECISION_TRACE_MAX_RECORDS for expected workload.
- [ ] Set DECISION_TRACE_MAX_AGE_MS to environment-specific retention target.
- [ ] Configure DECISION_TRACE_ARCHIVE_PATH for environments requiring restart durability.
- [ ] Ensure archive path is stored on encrypted volume in production environments.
- [ ] Add log rotation/backup policy for archive file if enabled.
- [ ] Validate npm run validate:feature4 in CI.

## Sign-off

- Security reviewer:
- Clinical safety reviewer:
- Platform owner:
- Date:
- Approved retention window:
- Approved archive location:
