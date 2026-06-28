## ADDED Requirements

### Requirement: Marketplace catalog
The system MUST present platform strategy offerings on the public market page. The market page MUST include both built-in and paid strategy offerings and MUST keep them separate from the owned strategy library page.

#### Scenario: user opens the market page
- **WHEN** a user opens `/market`
- **THEN** the page shows platform built-in and paid strategy offerings
- **AND** the owned library page does not render those marketplace sections

### Requirement: Marketplace ownership actions
The system MUST let a user favorite or purchase a marketplace strategy and save the resulting owned entry into the user's strategy library.

#### Scenario: favorite a built-in strategy
- **WHEN** a user favorites a built-in marketplace strategy
- **THEN** the strategy is added to the owned library
- **AND** the library entry is marked as a favorite source

#### Scenario: purchase a paid strategy
- **WHEN** a user purchases a paid marketplace strategy
- **THEN** the strategy is added to the owned library
- **AND** the library entry is marked as a purchased source
