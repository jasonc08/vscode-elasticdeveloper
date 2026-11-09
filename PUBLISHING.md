# Publishing to the VS Code Marketplace

This guide walks through publishing `elasticdeveloper` from this repository to the
[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/).

All commands are run from the repository root.

---

## 0. What gets published

| Item | Where it comes from |
|---|---|
| Extension id | `<publisher>.<name>` → `crasnam.elasticdeveloper` |
| Version | `version` in `package.json` |
| Icon | `icon` in `package.json` → `images/icon.png` (128×128 PNG) |
| Code | `out/**` (compiled from `src/**` by `npm run compile`) |
| Runtime data | `resources/**` (REST spec + intelliSense overlays), `syntaxes/**`, `languages/**` |
| Runtime deps | `node_modules/` — only entries listed under `dependencies` |

Files excluded from the package are listed in [.vscodeignore](.vscodeignore).

> `node_modules` is **not** installed by the Marketplace when a user installs the
> extension. Everything the extension `require`s at runtime must be inside the
> `.vsix`, so keep runtime packages under `dependencies` and build/test tools under
> `devDependencies`.

---

## 1. Prerequisites

- Node.js 18 or newer
- A [Microsoft account](https://account.microsoft.com/) — this becomes your
  Marketplace publisher identity
- A [Personal Access Token (PAT)](https://dev.azure.com/_usersSettings/tokens) for
  the Azure DevOps organisation that owns the publisher

### 1.1 Create a publisher (one time)

1. Sign in at <https://marketplace.visualstudio.com/manage> with your Microsoft account.
2. Click **Create publisher**.
3. Fill in:
   - **ID** — this is the `publisher` value in `package.json`. This project already
     uses `crasnam`, so use that ID (or update `publisher` in `package.json` to
     match whatever ID you create).
   - **Name** — display name shown on the listing.
4. Save.

> The publisher ID is permanent and appears in every install command
> (`code --install-extension crasnam.elasticdeveloper`).

### 1.2 Create a Personal Access Token (one time)

1. Go to <https://dev.azure.com/_usersSettings/tokens> → **New Token**.
2. Set:
   - **Organization** — *All accessible organizations* (or the specific org that
     owns the publisher)
   - **Scopes** — *Custom defined*, then enable **Marketplace → Manage**
3. Copy the token. You will not be able to see it again.

---

## 2. Install the packaging tool

`@vscode/vsce` is already a dev dependency:

```bash
npm install
npx vsce --version
```

---

## 3. Build and verify locally

Always build before packaging. `vsce` also runs `vscode:prepublish`
(`npm run compile`) automatically, but running it yourself surfaces compile
errors early:

```bash
npm run compile
```

Expected: no output and `out/extension.js` exists.

Optional smoke test in a real editor:

```bash
npm test
```

This downloads a VS Code build into `.vscode-test/` and runs the Mocha suite from
`out/test/index.js`.

---

## 4. Bump the version

Marketplace rejects a version that was already published, so bump it for every
release. Use semver:

| Change | Example |
|---|---|
| Bug fix | `1.2.14` → `1.2.15` |
| New feature, backward compatible | `1.2.14` → `1.3.0` |
| Breaking change | `1.2.14` → `2.0.0` |

Edit `version` in `package.json`, or let `vsce` do it:

```bash
npx vsce publish patch   # 1.2.14 -> 1.2.15
npx vsce publish minor   # 1.2.14 -> 1.3.0
npx vsce publish major   # 1.2.14 -> 2.0.0
```

Also update [CHANGELOG.md](CHANGELOG.md) — it is shown on the Marketplace page.

---

## 5. Package the `.vsix`

A `.vsix` is the actual installable archive. Producing one locally is the safest
first step: you can install it and test before anything becomes public.

```bash
npx vsce package
```

Output: `elasticdeveloper-<version>.vsix`.

Useful flags:

| Flag | Purpose |
|---|---|
| `--out <file>` | Write the archive somewhere else |
| `--no-git-tag-version` | Do not create a git tag / commit for the version |
| `--pre-release` | Mark the release as a pre-release build |
| `--allow-missing-repository` | Skip the repository check (only for private forks) |

Inspect what went into the archive:

```bash
npx vsce ls
```

Things to check:

- `images/icon.png` is present
- `out/extension.js` is present
- `resources/**` is present
- `src/**`, `demo/**`, `out/test/**` are **absent**
- `node_modules` contains only runtime packages

Install and test the archive:

```bash
code --install-extension elasticdeveloper-1.2.14.vsix --force
```

Then open a `.esquery` file and try `Ctrl+Space` inside a `_search` body.

---

## 6. Publish

### 6.1 Interactive login (easiest)

```bash
npx vsce login crasnam
```

Paste the PAT when prompted. `vsce` stores it for this publisher.

### 6.2 Publish from source

```bash
npx vsce publish
```

This compiles via `vscode:prepublish`, packages, and uploads.

### 6.3 Publish a pre-built archive

If you already validated a `.vsix` in step 5:

```bash
npx vsce publish --packagePath elasticdeveloper-1.2.14.vsix
```

### 6.4 Publish with the token inline (CI)

```bash
npx vsce publish -p <TOKEN>
```

> Never commit a token. In CI, keep it in a repository secret and pass it as an
> environment variable, e.g. `VSCE_PAT`.

---

## 7. Verify the listing

1. Open <https://marketplace.visualstudio.com/manage> → **Extensions**.
2. The new version may stay in *Verifying* for a few minutes while the Marketplace
   scans the package.
3. Open the public page and check:
   - icon renders
   - README content and screenshots load (relative paths from the repo root work)
   - CHANGELOG section is present
   - supported VS Code version matches `engines.vscode`

Install from the Marketplace as an end user would:

```bash
code --install-extension crasnam.elasticdeveloper
```

---

## 8. Common errors

| Error | Cause | Fix |
|---|---|---|
| `ERROR Missing publisher name` | `publisher` missing in `package.json` | Add it, or create the publisher first |
| `ERROR The Personal Access Token verification has failed` | PAT expired, wrong org, or missing *Marketplace → Manage* scope | Create a new PAT with the right scope |
| `ERROR Version 1.2.14 already exists` | Re-publishing the same version | Bump `version` |
| `ERROR Extension entrypoint(s) missing` | `main` points at a file that was not built | Run `npm run compile`; confirm `out/extension.js` exists |
| `ERROR Icon not found` | `icon` path wrong, or not a 128×128 PNG | Fix the path; regenerate with `node scripts/generate-icon.js` |
| `WARNING This extension consists of N files` | Archive is large | Trim `.vscodeignore`, bundle with esbuild, or split resources |
| `ERROR Make sure to edit the README.md` | Placeholder README content | Write a real README |
| `ERROR Repository field is missing` | No `repository` in `package.json` | Add it (it is already set here) |

---

## 9. Release checklist

- [ ] `npm run compile` passes
- [ ] `version` bumped in `package.json`
- [ ] `CHANGELOG.md` has an entry for the new version
- [ ] `npx vsce package` succeeds
- [ ] `npx vsce ls` shows no `src/`, `demo/`, `out/test/`, or dev `node_modules`
- [ ] `.vsix` installed locally and autocomplete verified
- [ ] `npx vsce publish` succeeds
- [ ] Marketplace page shows the new version, icon, and changelog
- [ ] `git push` the version bump and tag (if `vsce` created one)

---

## 10. Rolling back

The Marketplace has no "delete version" button, but you can:

- **Unpublish the whole extension**: manage page → right-click the extension →
  *Unpublish*. Existing installations keep working; new installs are blocked.
- **Ship a fixed version**: bump the patch version and publish again. This is
  almost always the better option.

---

## Reference

- Publishing extensions: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- `vsce` CLI: <https://github.com/microsoft/vscode-vsce>
- Extension manifest fields: <https://code.visualstudio.com/api/references/extension-manifest>
- Marketplace management: <https://marketplace.visualstudio.com/manage>
