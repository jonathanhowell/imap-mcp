# imap-mcp

An MCP server that gives AI agents access to email over IMAP. Connect one or more email accounts and agents can read mailboxes, search messages by sender, subject, date, or body text, download attachments, and monitor for new mail — all via the Model Context Protocol. Designed to work with Claude Desktop and any MCP-compatible client.

## Quick Start

1. **Clone and install:**
   ```bash
   git clone https://github.com/jonathanhowell/imap-mcp.git
   cd imap-mcp
   npm install && npm run build
   ```

2. **Copy the example config:**
   ```bash
   mkdir -p ~/.config/imap-mcp
   cp config.example.yaml ~/.config/imap-mcp/config.yaml
   ```

3. **Edit the config** — fill in your account details and set environment variables for passwords:
   ```yaml
   accounts:
     - name: personal
       host: imap.gmail.com
       port: 993
       username: you@gmail.com
       password: $GMAIL_PASSWORD
   ```
   Then export the variable:
   ```bash
   export GMAIL_PASSWORD="your-app-password"
   ```

4. **Run the server:**
   ```bash
   node build/index.js
   ```

The server reads the config from `~/.config/imap-mcp/config.yaml` by default. Override with `IMAP_MCP_CONFIG=/path/to/config.yaml`.

## Configuration Reference

The config file is YAML. Default location: `~/.config/imap-mcp/config.yaml`. Override with the `IMAP_MCP_CONFIG` environment variable.

### `accounts[]`

| Field          | Type   | Required | Default | Description                                                   |
| -------------- | ------ | -------- | ------- | ------------------------------------------------------------- |
| `name`         | string | yes      | —       | Short identifier used by tools (e.g. `personal`, `work`)      |
| `host`         | string | yes      | —       | IMAP hostname (e.g. `imap.gmail.com`)                         |
| `port`         | number | yes      | —       | Must be `993`. TLS is enforced; port 143 and 587 are rejected |
| `username`     | string | yes      | —       | IMAP login username (usually your email address)              |
| `password`     | string | yes      | —       | Use `$ENV_VAR_NAME` to read from environment variable         |
| `display_name` | string | no       | —       | Human-readable label shown in `list_accounts` responses       |

### `polling` (optional)

| Field              | Type   | Required | Default | Description                                     |
| ------------------ | ------ | -------- | ------- | ----------------------------------------------- |
| `interval_seconds` | number | no       | `300`   | How often to poll for new mail (minimum: 60s)   |

**Setting environment variables for passwords:**
```bash
export GMAIL_PASSWORD="your-app-password"
export WORK_PASSWORD="your-work-password"
```

In `config.yaml`, reference them as `$GMAIL_PASSWORD` and `$WORK_PASSWORD`.

**Performance note:** To verify performance on large mailboxes, connect to a mailbox with 10,000+ messages, run `list_messages` with default parameters, and confirm the response arrives within 5 seconds and contains only message headers (no bodies). The 200-result cap ensures response size is bounded.

## Claude Desktop Setup

Add this entry to your `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "imap-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/imap-mcp/build/index.js"],
      "env": {
        "IMAP_MCP_CONFIG": "/absolute/path/to/config.yaml",
        "GMAIL_PASSWORD": "your-app-password"
      }
    }
  }
}
```

Replace `/absolute/path/to/imap-mcp` with the directory where you cloned the repo. The `IMAP_MCP_CONFIG` key is optional — omit it to use the default `~/.config/imap-mcp/config.yaml`. Any env vars referenced in your config file (e.g. `$GMAIL_PASSWORD`) must appear in the `env` block so Claude Desktop passes them to the server process.

## Provider Compatibility

### Gmail

Gmail requires an App Password — your regular Google account password will not work with IMAP.

1. Enable IMAP in Gmail settings: **Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP**
2. Generate an App Password: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Use the generated 16-character password as `$GMAIL_PASSWORD` in your config

**Host:** `imap.gmail.com`, **Port:** `993`

### Generic IMAP

Any IMAP server that supports TLS on port 993 and Basic Auth should work. Check your provider's documentation for the correct hostname.

### Outlook / Hotmail / Microsoft 365

> **Outlook/Hotmail/Microsoft 365:** Microsoft deprecated Basic Auth for IMAP in October 2022.
> Modern Microsoft accounts require OAuth2, which this server does not currently support.
> If you are using an Outlook, Hotmail, or Microsoft 365 account, it will not work with this server.

## Tool Reference

All tools are available via MCP. `account` parameters accept the `name` field from your config. Results are capped at **200 items** for `list_messages` and `search_messages`.

### `list_accounts`

Returns all configured accounts. No parameters.

**Response:** Array of `{ account, email, display_name? }` objects.

---

### `list_folders`

| Parameter | Type   | Required | Description                                           |
| --------- | ------ | -------- | ----------------------------------------------------- |
| `account` | string | no       | Account name. Omit to list folders for all accounts.  |

**Response (single account):** Array of `{ name, delimiter, flags, messages, unseen }`.

**Response (all accounts):** Same array, sorted alphabetically by folder name.

---

### `list_messages`

| Parameter    | Type              | Required | Description                                                   |
| ------------ | ----------------- | -------- | ------------------------------------------------------------- |
| `account`    | string            | no       | Account name. Omit to query all accounts.                     |
| `folder`     | string            | no       | Folder name (default: `INBOX`)                                |
| `limit`      | number            | no       | Max messages to return (server cap: 200)                      |
| `offset`     | number            | no       | Pagination offset                                             |
| `sort`       | `newest`\|`oldest`| no       | Sort order (default: `newest`)                                |
| `unread_only`| boolean           | no       | Return only unread messages                                   |

**Response (single account):** Flat array of `MessageHeader[]` — each item includes `uid`, `from`, `to[]`, `cc[]`, `subject`, `date`, `flags`, and `folder`.

**Response (all accounts):** `{ results: MultiAccountMessageHeader[], errors?: Record<string, string> }`. The `errors` key is present only when one or more accounts failed.

---

### `read_message`

| Parameter | Type              | Required | Description                                                     |
| --------- | ----------------- | -------- | --------------------------------------------------------------- |
| `account` | string            | yes      | Account name                                                    |
| `uid`     | number            | yes      | Message UID                                                     |
| `format`  | `clean`\|`full`   | no       | `clean` strips reply chains (default). `full` returns raw body. |

**Response:** Full message with headers and body.

---

### `read_messages`

Fetch multiple messages in a single call. All UIDs must belong to the same account and folder.

| Parameter   | Type                              | Required | Description                                                         |
| ----------- | --------------------------------- | -------- | ------------------------------------------------------------------- |
| `account`   | string                            | yes      | Account name                                                        |
| `uids`      | number[]                          | yes      | List of message UIDs to fetch (max 50)                              |
| `folder`    | string                            | no       | Folder containing the messages (default: `INBOX`)                  |
| `format`    | `clean`\|`full`\|`truncated`      | no       | Body format (default: `clean`)                                      |
| `max_chars` | number                            | no       | Max body characters when `format` is `truncated` (default: `2000`) |

**Response:** Array of message objects in the same order as `uids`. Each item includes headers, body, and a `uid` field.

---

### `search_messages`

| Parameter    | Type    | Required | Description                                                                            |
| ------------ | ------- | -------- | -------------------------------------------------------------------------------------- |
| `account`    | string  | no       | Account name. Omit to search all accounts.                                             |
| `from`       | string  | no       | Filter by sender address or name                                                       |
| `subject`    | string  | no       | Filter by subject text                                                                 |
| `body`       | string  | no       | Filter by body text content (case-insensitive, server-side IMAP SEARCH BODY)           |
| `since`      | string  | no       | ISO date string — messages on or after this date                                       |
| `before`     | string  | no       | ISO date string — messages before this date                                            |
| `unread`     | boolean | no       | `true` = unread only, `false` = read only                                              |
| `folder`     | string  | no       | Folder to search (default: `INBOX`). Use `all` to search every folder sequentially.   |
| `max_results`| number  | no       | Max results to return (server cap: 200)                                                |

**Response (single account):** Flat array of `SearchResultItem[]` — each item includes `uid`, `from`, `to[]`, `cc[]`, `subject`, `date`, `flags`, and `folder`.

**Response (all accounts):** `{ results: MultiAccountSearchResultItem[], errors?: Record<string, string> }`.

**Note:** `folder='all'` searches every folder sequentially and can be slow on large mailboxes.

---

### `download_attachment`

| Parameter  | Type   | Required | Description                                                                    |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `account`  | string | yes      | Account name                                                                   |
| `uid`      | number | yes      | Message UID                                                                    |
| `part_id`  | string | no       | MIME part identifier (e.g. `2`, `2.1`). Faster when known.                    |
| `filename` | string | no       | Attachment filename. Used to look up the part ID when `part_id` is not known. |
| `folder`   | string | no       | Folder containing the message (default: `INBOX`)                              |

At least one of `part_id` or `filename` must be provided. When both are given, `part_id` takes precedence. Filename matching is case-insensitive.

**Response:** `{ filename, mimeType, size, data }` where `data` is base64-encoded.

---

### `get_new_mail`

| Parameter | Type   | Required | Description                                                                         |
| --------- | ------ | -------- | ----------------------------------------------------------------------------------- |
| `since`   | string | no       | ISO timestamp. Returns messages cached since this time. Omit for all cached unread. |

**Response:** `{ messages: CachedHeader[], polled_at: string }`. The server polls in the background at the configured interval; this tool reads from the cache, not live IMAP.

## Example Agent Prompts

Once connected to Claude Desktop, you can ask things like:

- "Show me all unread emails from the last 24 hours across all my accounts"
- "Search for emails from GitHub about pull requests in my work account from this week"
- "Find any emails mentioning the invoice number INV-2024-042"
- "Read the most recent email from alice@example.com and summarize it"
- "Read all three emails in that thread and give me a summary"
- "Download the PDF attachment from that email"

## Troubleshooting

### Connection refused / timeout

Check that `port` in your config is `993`. This server enforces TLS — port 143 (plaintext) and port 587 (SMTP submission) will not work.

### Authentication failed (Gmail)

Use an App Password, not your regular Google account password. Generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Also verify IMAP is enabled in Gmail: **Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP**.

### Authentication failed (generic IMAP)

Verify the username and password are correct. Some providers require app-specific passwords even when not using Gmail — check your provider's security settings.

### Outlook / Microsoft accounts not working

Microsoft deprecated Basic Auth for IMAP in October 2022. Microsoft 365, Outlook.com, and Hotmail accounts require OAuth2, which this server does not support. This is a Microsoft platform limitation that cannot be worked around with configuration changes.

### Server crashes on startup

Check that the config file exists at the expected path (`~/.config/imap-mcp/config.yaml` by default, or the path in `IMAP_MCP_CONFIG`). Verify that all environment variables referenced in the config (e.g. `$GMAIL_PASSWORD`) are set before launching the server.

### Performance: slow on large mailboxes

Using `folder='all'` in `search_messages` triggers a sequential search across every folder. On accounts with many folders or large mailboxes this can take several seconds. For faster results, specify a folder (e.g. `folder='INBOX'`).

## Contributing

### Dev setup

```bash
npm install
npm run build
npm test
```

### Guidelines

- TypeScript strict mode throughout — no `any` types without explicit justification
- All log output goes to stderr via `logger.ts` — never use `console.log` (enforced by ESLint)
- Pre-commit hooks run lint + tests automatically via Husky
- Install gitleaks for secret scanning (required for pre-commit hook): `brew install gitleaks`

### PR flow

Branch from `main`, open a PR, CI must pass before merging.
