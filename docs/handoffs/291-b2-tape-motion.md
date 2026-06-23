# HO 291 — B2 tape: counter-scroll + edge-fade

The two strips' data and composition are done (289/290). This is the motion pass: opposite scroll directions and edge fades. Small and CSS-side.

## Counter-scroll

The two stacked marquees should move in opposite directions so they read as distinct feeds: MARKETS right-to-left, ODDS left-to-right. Locate the marquee animation (whatever drives the current scroll) and set the two directions opposite. If MARKETS is already R→L, this is just reversing ODDS.

The pinned labels (274) sit outside the scrolling track, so they don't move; confirm reversing a track's direction doesn't disturb its label or the K/P tags riding in the content.

## Edge-fade

Both strips should fade at their left and right edges instead of hard-clipping, so items dissolve in and out at the container bounds. Add a horizontal mask (transparent → opaque → transparent) on the scrolling track only, not the whole strip, so the pinned label stays fully opaque ahead of the fade.

## Notes

- Don't touch the roster, the tags, or the data; this is direction + mask only.
- The hover box is the next and last B2 pass.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify both strips scroll in opposite directions, edges fade, pinned labels and K/P tags intact, no clip.
