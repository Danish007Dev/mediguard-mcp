# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- SHARP context support across all five tools with optional `sharp_context` input.
- FHIR R4 client with pagination, OAuth refresh, and HIPAA-safe logging hooks.
- Integration tests for SHARP context flow and mock/live FHIR validation paths.
- Safety test suite for API failure handling, HIPAA log redaction, performance baseline, and secret scanning.
- API documentation in [docs/API_REFERENCE.md](docs/API_REFERENCE.md).
- Agent integration guide in [docs/AGENT_INTEGRATION_GUIDE.md](docs/AGENT_INTEGRATION_GUIDE.md).
- Clinical safety disclaimer in [docs/SAFETY_DISCLAIMER.md](docs/SAFETY_DISCLAIMER.md).

### Changed

- Expanded unit coverage for synthesis services and OpenFDA/FHIR client branches.
- Updated roadmap metrics to reflect current Phase 4 testing progress and coverage baseline.