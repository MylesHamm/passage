# Updating the curated war events

This is the procedure for keeping `dist/data/war-events.json` current. An automated routine follows it every six hours. A person can follow it too.

The live collector reads the file from `main` every ten minutes, so a commit to `main` reaches the public page within about fifteen minutes. No site publish is needed. If a commit breaks the rules, the collector keeps serving the last good list. Never rely on that: check before every commit.

## What belongs in the list

The war began on 28 February 2026. The list covers three layers:

- **`shipping`:** attacks on merchant ships, seizures and mines, from the Gulf to the Red Sea, the Gulf of Aden and the Arabian Sea.
- **`missile-drone`:** missile and drone strikes by Iran, the IRGC, the Houthis or their allies, on any target. Targets include Saudi Arabia, the UAE, Israel, Gulf states, US bases and government-held Yemen.
- **`strikes-on-iran-yemen`:** strikes on Iran or on Houthi-held Yemen, by anyone.

Leave out diplomacy, statements, threats and anything without a strike or an attack.

IMO register incidents appear on the map automatically. Add a shipping event from reporting even if IMO lists it, because the page merges the two. Do not copy register text.

## Rules

`npm run check:events` enforces most of these rules. Accuracy comes first: an event you cannot confirm stays out.

1. **Sources:** open every page you cite and confirm the date, place, actor and figures in it. Each event needs at least one HTTPS source that is not Wikipedia.
   - Prefer Reuters, AP or AFP through republishers, labelled like `Al-Monitor (Reuters)`.
   - Al Jazeera, Middle East Eye, BBC, France 24, The National, Times of Israel, Arab News and UN News are also good sources.
   - Label state or party media as such, for example `Saba (Houthi-run)`.
   - Name a wire agency only when the article credits it. A page bylined "By Agencies", or crediting the agency only for a photo, is `Times of Israel (agencies)`, not `(AFP)`.
   - `title` is the article's headline exactly as published. Never rewrite it to fix a figure.
2. **Never** use ACLED data. Never bypass paywalls, logins, CAPTCHAs or bot protection; if a site blocks you, use another source.
3. **Claimed or confirmed:** an event reported by only one side is `"claimed"`, and its summary must contain the word "claim" or "claimed". Use `"confirmed"` when the striking party confirms it or two independent outlets report it.
4. **Location:**
   - Coordinates are those of the named place (city, port, airport or facility), not a guessed impact point. Give four decimals.
   - Ship attacks belong at sea. When the report gives a bearing and distance from a place, for example "about 11 nm west of Bukha", write it into `place` in that form; `node scripts/events/apply-offsets.mjs` then moves the event to that position. When it gives only "off" a place, keep the place's coordinates: the maps draw ship attacks at the nearest water.
   - `precision` is `facility`, `city`, `area` or `sea-area`. Use `sea-area` only when the coordinates are at sea.
5. **Text:**
   - `title`: 90 characters or fewer, plain and factual.
   - `summary`: 240 characters or fewer, plain and attributed. Give figures exactly as the source does, and when sources differ, say who said what.
   - When a headline and its article disagree (for example a headline keeping an earlier toll while the body reports a revised one), report the body's figure and who gave it, and add a source whose reporting states that figure plainly when one exists.
   - Never mention prices, markets or effects.
6. **Dates:** `date` is the day of the strike. `time` is `null` unless a source gives a UTC time as `HH:MMZ`.
7. **Ids:**
   - `YYYY-MM-DD-short-kebab-slug`, unique, and starting with the event date.
   - Each event has exactly these keys, in this order: `id, date, time, layer, type, actor, target, place, country, lat, lon, precision, confidence, title, summary, sources`.
   - Each source has exactly `publisher, title, url, date`.
   - `type` is one of `shipping-attack`, `seizure`, `mine`, `missile`, `drone`, `air-strike` or `naval-strike`.
8. **Duplicates:** before adding an event, search the file for the same date, place and target. If an event already exists, improve it instead of adding another.
9. **Corrections:** when later reporting changes a figure (for example a death toll), update the summary with attribution and add the new source. Give the figures in order, the first claim and who made it, then the later figure and who gave it, and keep claims from one side marked as claims. Order `sources` from earliest to latest reporting. Remove an event only when reliable reporting shows it did not happen, and say so in the commit message.

## Each run

1. Start from the latest `main`: `git checkout main && git pull --ff-only`.
2. Read `dist/data/war-events.json`. Note `reviewedAt` and the newest event dates.
3. Search for events from two days before `reviewedAt` up to now. Search widely:
   - Hormuz, the Gulf, the Red Sea, Bab al-Mandab, the Gulf of Aden
   - Saudi Arabia, the UAE, Qatar, Kuwait, Bahrain, Israel, Iran, Yemen
   - Houthi missile and drone attacks, Saudi-led coalition strikes, US and Israeli strikes
4. Add the events that meet the rules, keeping `events` sorted by date and then by id. Apply any corrections.
5. Set `reviewedAt` to the current UTC time as `YYYY-MM-DDTHH:MM:SSZ`.
6. Run `npm ci` once, then `node scripts/events/apply-offsets.mjs`, then `npm run check:events`. If anything fails, fix the file and run it again. Never commit a failing list. The check also prints "Check …" warnings for recent events whose cited headline gives a casualty figure the title and summary never mention. Open that source and read its body. If the summary already accounts for the figure (a headline covering several incidents, or a body that revises the toll), leave it; otherwise correct the summary.
7. Decide whether to commit:
   - **Commit** when you added or corrected events, or when `reviewedAt` was more than six hours old (a heartbeat, so the page shows the list is still being checked).
   - **Otherwise** change nothing and stop.
8. Commit only `dist/data/war-events.json`:
   - Author it as `Myles Hamm <265132541+MylesHamm@users.noreply.github.com>`.
   - Use the message `Curated events: add N (dates)`, `Curated events: correct …`, or `Curated events: reviewed, nothing new`.
   - End the message with a `Co-Authored-By` line naming the model.
9. Push to `main`. If the push is rejected because `main` moved, pull, re-run `npm run check:events`, and push again.

Do not change any other file. Do not deploy anything.
