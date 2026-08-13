# PLATYPUS

A local-first desktop media tracker for movies, series, episodes, watch history, and collections. The library and tracking data are stored locally, while user-configured metadata sources can provide searchable movies, shows, details, and artwork. PLATYPUS ships without API providers or connections configured.

## Install a release

Download the latest Linux package from [GitHub Releases](https://github.com/StefanMarAntonsson/PLATYPUS/releases):

- Debian/Ubuntu: download the `.deb` file and run `sudo apt install ./PLATYPUS_*_amd64.deb`.
- Other supported Linux distributions: download the `.AppImage`, run `chmod +x PLATYPUS_*.AppImage`, then launch it.

Each release includes a `SHA256SUMS` file for verifying downloads.

Maintainers can publish a release by following the
[release guide](docs/releasing.md).

## Run the desktop app

Install the [Arch Linux prerequisites](docs/desktop-development.md), then use the project toolchain:

```sh
vp install
vp run desktop:dev
```

The first desktop launch creates the SQLite library automatically. In **Settings → Sources**, configure a REST/JSON or GraphQL search endpoint and its response mappings, or use **Import sources** to load a trusted `platypus-sources.json` bundle. **Export all** saves the configured connections as one portable file. Then use **Search** to find and add media from the enabled sources.

The in-app source form creates search-only connections. Search results from those connections can be added using the metadata returned by the search endpoint. Details, episode refresh, and tracking operations require a trusted imported source bundle that declares those operations.

PLATYPUS includes no telemetry and ships with no API providers configured. When you use a source, your device connects directly to that provider, which receives the request data required by its API and the network information inherent in that connection. See [Privacy and network activity](docs/privacy.md) for details.

Run `vp check`, `vp test`, and `vp build` for frontend validation. Run `vp exec tauri build --no-bundle` for a quick native release build, or `vp run desktop:build` to produce configured Linux bundles.

Current limitation: authenticated templates can be imported but cannot execute yet because native credential storage has not been implemented. Unauthenticated HTTPS templates and locally stored tracking are usable.

## Security

Report suspected vulnerabilities privately through GitHub rather than opening a public issue. See the [security policy](SECURITY.md) for instructions.

## License

PLATYPUS is available under the [MIT License](LICENSE).
