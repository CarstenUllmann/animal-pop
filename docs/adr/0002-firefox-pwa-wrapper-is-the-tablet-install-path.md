# 0002. The tablet install path is Firefox's PWA wrapper

M0's kill criterion was "if PWA install fails on the device, switch to a Capacitor APK". On the target
tablet the install itself succeeded but the app never started: the WebAPK Chrome mints for this origin
declares `minSdkVersion: 24` while its `classes.dex` is DEX version 039, and Android 8.1 loads at most
DEX 038, so the shell throws `ClassNotFoundException` on its own `SplashContentProvider` before any page,
console or boot trace can exist. That shell is produced server-side by Chrome, so nothing in the app can
change it. We install the same URL through Firefox 158's PWA wrapper instead, and the app runs there.

## Considered options

- **Chrome's WebAPK** — the standard Android install path, and the one §2's Chrome 61 baseline was written
  against. Unfixable from app code on this device, so it is out.
- **A Capacitor APK** — M0's stated fallback. It would work, but it adds a second runtime for a game that
  runs fine in a browser shell; the fallback is worth taking only when no PWA shell works, and one does.
- **Firefox's PWA wrapper** — chosen. Verified on the device on 2026-10-25: full-screen with no toolbar or
  address bar, its own task, cold launch from cache in airplane mode, resume, rotation, reduced motion read
  from the system animation scales.

## Consequences

The effective engine is Gecko, not Chrome 61, so the Chrome 61 parse surface in `src/baseline.test.ts` and
the `chrome61` build target are now a defensive floor rather than the engine the device runs: a
Firefox-only incompatibility can pass CI and still fail on the tablet. The debug overlay's engine token
only recognised Chromium when this was written — issue #30 taught it to name Firefox too, so a trace taken
inside the wrapper now reads `Firefox/158` (§14.3). `?debug=1` is not reachable as an installed launch
because the launcher uses the manifest's start URL — the environment rows are read from a browser tab on
the same origin, and a boot failure inside the wrapper is read through the plain fallback panel. The full
checklist read green on 2026-10-27 (issue #20). The install path is not something the app controls, so
§16.3's install row has to be re-checked on any new device rather than assumed, and the broken WebAPK
should be uninstalled so the child does not get a crash icon next to the working one.
