## MODIFIED Requirements

### Requirement: Deployable strategy versions
The strategy library SHALL create immutable versions with a content hash and
parameter schema before a strategy can be deployed.

#### Scenario: Save version
- **WHEN** a user saves a strategy change
- **THEN** the system creates a new immutable version and preserves prior
  versions used by deployments

#### Scenario: Deploy current version
- **WHEN** the user deploys a strategy
- **THEN** the deployment references a version id and snapshot rather than
  reading the mutable strategy library row during runtime
