## Why

The strategy surface currently mixes platform offerings with user-owned records, so the `/strategies` page reads like both a marketplace and a private library at once. Splitting those concerns makes ownership clearer and gives the marketplace a proper home for built-in and paid strategies.

## What Changes

- Move platform built-in and paid strategy listings out of `/strategies` and into the strategy market page.
- Keep `/strategies` focused on user-owned strategies such as drafted, imported, favorited, and purchased entries.
- Preserve the existing strategy editing, export, delete, and paper-deploy workflows for owned strategies.
- Add marketplace actions that let users favorite or purchase a strategy and save it into their owned library.
- Update navigation and page copy so the two surfaces describe their separate roles clearly.

## Capabilities

### New Capabilities
- `strategy-marketplace`: Browse platform strategy offerings on the market page and add chosen items to the owned library.
- `owned-strategy-library`: Manage only user-owned strategies on the strategies page.

### Modified Capabilities
- None.

## Impact

- Frontend route split between `/market` and `/strategies`.
- Frontend strategy catalog data, owned-library persistence flow, and page copy.
- Existing strategy persistence API stays in place and continues to back user-owned strategies.
