# {{name}}

A Paseo plugin that reacts to agent turns. When a turn that used tools ends, the server appends a
"Turn summary" card to the agent's timeline: files written or edited and shell commands run. The card's
"All turns" button opens a screen that lists every summary for that agent through an RPC.

- `index.server.ts`: `server.on("agent.turn_ended")` plus `paseo.agents.ref(id).timeline.append(...)`.
- `server/summarize.ts`: pure turn-to-summary logic, unit tested in `test/summarize.test.ts`.
- `shared/turn-summary.ts`: the card schema and the list RPC.
- `client/summary-card.tsx`: the timeline renderer. Renderers get no navigation props, so it closes over the
  `client` passed to `contribute` and calls `client.openScreen(...)`.
- `client/summaries-screen.tsx`: the screen the card opens.

Appended rows live in daemon memory: they are gone after a daemon restart.

## Develop

```sh
npm install
npm run check                          # ppd check against the installed Paseo app
npm test                               # unit tests plus the host-contract suite
npx ppd daemon up --fake-agent --workspace /tmp/{{id}}-ws
npx ppd install
npx ppd paseo -- run --provider fake-agent --cwd /tmp/{{id}}-ws '{"steps":[{"write":{"path":"notes.md","content":"hi"}},{"say":"done"}]}'
npx ppd web --shot out/card.png        # open the agent to see the card
npx ppd daemon down
```

`--fake-agent` installs a credential-free provider that runs a scripted turn (see the devkit README,
"Fake agent"). Real providers need their own credentials on the dev daemon.
