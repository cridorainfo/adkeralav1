# libs/

`toolkit.jar` here is Huidu's vendor SDK (originally delivered as
`toolbox_kit_1.13.0_20250717.jar.zip` — a jar file zipped for delivery; the `.jar` in this
folder is the same bytes, just un-renamed). See
[../../../ANDROID-UPDATE.md](../../ANDROID-UPDATE.md)'s "Huidu-board silent install" section for
background — it's what lets `HuiduSilentInstaller.java` install app updates silently via the
board's rooted "Toolbox" system app, with no Device Owner enrollment needed.

Any `*.jar` file placed in this folder is picked up automatically by
`app/build.gradle`'s `implementation fileTree(include: ['*.jar'], dir: 'libs')` — no gradle edit
needed.

`toolkit.jar` is Huidu's proprietary file, handed out directly by their support team — it isn't
fetchable from anywhere public, so if you're setting up a fresh clone and this file is missing,
you'll need to get it again from Huidu (or from wherever the team keeps a copy) and drop it back
here. Without it, the app still builds and runs fine: `HuiduSilentInstaller.isAvailable()` is
simply `false`, and `AdKeralaUpdateChecker` falls back to its Device Owner + PackageInstaller
update path unchanged.

`HuiduSilentInstaller.HUIDU_TECH_CLASS` (`cn.huidu.toolkit.HuiduTech`) has been confirmed against
this exact jar via `javap` — see that class's doc comment. If Huidu ever ships a new SDK version
under a different package, re-verify with:

```bash
javap -p -classpath toolkit.jar cn.huidu.toolkit.HuiduTech
```

and update the constant if it moved.

**CI note**: `.github/workflows/release.yml`'s `build-android` job builds from a fresh checkout
of this repo — if `toolkit.jar` isn't committed here, CI-built APKs won't have the Huidu path
available (they'll silently fall back to the Device Owner path, same as any non-Huidu device).
Decide with the team whether this proprietary file should be committed to the repo or supplied
to CI another way (e.g. a repo secret decoded to this path, mirroring how the release keystore is
handled) before relying on Huidu-path updates from CI-built releases.
