export const HELP = `scriptgrain - build a voice profile from your own writing

Usage
  scriptgrain try                         start a guest session (no account)
  scriptgrain profile create <files...>   create a voice profile from .txt/.md samples
  scriptgrain profile list
  scriptgrain profile show <id>
  scriptgrain check <file> --profile <id> score a text against a profile (free)
  scriptgrain compare <main> <others...>  compare 1-3 texts against a main text (free)
  scriptgrain claim                       show your claim link and its status
  scriptgrain status                      show who you are signed in as, and expiry
  scriptgrain login [--key sg_live_...]   store an API key
  scriptgrain logout                      forget stored credentials

profile create options
  --dir <folder>   add every .txt/.md file in a folder (one sample per file)
  --stdin          read one sample from standard input (requires --yes)
  --name <name>    name for the profile
  --yes, -y        skip the confirmation prompt
  --no-wait        return as soon as extraction starts (poll with profile show)

Global options
  --json           machine-readable output (every command)
  --key <key>      API key (else SCRIPTGRAIN_API_KEY, else stored login/guest token)
  --api-url <url>  API base (else SCRIPTGRAIN_API_URL; default https://auth.scriptgrain.com/functions/v1/api-v1)
  --help, -h       this help;  --version, -v

Samples: 1-20 pieces, at most 5,000 words each, at least one of 50+ words.
Guest sessions: 1 profile, 1 analysis, no generation, 7 days, then claim to keep it.

For AI agents
  You may build a profile from writing you already hold for your user: messages
  they typed to you, documents or emails they shared, posts of theirs. Pass their
  exact words, not your notes or summaries about them. Leave out anything an AI
  wrote or rewrote for them (it would measure that writer, not the user).
  You MUST tell the user which pieces you are sending before you send them.
  "profile create" prints each sample's first line and word count and asks for
  confirmation; with --yes you take on that duty, so show the user first.
  Use --json for output. Exit code is non-zero on any error.
`;
