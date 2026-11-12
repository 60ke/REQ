# Temporary packaging icon

These desktop icons are generated from `assets/req-placeholder.svg` with the
locked Tauri CLI. The neutral monogram is a temporary build resource, **not the
final Req identity**. Replace it when the app's name and visual identity are
approved.

From the project root:

```sh
npm run tauri -- icon assets/req-placeholder.svg --output src-tauri/icons
```

The generator also produces mobile and Microsoft Store images. This desktop-only
preview retains only the PNG, ICO and ICNS resources needed for its packages.
