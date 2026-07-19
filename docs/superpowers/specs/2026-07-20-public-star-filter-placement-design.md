# Public Star Filter Placement Design

## Problem

The public page renders `全部作品` dynamically as the first class tab, while
the `星标` filter lives in the separate search and ordering row. The requested
layout places `星标` immediately to the right of `全部作品`.

## Design

Reuse the existing `#starredFilterButton` element and its current filtering
logic. During `renderClasses`, create a dedicated primary-tab row, append the
dynamically created `全部作品` button and the existing star filter button to
that row, then append the row before all class groups.

The primary row will:

- use horizontal flex layout with an 8 pixel gap;
- keep both buttons on the same line on desktop and narrow screens;
- remain the first row inside `.class-tabs`;
- preserve the existing active states, colors, labels, click listener, and
  accessibility attributes.

The project filter row will retain only the search input and ordering button.
Class group rendering, refresh placement, filtering behavior, and data loading
remain unchanged.

## Verification

Static regression tests will require the primary row to receive both existing
buttons in the correct order and to precede class group rendering. They will
also require the horizontal non-wrapping CSS and verify that the star button is
no longer declared inside the project filter row.

The focused public-filter tests and full suite will be run. No new failure may
be introduced beyond the eight accepted baseline failures.

## Scope

Implementation changes are limited to `public/index.html` and
`test/app.test.js`. No API, filter state, star metadata, project card, admin
page, or server behavior changes are included.
