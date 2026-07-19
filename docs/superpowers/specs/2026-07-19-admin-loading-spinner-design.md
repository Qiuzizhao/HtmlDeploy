# Admin Loading Spinner Design

## Problem

Admin buttons use a shared `button.is-loading::before` spinner and a shared
`setButtonLoading` helper. The helper locks each button to its idle width while
loading, but the spinner is allowed to shrink as a flex item. When the loading
label is wider than the idle label, the nominally circular spinner is compressed
into a crescent. This affects all 76 admin calls to `setButtonLoading`, including
batch name review and forbidden-word deletion.

The public upload page already protects its spinner with an inline-block display
and `flex: 0 0 auto`, so it does not need a functional change.

## Design

The admin loading treatment will remain a thin rotating ring:

- The loading button becomes an inline flex container with centered content.
- The pseudo-element is an inline block with a fixed 14 by 14 pixel content box,
  a 2 pixel circular border, and `flex: 0 0 auto` so it cannot be compressed.
- The existing 8 pixel gap between the ring and label remains unchanged.
- The existing rotation timing remains unchanged.

`setButtonLoading` will preserve layout without forcing content into an
undersized box:

- On entry, record the rendered idle width as an inline `min-width`, rather than
  an exact `width`.
- The button may expand when the loading ring and label need more room, but may
  never become narrower than its idle state.
- On exit, remove the temporary `min-width` and its tracking flag.

This one shared CSS and helper change covers every admin loading button. No
per-button width rules or duplicated spinner markup will be added.

## Verification

Static regression tests will require the admin spinner to use centered inline
flex layout, an inline-block pseudo-element, and `flex: 0 0 auto`. They will also
require the helper to lock and release `min-width` instead of exact `width`.

The existing targeted admin loading tests will be run after the change. The full
test suite will also be run and compared against the eight previously accepted
baseline failures so this change introduces no additional failures.

## Scope

In scope:

- All current and future admin buttons using `setButtonLoading`.
- Batch name review and forbidden-word deletion buttons shown by the user.
- Regression coverage for shape and width behavior.

Out of scope:

- Non-button message spinners, which do not have the flex compression defect.
- Public-page loading buttons, which already use the correct non-shrinking ring.
- Changes to colors, button labels, job behavior, or loading timing.
