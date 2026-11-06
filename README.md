# Dead or Alive — Film & Television Cast Vitality Ledger

A reactive web application built with **Vite + React + TypeScript** that lets you enter the title of any movie or television show and determines how many of its credited actors are still alive at the exact moment your query is submitted.

## Features

- **Query-Time Vitality Calculation**: Records the exact timestamp when a query is submitted and calculates each actor's living status, current age, or age at passing relative to that moment.
- **Overall Alive Score**: Computes and visualizes the fraction of living actors to total actors (`Alive / Total`), percentage (`%`), and decimal ratio (`0.000`), paired with a proportional split bar and demographic summary metrics (median living age, oldest/youngest living cast member, most recently deceased).
- **Visual Cast Overview & Sorted Split View**:
  - **Cast Vitality Matrix**: Interactive portrait grid grouped into living and deceased cast members for immediate visual inspection; clicking any tile scrolls to and highlights the actor's card.
  - **Alive vs. Deceased Split Columns**: Side-by-side columns sorting actors into **Still Alive** and **Deceased** (plus a toggleable Unified Roster view), with sorting by Billing Order, Age, Name, or Date of Passing, role/name filtering, and voice-role toggling.
- **Historical "As-Of Year" Scrubber**: Defaults to the present query submission time, with an interactive timeline slider that lets you scrub back to any year since the work's release to see how the Alive Score evolved over time.
- **Hybrid Data Source**:
  - **Default (Zero-Config)**: Uses live **Wikidata & Wikipedia** public APIs (`wbgetentities`, Wikipedia `pageimages`, and SPARQL fallback) plus a curated archive of iconic films and series.
  - **Optional TMDB API Support**: Click **Wikidata + Wikipedia Live** in the top navigation bar to optionally enter a TMDB v3 API Key or v4 Read Access Token (`VITE_TMDB_API_KEY` or persisted in `localStorage`).

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
