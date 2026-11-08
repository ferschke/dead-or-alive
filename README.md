# Dead or Alive

<p align="center">
  <img src="./docs/screenshot.png" alt="Dead or Alive Application Screenshot" width="76%" />
</p>
<p align="center">
  <img src="./docs/map.png" alt="Cast Connections Network" width="56%" />
  &nbsp;&nbsp;
  <img src="./docs/mapdetails.png" alt="Actor Connections Detail" width="36%" />
</p>

**Dead or Alive** is a responsive web application built with **Vite + React + TypeScript** that lets you search for any movie or television series and determines how many of its credited cast members are still alive and lets you explore co-starring networks of the cast.

**Live Application:** [https://ferschke.github.io/dead-or-alive/](https://ferschke.github.io/dead-or-alive/)

---

## Key Features

- **Real-Time Vitality Evaluation**: Accessing any movie or TV show refreshes its data against the configured APIs and evaluates each actor's living status, current age, or age at passing at that exact timestamp.
- **Alive Score & Cast Demographics**: Displays the proportion of living cast members as a percentage, fraction, and decimal ratio alongside a visual split bar and key stats (median living age, youngest and oldest living actors, latest deceased, and youngest and oldest actor at the time of release). Clicking a stat box scrolls to and highlights the cast member it mentions. Each actor card also shows their age at release alongside their current or death age.
- **Interactive Cast Matrix & Roster**:
  - **Cast Vitality Matrix**: A color-coded grid of actor portraits/initials (green for living, copper for deceased) that scrolls to and highlights the selected actor below.
  - **Split & Unified Views**: Browse actors in side-by-side **Still Alive** and **Deceased** columns or a single unified list, with instant search filtering by actor or role and sorting by billing order, age, name, or date of passing.
- **Cast Connections Network**: Maps how cast members of the selected movie or TV show are connected through other productions they appeared in together. Opening the network dialog renders an interactive graph where all cast members appear as nodes and any pair of co-stars with shared external credits is joined by a single line scaled in thickness by the number of shared movies or shows. Clicking any actor node opens a detail dialog listing their connected co-stars and shared titles, each linking directly back to load that movie or show in the app.
- **Persistent Local Cache & Background Sync**: Starts empty and caches every title you search in browser `localStorage`, so it persists across sessions. Cached entries load immediately and automatically sync with the APIs in the background. You can wipe everything with **Clear Cache** in the settings.
- **Wikidata & Optional TMDB Integration**: Works out of the box with public **Wikidata**, **Wikipedia**, and **TVMaze** APIs with no setup required. You can optionally add a free [TMDB API Key](https://developer.themoviedb.org/docs/getting-started) in the settings dialog to enrich titles with more complete movie and TV cast lists, character roles, posters, and biographical dates. Without a TMDB key, a warning notes that movie data and statistics may be incomplete.
- **Actor Lookup**: Look up an actor by name with autosuggest and open their details and filmography.
- **Optional OMDb Ratings**: Add a free [OMDb API Key](https://www.omdbapi.com/apikey.aspx) in the settings to show IMDb, Rotten Tomatoes (Tomatometer) and Metacritic ratings in the movie and show details. The key is optional and used only for ratings; without it no ratings are shown. Ratings are refreshed at most once a day per title, and the settings display how many OMDb requests remain for the day.
- **Responsive Layout**: Designed for desktop browsers with a responsive layout that adapts cleanly to iPhone and Android screens.

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
