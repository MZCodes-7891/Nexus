# NEXUS

Nexus is a Competent AI tool that integrates the power of the AI model Qwen to help with daily tasks like studying, and getting tasks done in a way suitable for the user.

A personal AI assistant for Windows that runs on your own computer. Chat with it, have it use your apps and files, study from your school materials, and connect the online accounts you choose.

## Install

1. Download **NEXUS Setup** from the [Releases](../../releases) page and run it.
2. Open NEXUS from the desktop or Start menu.
3. The setup screen installs the AI engine and model with a click. That's about 6 GB of downloads.

No terminal, Python, or other setup is needed. Windows may warn that the installer is from an unknown publisher, because it isn't code-signed; choose **More info → Run anyway**.

## What it does

- **AI Chat and agent:** ask in plain language and watch each step it takes. It can open apps, find files, set reminders, and chain several actions together.
- **My Apps:** a launcher for programs and websites.
- **Documents:** search and ask questions across your PDF, Word, PowerPoint, Excel, and text files.
- **Study Center:** study guides, flashcards, practice tests, quizzes, and a planner. D2L Practice builds tests only from your D2L / Brightspace course material.
- **Research:** searches the web and writes a report that cites its sources.
- **Tasks, Calendar, Reminders, Automations, and Memory.**
- **Connected Apps:** Google, Slack, Notion, and more through [Composio](https://composio.dev). This needs your own Composio API key.
- **App Control:** control Spotify and a Discord bot directly, and run any action a connected app offers.
- **Google Docs and Slides:** ask Nexus to create one and fill it with what you give it, once the app is connected.
- **Study sets:** Quizlet-style Flashcards, Learn, Test, and Match, built from your own files. Hard tests point back to the page each answer came from.
- **Calendar:** repeating events, a week summary, and Find a time, which ranks open slots by when you usually study.
- **Search:** type naturally, such as "pdfs about biology from last week" or "overdue tasks", and filter by type.
- **Suggestions, weather, and news:** Home suggests what to do next from your own data, and can show weather and headlines if you turn them on.
- **Smart home:** control lights, plugs, and more through your own [Home Assistant](https://www.home-assistant.io).
- **Languages:** main labels in French, Spanish, German, Arabic, Urdu, Hindi, and Chinese.
- **Voice:** hold the button and talk. It reacts to your volume and processes your request when you let go.

## Privacy

The AI model runs on your computer, and your files, conversations, and memories stay there. These features do send data out, and only when you use them:

| Feature | What is sent, and where |
|---|---|
| Voice input | Audio of what you say, to Google, for transcription |
| Connected Apps | Requests to Composio and the app involved |
| Weather, once you enter a city | The city name, to Open-Meteo |
| News, once you turn it on | Your topic, if any, to Google News |
| Smart home, once connected | Device commands, to the Home Assistant address you enter |
| Web search and research | Search terms to DuckDuckGo or Wikipedia, plus requests to the pages it reads |
| A non-local AI endpoint | Your messages, to that endpoint, if you choose to set one up |

Actions that change something ask you first, and you can adjust that in Settings → Privacy. API keys are encrypted by Windows and never included in backups or logs.

## Build it yourself

You need Node.js and Python 3.

```bash
npm install
```

```bash
pip install -r requirements.txt pyinstaller
```

```bash
npm start
```

```bash
npm run build
```

`npm run build` writes the installer to `dist/`. Pushing a tag such as `v2.0.0` to GitHub runs the same build and publishes it as a release.

## Project layout

| Path | What it holds |
|---|---|
| `main.js`, `preload.js` | Starts the app and limits what the page can reach |
| `renderer.js`, `frontend/` | The interface |
| `backend/ai/` | Model providers, agent loop, tool registry |
| `backend/tools/index.js` | Every action the AI can take. Add an entry to add a capability |
| `backend/` other folders | Apps, browser, computer control, documents, integrations, school, study, research, automations, voice |
| `*.py` | Helpers for voice, speech, and documents, bundled by `nexus_helper.py` |
| `tests/` | `npm test` runs the backend tests. `npm run test:app` drives the real app, and needs Ollama running |

## Security reports

Please report security problems privately through GitHub rather than in a public issue.
