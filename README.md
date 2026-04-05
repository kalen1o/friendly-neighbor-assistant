# Friendly Neighbor

An AI-powered chatbot agent that connects to your preferred AI provider, surfs the internet when needed, and grows smarter over time through extensible skills, hooks, and MCP integrations.

## Features

### Core Chat
- **Multi-conversation support** — Create and manage separate chats organized by topic
- **Persistent chat history** — All messages and conversations stored in a database
- **AI provider integration** — Connect via API key to your chosen AI model

### Smart Internet Research
- **Auto-detect research needs** — The agent evaluates whether a query requires live web data or can be answered from its knowledge base
- **Web surfing** — Searches and retrieves up-to-date information from the internet when needed
- **Source attribution** — References where information was found

### Extensibility
- **Skills** — Add new capabilities as modular skills the agent can invoke
- **Hooks** — Define pre/post-action hooks to customize agent behavior (e.g., logging, validation, transformations)
- **MCP (Model Context Protocol)** — Connect external tools and services to expand what the agent can do

## Tech Stack

> _To be decided_ — update this section as the stack is chosen.

| Layer         | Technology |
|---------------|------------|
| Frontend      | TBD        |
| Backend / API | TBD        |
| Database      | TBD        |
| AI Provider   | TBD        |
| Web Search    | TBD        |

## Getting Started

### Prerequisites
- An API key from your AI provider

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-org>/friendly-neighbor-assistant.git
cd friendly-neighbor-assistant

# Install dependencies
# (instructions will be added once the stack is chosen)

# Set up environment variables
cp .env.example .env
# Add your AI API key and other config to .env
```

### Running

```bash
# (start command will be added once the stack is chosen)
```

## Project Structure

```
friendly-neighbor-assistant/
├── README.md
├── .env.example          # Environment variable template
├── src/
│   ├── chat/             # Chat management and conversation routing
│   ├── agent/            # AI agent core logic and decision-making
│   ├── research/         # Internet search and research module
│   ├── skills/           # Pluggable skill modules
│   ├── hooks/            # Pre/post-action hook system
│   ├── mcp/              # MCP server integrations
│   └── db/               # Database models and migrations
└── tests/
```

## Architecture Overview

```
User <-> Chat UI <-> Backend API
                        |
                   Agent Core
                   /    |    \
             Skills   Hooks   MCP
                   \    |    /
                Research Module --- Internet
                        |
                     Database (chat history, messages, sessions)
```

## Roadmap

- [ ] Project scaffolding and tech stack setup
- [ ] Database schema for chats, messages, and sessions
- [ ] AI provider integration with API key config
- [ ] Basic chat loop (send message, get response, store in DB)
- [ ] Multi-conversation support (create, switch, delete chats)
- [ ] Research module — auto-detect when web search is needed
- [ ] Skill system — load and invoke modular skills
- [ ] Hook system — register pre/post-action hooks
- [ ] MCP integration — connect external tools
- [ ] Frontend chat UI

## License

MIT
