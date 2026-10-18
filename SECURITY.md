# Security policy

## Reporting a vulnerability

Report privately through GitHub: open the **Security** tab of this repository and use **Report a vulnerability**. Please do not open a public issue for a security problem.

You should get an acknowledgement within 7 days. If the report is accepted, the fix ships in a new release and the advisory is published with credit to you unless you ask otherwise. If it is declined, you get the reasoning and are free to disclose.

A vulnerability in Paseo itself (the daemon, the app or the plugin host) belongs to the Paseo project: report it to [getpaseo/paseo](https://github.com/getpaseo/paseo) through its own security process.

## Scope

In scope: anything that lets `ppd` or the library reach the user's real Paseo (port 6767, `~/.paseo`, a non-temp `PASEO_HOME`), delete or signal something it did not create, leak `PASEO_*` session variables into plugin code or the dev daemon, run a fake-agent `bash` step outside a dev daemon, or take a public action (push, tag, PR, registry change) without the confirmation it promises.

Out of scope: the `docs-site/` directory and anything under `examples/` and `templates/` beyond what `ppd create` copies, the behavior of Paseo itself, and plugin code you choose to run with `ppd check` (it runs in a child process with a timeout, not a sandbox). Denial of service through deliberately malformed input to a local developer tool is also out of scope unless it escalates beyond the calling process.

## Supported versions

`paseo-plugin-devkit` is pre-1.0. Only the latest version published on npm receives security fixes. There are no maintained release branches.

## Release integrity

Releases are published by `.github/workflows/release.yml` on a `v*` tag through npm Trusted Publishing. There is no long-lived npm token in this repository, and every published version carries an npm provenance attestation that links it to the commit and workflow run that built it.

Verify what you installed:

```sh
npm audit signatures
```
