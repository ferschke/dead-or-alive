# Dead or Alive

![Dead or Alive Application Screenshot](./docs/screenshot.png)

**Dead or Alive** is a responsive web application built with **Vite + React + TypeScript** that lets you search for any movie or television series and determines how many of its credited cast members are still alive at the exact moment your query is evaluated.

**Live Application:** [https://ferschke.github.io/dead-or-alive/](https://ferschke.github.io/dead-or-alive/)

---

## Key Features

- **Real-Time Cast Vitality Calculation**
  - Records the exact query timestamp and evaluates every credited actor's living status, current age, or age at passing relative to that moment (with a **Re-stamp Now** action to re-evaluate at the current instant).
- **Overall Alive Score & Demographic Summary**
  - Computes the fraction of living cast members (`Alive / Total`), percentage (`%`), and decimal ratio (`0.000`), paired with a proportional split bar.
  - Summarizes cast demographics at a glance: **Median & Mean Age (Living Cast)**, **Oldest Living Actor**, **Youngest Living Actor**, and **Most Recently Deceased** (with average age at passing).
- **Visual Cast Overview & Interactive Split Roster**
  - **Cast Vitality Matrix**: Color-coded portrait/initials grid grouping living (green) and deceased (copper) cast members; clicking any tile smoothly scrolls to and highlights that actor's card in the roster below.
  - **Alive vs. Dead Split & Unified Views**: Side-by-side **Still Alive** and **Deceased** columns (or a toggleable **Unified Roster**), with instant filtering by actor name or character role, voice-actor toggling, and sorting by **Billing Order**, **Age (Oldest / Youngest First)**, **Actor Name (A–Z)**, or **Date of Passing (Most Recent / Earliest)**.
- **Historical "As-Of Year" Time Scrubber**
  - Defaults to the present query time, with an interactive timeline slider that lets you scrub back to any year between the title's release year and the present to inspect how the cast vitality score evolved over time.
- **Persistent Local Catalog & Automatic API Sync**
  - Includes a pre-seeded catalog of iconic films and television series and automatically caches every newly queried title in `localStorage` so your catalog persists across browser sessions.
  - **Automatic Post-Load API Check**: Whenever a cached entry is loaded, the app displays it immediately and checks the configured APIs in the background to merge any newly available cast members, biographical dates, or metadata updates.
  - **One-Click Full Catalog Refresh**: Use the **Refresh Catalog** button in the top bar to check all cached titles against the configured APIs and merge any new or updated cast information across your entire catalog.
- **Multi-Source API Integration (Wikidata + Optional TMDB Enrichment)**
  - **Zero-Config Default**: Queries **Wikidata** (`wbgetentities` & SPARQL), **Wikipedia** cast sections and `pageimages`, and **TVMaze** out of the box with no API key required.
  - **Optional TMDB API Key**: Click **Config / TMDB API Key** in the header (or the prompt in the Overall Alive Score panel) to provide a free [TMDB API Key](https://developer.themoviedb.org/docs/getting-started) (v3 API Key or v4 Read Access Token). When configured, additional TMDB movie and TV aggregate cast credits, character roles, posters, portraits, and birth/death dates are automatically merged and cached.
- **Desktop & Mobile Responsive Design**
  - Tailored editorial cinema layout for desktop browsers that automatically adapts to mobile viewports on iPhone and Android devices.

---

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```
