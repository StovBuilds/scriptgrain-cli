# scriptgrain

Command line for [ScriptGrain](https://scriptgrain.com). Build a voice profile from your own writing, with no account to start. Zero runtime dependencies, Node 18+.

```
npx scriptgrain try
npx scriptgrain profile create essay1.md essay2.md post.txt
```

## For people

1. `scriptgrain try` starts a 7-day guest session and prints a claim link. The token is stored in `~/.config/scriptgrain/config.json` (mode 600).
2. `scriptgrain profile create <files...>` reads `.txt`/`.md` files (one sample each), shows you the first line and word count of each, asks to confirm, sends them, waits for the analysis and prints the narrative and top attributes.
3. Open the claim link to sign up. The profile becomes yours; writing in this voice is the paid step.

A guest gets one profile and one analysis, no generation. Free checks (`check`, `compare`) work too.

## Commands

| Command | What it does |
|---|---|
| `try` | Start a guest session |
| `profile create <files...> [--dir <folder>] [--name] [--stdin] [--yes] [--no-wait]` | Create a profile from samples |
| `profile list`, `profile show <id>` | List or inspect profiles |
| `check <file> --profile <id>` | Voice-match score for a text (free) |
| `compare <main> <others...>` | Compare 1-3 texts to a main text (free) |
| `claim`, `status` | Claim link and session status |
| `login [--key sg_live_...]`, `logout` | Store or forget an API key |

Global: `--json`, `--key`, `--api-url`. Env: `SCRIPTGRAIN_API_KEY`, `SCRIPTGRAIN_API_URL`, `SCRIPTGRAIN_CONFIG_DIR`. Credential order: `--key`, env, stored `sg_live_` key, stored guest token.

Samples: 1-20 pieces, at most 5,000 words each, at least one of 50+ words, 50,000 total (25,000 for a guest). Checked locally before anything is sent.

## For AI agents

You can build a profile from writing you already hold for your user: messages they typed to you, documents or emails they shared, posts of theirs.

- Use their **exact words**. Not your summaries or notes about them: those measure you, not them.
- Leave out anything an AI wrote or rewrote for them.
- **Show the user what you are sending before you send it.** `profile create` prints each sample's first line and word count and asks to confirm. `--yes` skips the prompt and makes showing the user your job. `--stdin` requires `--yes`.
- Use `--json`. Errors are `{ "error": { "code", "message" } }` on stdout; exit code is non-zero (1 API/runtime error, 2 usage or validation).
- On `guest_not_allowed`, give the user the claim link: claim your profile to start writing in this voice.

```
scriptgrain try --json
scriptgrain profile create --dir ./my-writing --yes --json
```

## Tests

`npm test` (node:test, mocked fetch; no network).

MIT.
