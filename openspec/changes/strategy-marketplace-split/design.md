## Context

The app currently exposes a single strategy-centered workspace that includes platform catalog cards, user-owned strategy records, and editing/deployment tools. That makes the `/strategies` page do too many jobs at once and obscures which items are actually owned by the user.

The app already has:

- A persisted owned-strategy API backed by the existing strategy store.
- A public `/market` route already used for discovery-style content.
- A private `/strategies` route used for editing and paper deployment workflows.

The split can be done without introducing a new backend catalog service.

## Goals / Non-Goals

**Goals:**

- Make `/market` the place to browse built-in and paid strategy offerings.
- Make `/strategies` the place to manage only owned strategies.
- Preserve the existing owned-strategy editing and paper deployment flow.
- Let marketplace actions create owned entries without adding a new persistence stack.

**Non-Goals:**

- No real payment processing.
- No new backend marketplace database.
- No rewrite of strategy editing or paper deployment mechanics.

## Decisions

### Separate the route responsibilities

`/market` becomes a catalog-first discovery surface. `/strategies` remains the authenticated owned library.

Rationale: users can now tell at a glance which page is for browsing offerings and which page is for managing their own work.

Alternative considered: keep one mixed page with tabs. Rejected because it preserves the ownership confusion the change is meant to remove.

### Reuse the existing strategy store for owned copies

When a user favorites or purchases a marketplace strategy, the app saves an owned strategy record using the existing strategy library persistence path.

Rationale: the store already supports owned records, local fallback, and paper deployment. Reusing it avoids a new persistence model for a UI split.

Alternative considered: add a separate marketplace ownership table. Rejected as unnecessary for a catalog split.

### Keep the marketplace catalog frontend-curated

The strategy catalog stays in frontend data for now.

Rationale: the current app does not have a marketplace backend contract, and this change is about page ownership rather than catalog lifecycle management.

Alternative considered: introduce a backend catalog API. Deferred until the catalog needs server-side publishing or pricing rules.

### Mark owned copies with tags

Use ownership tags such as `favorite` and `purchased` on owned strategy entries.

Rationale: tags are already supported by the owned-strategy model and are easy to render in the library UI without a schema migration.

Alternative considered: add dedicated ownership columns. Rejected because the split does not require a persistent schema change.

## Risks / Trade-offs

- Tag-based ownership markers can drift if the same item is edited manually. -> Keep the market page as the source of truth for ownership actions and render markers from the saved record tags.
- Public market actions may fail when a user is not authenticated. -> Fall back to browser storage and keep the owned-library page resilient to either storage path.
- The frontend catalog can get stale if the platform wants server-managed merchandising later. -> Treat the catalog as a first step and add a backend marketplace service only when the product needs it.

## Migration Plan

1. Extract the marketplace catalog into a shared frontend source.
2. Move the marketplace route to a dedicated market page.
3. Remove platform catalog seeding from the owned library.
4. Keep owned-strategy persistence intact and let market actions create owned copies.
5. Add regression tests for the route split and ownership transfer flow.

## Open Questions

- Should marketplace ownership eventually sync to a backend entitlement model?
- Should favorited and purchased items be visually distinct on `/strategies`, or is the tag badge enough for v1?
