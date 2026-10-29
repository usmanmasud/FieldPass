# FieldPass - *Burtali*

**Harvest leftovers become grazing deals, not fights.**

Each dry season in Northern Nigeria, herds move into farmland looking for feed. Cattle wander into fields that haven't been harvested, crops are destroyed, and disputes can turn violent. Meanwhile, already-harvested fields burn or waste the stalks herders need. Herders often had no way of knowing which fields were still standing.

FieldPass works on any phone, with no data, and gives every field a status: **standing** (keep out), **open** (graze here, on the farmer's terms) or **booked** (the herd holds a 4-digit pass code). Built for the AT Open Hackathon, *Agriculture & Food Security*, Kano, 31 Oct 2026.

| Channel | Who | What it does |
|---|---|---|
| **USSD** | Farmers, herders | Register fields, update harvest status, open stalks (free / manure swap / price per day), book fields, confirm the herd left with its pass code, report damage, set route alerts. Hausa and English. |
| **Voice** | Herders | Call, key in a ward code, hear what's open and what to avoid, press 1 to book. The pass code is read out. Optional outbound calls when a field on the herder's route opens. |
| **SMS** | Everyone | Route alerts, booking confirmations with pass codes, harvest reminders, mediator alerts on damage, inbound commands (`FIELDS 101`, `BOOK 7`, `DONE 4821`). |
| **Airtime** | Farmers, herders | Rewards for timely harvest updates and for deals closed with no damage. Capped per field, per season and per day. |
| **Web** | LGA / ADP / NGO | Live ward map, damage reports, deals, message log, mediators and wards. Includes a phone simulator for demos. |

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
cp .env.example .env      # leave AT_API_KEY empty for dry-run
npm start                 # http://localhost:3000
npm test                  # end-to-end season test
```

- `/` shows the landing page and the callback URLs to paste into Africa's Talking
- `/login` signs you in to the admin area with `ADMIN_PASSWORD` (cookie session; no password set = open)
- `/dashboard` is the ward dashboard: KPIs, live map, needs-attention queue, activity feed, fields, deals, damage reports, people, message log and settings (mediators, wards, callback URLs). Light and dark mode.
- `/simulator` has three handsets (farmer, herder, mediator) with a dialer, USSD dialog, voice calls read aloud, and an SMS inbox. **Guided demo** runs the whole season story in Hausa or English with one click.

### Connect Africa's Talking (sandbox)

1. Set `AT_USERNAME=sandbox` and `AT_API_KEY` in `.env`.
2. Expose your local server, e.g. `npx localtunnel --port 3000` or `ngrok http 3000`.
3. In the AT sandbox dashboard:
   - **USSD:** create a channel with callback `https://<url>/ussd`
   - **Voice:** set the callback URL on your number to `https://<url>/voice`
   - **SMS:** set the incoming messages callback to `https://<url>/sms`
4. Open the AT simulator (simulator.africastalking.com) and dial your USSD code.

## Demo script (3 minutes)

1. **Problem (30s):** It's late October. Herds are moving south, but nobody knows which fields are still standing. Every year this ends in crop loss and violence.
2. **Farmer (USSD):** Malam Sani dials the code in Hausa and registers a sorghum field near the river in Dawanau. After harvest, he opens the stalks on a *manure swap* for one week. The screen confirms that herders on this route have been alerted and he'll get N50 airtime.
3. **Herder (SMS + Voice):** Usman's phone receives the alert. He calls, enters ward code `101`, and hears that 1 field is open and 1 is still standing, with which landmark to avoid. He presses 1 and hears the pass code. Both phones receive SMS with the code and each other's numbers.
4. **Close the loop:** The herd leaves. Sani dials, chooses *3*, enters the code and chooses *No damage*. Both receive airtime, and the dashboard counts one more peaceful deal.
5. **When it goes wrong:** Sani reports cattle in a standing crop. The Ardo and the village head get an SMS within seconds, with both parties' contacts. A red ring appears on the map.
6. **Marketplace:** Any LGA, ADP or NGO can deploy its own instance, set `WARDS` and its AT keys, and go live.

## Build & push (marketplace)

```bash
docker build -t fieldpass .
docker run -p 3000:3000 -e SEED_DEMO=true -v fieldpass-data:/data fieldpass

# with the registry credentials from the marketplace submission form:
docker login <AT_REGISTRY>
docker tag fieldpass <AT_REGISTRY>/fieldpass:latest
docker push <AT_REGISTRY>/fieldpass:latest
```

CI (`.github/workflows/ci.yml`) runs the tests and builds the image on every push. It also pushes the image when the `AT_REGISTRY`, `AT_REGISTRY_USER` and `AT_REGISTRY_PASSWORD` secrets are set. The submission form copy, env var table and pricing plans are in [marketplace/LISTING.md](marketplace/LISTING.md), and the logo is `marketplace/logo.png`.

## How it fits together

```
src/
  ussd.js      farmer + herder USSD menus (stateless text parsing, paging)
  voice.js     herder IVR (GetDigits / Say XML)
  sms.js       inbound SMS commands
  services.js  fields, bookings, pass codes, incidents, airtime rewards
  at.js        Africa's Talking REST client (SMS, Airtime, Voice) + message log
  jobs.js      hourly harvest reminders, booking expiry, listing expiry
  i18n.js      Hausa / English strings
  api.js       dashboard JSON API
public/        landing page, dashboard (Leaflet), phone simulator
```

**Notes**
- Ward coordinates in `src/seed/wards.json` are approximate and only used to place pins. Deployers should supply their own wards through `WARDS` or the dashboard.
- Feature phones give no GPS, so fields are located by ward + landmark and drawn around the ward centre.
- Voice prompts use AT text-to-speech in English. Recorded Hausa/Fulfulde prompts (`<Play>`) are the next step.
