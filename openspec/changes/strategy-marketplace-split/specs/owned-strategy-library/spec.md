## ADDED Requirements

### Requirement: Owned strategies only
The system MUST present only user-owned strategies on `/strategies`. Marketplace catalog entries MUST NOT appear on the page unless the user has already favorited or purchased them.

#### Scenario: empty owned library
- **WHEN** a user has no owned strategies
- **THEN** the page shows an empty or starter state
- **AND** the page does not show platform marketplace cards

#### Scenario: owned items load
- **WHEN** a user has saved strategies in the owned library
- **THEN** the page lists those owned strategies
- **AND** the list can include drafted, imported, favorited, and purchased entries

### Requirement: Owned strategy workflows
The system MUST preserve the existing owned-strategy workflows for editing, duplicating, exporting, deleting, and deploying a strategy to paper.

#### Scenario: edit an owned strategy
- **WHEN** a user opens an owned strategy
- **THEN** the user can edit the strategy content
- **AND** the user can still deploy that owned strategy to paper
