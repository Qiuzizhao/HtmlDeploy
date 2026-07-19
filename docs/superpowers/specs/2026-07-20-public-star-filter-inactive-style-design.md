# Public Star Filter Inactive Style Design

## Design

The public `星标` filter remains visually identifiable through its yellow border
and text, but its inactive state uses `background: transparent`. Hover and active
states retain the existing pale-yellow background and darker yellow border.

Only the shared `.star-filter-button` CSS and its static regression coverage
change. Filter state, click behavior, labels, accessibility attributes, placement,
responsive layout, and project-card star styling remain unchanged.

## Verification

A regression assertion will distinguish the transparent inactive rule from the
pale-yellow active rule. Focused public-filter tests and the full suite will be
run with no new failure beyond the eight accepted baseline failures.
