# PLATYPUS

A local-first desktop media tracker for movies, series, episodes, watch history, and collections. The library and tracking data are stored locally. PLATYPUS includes Kitsu and TVmaze as enabled public metadata sources, and you can add other sources.

## Install a release

Download the latest Linux package from [GitHub Releases](https://github.com/StefanMarAntonsson/PLATYPUS/releases):

- Debian/Ubuntu: download the `.deb` file and run `sudo apt install ./PLATYPUS_*_amd64.deb`.
- Other supported Linux distributions: download the `.AppImage`, run `chmod +x PLATYPUS_*.AppImage`, then launch it.

Each release includes a `SHA256SUMS` file for verifying downloads.

## Update an installation

- AppImage: updater-enabled releases check GitHub automatically. When a signed
  update is available, choose **Install and restart** in the update notice or in
  **Settings → General → Application updates**.
- Debian/Ubuntu: download the newer `.deb` from GitHub Releases and run
  `sudo apt install ./PLATYPUS_*_amd64.deb`. PLATYPUS deliberately leaves these
  installations under APT's control instead of replacing package-owned files.

Versions installed before the in-app updater was introduced must be upgraded
manually once. Library data is stored separately from the application package
and remains in place across upgrades.

Maintainers can publish a release by following the
[release guide](docs/releasing.md).

## Run the desktop app

Install the [Arch Linux prerequisites](docs/desktop-development.md), then use the project toolchain:

```sh
vp install
vp run desktop:dev
```

The first desktop launch creates the SQLite library automatically. **Search** uses the enabled Kitsu and TVmaze sources to find and add media; choose **Add manually** to track a movie or series without a source. In **Settings → Sources**, you can disable either built-in source, configure another REST/JSON or GraphQL search endpoint, or use **Import sources** to load a trusted `platypus-sources.json` bundle. **Export all** saves the configured connections as one portable file.

The in-app source form creates search-only connections. Search results from those connections can be added using the metadata returned by the search endpoint. Kitsu and TVmaze support details refresh; other sources need a trusted imported bundle that declares details, episode refresh, or tracking operations.

PLATYPUS includes no telemetry. Searching or refreshing through an enabled source sends requests directly to that provider. Refreshing a title can also use another enabled source to find air times or streaming links. See [Privacy and network activity](docs/privacy.md) for details.

Run `vp check`, `vp test`, and `vp build` for frontend validation. Run `vp exec tauri build --no-bundle` for a quick native release build, or `vp run desktop:build` to produce configured Linux bundles.

Current limitation: authenticated templates can be imported but cannot execute yet because native credential storage has not been implemented. Unauthenticated HTTPS templates and locally stored tracking are usable.

## Security

Report suspected vulnerabilities privately through GitHub rather than opening a public issue. See the [security policy](SECURITY.md) for instructions.

## License

PLATYPUS is available under the [MIT License](LICENSE).
