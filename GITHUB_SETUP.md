# Put Physics Index on GitHub

You have two alternatives. Choose **A** for the simplest website upload, or **B** to keep the complete development project and optional backend. Do not mix the two layouts in the same repository.

The default website searches Crossref, OpenAlex, and INSPIRE directly. It includes author-name mode, multiple physics-area selection, entries-per-page controls, Load more, citation-source labels, and OpenAlex citing-paper links. It needs no backend, API key, build command, or ChatGPT account. Availability still depends on the providers' current access policies, limits, and browser CORS support. The optional backend adds the other sources where access permits; NASA ADS needs a token.

GitHub Pages is public website hosting. Choose a **public repository** for the GitHub Free route. Do not upload passwords, API keys, private documents, or personal data. Your existing ChatGPT-hosted site is separate and is not changed by uploading these files.

## A. Easiest: website-only ZIP, using your browser

Use `physics-index-pages.zip`.

1. Download the ZIP and unzip it on your computer. **Upload the extracted contents, not the ZIP file.**
2. Sign in to [GitHub](https://github.com), click **+ → New repository**, and name it `physics-index` (or another name you like).
3. Select **Public**, enable **Add a README file**, and click **Create repository**. This creates the `main` branch. You can keep the automatically generated README.
4. In the repository's **Code** tab, choose **Add file → Upload files**.
5. Open the extracted folder. Drag its files **and the `js` folder** into GitHub's upload area. Do not drag the enclosing ZIP folder itself. There must be an `index.html` at the repository's top level, not inside another folder. You may include the supplied license and this guide.
6. Enter a short message such as `Add Physics Index`, then commit the upload to `main`. If GitHub asks you to propose changes in another branch, open and merge that pull request before continuing.
7. Open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**. Select branch **main** and folder **/(root)**, then click **Save**.
8. Wait for the deployment to finish. Refresh **Settings → Pages** to find the published address, usually `https://YOUR-USERNAME.github.io/physics-index/`.
9. Open the address and search for a concept or DOI. Test `10.1016/j.physleta.2026.131579`; it should show source-labeled citation counts and an OpenAlex citing-paper link when that source responds.

Your repository should look like this:

```text
index.html
citations.html          DOI-to-OpenAlex citation lookup page
styles.css
app.js
js/
  config.js
  core.js
  providers.js
  subjects.js
  citation-lookup.js
  citations-page.js
LICENSE
GITHUB_SETUP.md
README.md               Optional, created by GitHub
```

Do **not** select GitHub Actions as the Pages source for this website-only package. Use `main` and `/(root)` as above. The standard Pages service handles publication; you do not need a custom workflow.

To update later, upload the revised website files to the same locations, preserving the `js` folder structure, then commit. Pages republishes them. If the browser shows an old version, reload the page.

## B. Complete project: source ZIP with GitHub Actions

Use `physics-index-github-source.zip`. This is the best choice for developing the engine or adding the optional backend later.

1. Unzip the package. It contains `dist`, `worker`, `tests`, `.github`, `.gitignore`, `package.json`, `README.md`, `GITHUB_SETUP.md`, and `LICENSE`. It deliberately excludes the existing site's private deployment configuration, Git history, and credentials.
2. Create a public GitHub repository, initialize it with a README, and upload the **contents** of the extracted package at the repository root. `dist/index.html` must remain inside `dist`; do not flatten it in this option.
3. Include the hidden `.github` folder. On macOS, press **Command–Shift–.** in Finder to show hidden files; on Windows enable **View → Show → Hidden items**. Verify on GitHub that `.github/workflows/pages.yml` exists. If the upload skips it, choose **Add file → Create new file**, enter `.github/workflows/pages.yml` as the filename, paste the contents of that file from the extracted package, and commit it. Include `.gitignore` too if you will develop locally.
4. In **Settings → Pages**, select **GitHub Actions** as the source. Do not add another workflow: the supplied workflow publishes `dist/`.
5. Open **Actions → Deploy Physics Index to GitHub Pages → Run workflow**, select `main`, and run it. If Actions are disabled, enable them for this repository. An initial failure before Pages was enabled can be rerun now.
6. When the run succeeds, follow its deployment link or the address shown in **Settings → Pages**. Future pushes to `main` redeploy automatically.

The complete repository layout is:

```text
.github/workflows/pages.yml
.gitignore
dist/                   The website, with index.html and js/
worker/                 Optional backend, not deployed by Pages
tests/                  Automated tests
package.json
README.md
GITHUB_SETUP.md
LICENSE
```

No installation or build is needed for the website. The workflow uploads only `dist/`; Pages does not run `worker/`.

### Optional: upload with Git instead

For this method, create an **empty** repository on GitHub (without adding README or license). Open a terminal in the extracted complete-source folder and run the commands below. Replace `YOUR-USERNAME` and `physics-index` with your repository's actual values. Authenticate using GitHub's supported sign-in method, never by putting a token into a URL.

```bash
git init -b main
git add .
git commit -m "Add Physics Index"
git remote add origin https://github.com/YOUR-USERNAME/physics-index.git
git push -u origin main
```

Then follow steps 4–6 in option B. Do not run these initialization commands inside an existing unrelated Git repository.

## Optional backend and additional sources

Use the complete-source package and follow **Enable all sources with the optional gateway** in [README.md](README.md). You need your own Cloudflare account and Node.js to deploy the Worker. Keep the `dist` and `worker` folders together locally: the Worker imports shared modules from `dist/js`.

The backend is a separate deployment. Put its public address in `dist/js/config.js`, but store API keys only as Worker secrets. Set its allowed origin to `https://YOUR-USERNAME.github.io` (no repository path). Be aware of hosting/provider quotas and any charges on plans you choose.

The current gateway is an optional small-instance starting point, not a high-traffic service. It returns one batch and does not yet implement Load more; the direct two-source mode does. arXiv requests need additional global pacing before multi-user production use. See the README for these limits.

## If something does not work

Updated citation links now work for DOI results retrieved only from Crossref. Clicking the link looks up the DOI in OpenAlex before opening the citing-paper list. For an existing GitHub installation, upload **all** revised website files, including `citations.html` and the new files in `js/`, not just `index.html`. Keep your own gateway URL if you customized `js/config.js` (or `dist/js/config.js` in the complete-source layout).

- **404 or blank site:** check that option A has `index.html` at the root with branch publication, or option B has `dist/index.html` with the supplied GitHub Actions workflow. Do not upload just the ZIP.
- **The source code appears instead of the website:** use the Pages address from Settings, not the repository's `github.com` address.
- **Only three sources are live:** that is expected in the default GitHub Pages mode. arXiv and Semantic Scholar need the optional backend; NASA ADS needs the backend and its token.
- **A provider is unavailable:** check the source-status label and retry later. Hosting the website does not bypass provider outages or limits.
- **No Load more for a DOI:** exact identifiers return the matching record; Load more is for keyword/question searches.
- **A citation count differs elsewhere:** each label identifies the index that reported it. OpenAlex's citing-paper list is not a merged list from all sources.
- **OpenAlex asks for verification:** its external website may display a security check before showing citing papers. This is separate from Physics Index and does not change the reported count.
- **Opening the HTML on your computer does not work:** serve it locally over HTTP; double-clicking `index.html` is not supported. Complete-source instructions are in README.md.

## Official guidance

Instructions checked on 13 September 2026. GitHub's labels can change; these official pages cover the same process:

- [Upload files through GitHub](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [Choose a GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Use a custom Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
