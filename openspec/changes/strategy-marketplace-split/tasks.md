## 1. Split the strategy catalog

- [x] 1.1 Extract the platform strategy catalog into shared frontend data for market use.
- [x] 1.2 Add a dedicated market page route that renders built-in and paid strategies.
- [x] 1.3 Add favorite and purchase actions that save an owned copy into the strategy library.

## 2. Rebuild the owned library

- [x] 2.1 Remove platform catalog seeding from the owned `/strategies` page.
- [x] 2.2 Update the owned library copy, labels, and empty state to describe user-owned strategies.
- [x] 2.3 Keep editing, duplication, export, delete, and paper-deploy flows working for owned strategies.

## 3. Update navigation and wording

- [x] 3.1 Rename the strategy nav label to reflect an owned library.
- [x] 3.2 Update page copy and marketplace headings so the split is obvious.

## 4. Verify the split

- [x] 4.1 Add a regression test that the market page shows platform offerings and can save one into the owned library.
- [x] 4.2 Add a regression test that the owned library no longer renders the platform catalog cards.
- [x] 4.3 Run the targeted frontend test and build checks.
