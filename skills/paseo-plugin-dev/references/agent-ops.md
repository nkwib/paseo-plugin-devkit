# Agent operations for long plugin runs

- **Commit per item.** Each finished item is a commit; report hashes. Sessions end and subagents die without notice; uncommitted work is lost. When orchestrating, confirm a finished subagent's branch actually moved.
- **Durable scratch outside /tmp.** Reports, PR bodies and evidence go in the repo or a project scratch dir (gitignored). `/tmp` content can vanish mid-session.
- **Stay awake.** `ppd daemon up --caffeinate` keeps macOS awake while the daemon lives; for other long runs wrap them in `caffeinate -dims`. Laptop sleep cut off agents and timed out tests.
- **Claims need evidence.** Statements about third-party behavior (registry rules, Paseo internals) quote a source line or a command output. Statements about the plugin quote a test, screenshot or log.
- **Long processes are detached.** Daemons and watchers run with `nohup` and a pidfile, never as a foreground or background tool call that a harness limit kills.
- **Browser runs use full Chrome** (`ppd web` prefers it). Headless shell differs in media timing.
