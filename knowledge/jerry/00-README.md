# Jerry knowledge base

Jerry is Cartage's sales-intelligence agent. In this repo Jerry runs as a Claude
agent whose system prompt is assembled from every Markdown file in this folder
(sorted by filename). Replace these placeholder files with the real material
Jerry was trained on: offer and pricing notes, ICP and persona guidance, call
recordings turned into talk tracks, objection handling, and account notes on
existing clients.

Rules for files in this folder:

- Plain Markdown, no front matter required. Headings become sections of Jerry's context.
- Keep each file focused (one topic per file) so the prompt cache stays stable when one file changes.
- Anything here is visible to the model on every Jerry call. Do not put secrets or personal data about prospects here; live prospect data flows in per call from the account record.
- If Jerry already runs as its own service, set `JERRY_MODE=mcp` and point `JERRY_MCP_URL` (or `JERRY_MCP_COMMAND`) at it; this folder is then unused.

The files that ship with the demo are synthetic placeholders written to make the
loop demonstrable. They are not Cartage's actual positioning.
