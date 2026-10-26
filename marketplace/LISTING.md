# Africa's Talking Marketplace submission - FieldPass

Copy these into the "Create Your Own Plugin" form.

## Basic info

- **Name:** FieldPass
- **Slug:** `fieldpass`
- **Logo:** `marketplace/logo.png` (512x512)
- **Short description (one line):**
  Turn harvest leftovers into peaceful grazing deals between farmers and herders over USSD, voice, SMS and airtime.

- **Long description:**
  Every dry season in Northern Nigeria, herds move into farmland looking for feed. Cattle enter fields that are not yet harvested, crops are destroyed, and disputes can turn violent. At the same time, harvested fields burn or waste the stalks herders need. The missing piece is information: who has harvested, where, and when.

  FieldPass closes that gap on basic phones:
  - **Farmers (USSD, Hausa/English):** register fields and mark them standing or harvested. They open their stalks to herds for a daily price, a manure swap or free. They confirm a herd left using its 4-digit pass code and report crop damage in a few key presses.
  - **Herders (Voice IVR + USSD + SMS):** call and key in a ward code. They hear how many fields are open, which standing fields to avoid and when the next harvest is due, then press 1 to book. Route alerts arrive by SMS (and optional calls) when a field opens along their usual route.
  - **Mediators (SMS):** the Ardo, village head or ward agricultural officer is alerted the moment damage is reported, with both parties' contacts.
  - **Airtime rewards:** farmers earn airtime for timely harvest updates (which keeps the map honest), and both sides earn airtime when a deal closes with no damage. Abuse controls include one reward per field per season, a minimum field age and a daily cap.
  - **Ward dashboard:** live map of standing, open and booked fields; damage reports; grazing deals; and a full log of every SMS, call and airtime top-up.

  Each LGA, State ADP, cooperative or peace-building NGO deploys its own instance for its own wards.

## Technical details

- **Image:** `<registry>/fieldpass:<tag>` (see README "Build & push")
- **Port:** 3000
- **Database:** none required. Uses embedded SQLite at `/data/fieldpass.db`. Mount a volume at `/data` to keep data across restarts.
- **Git repo:** (your GitHub URL)

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `AT_USERNAME` | yes | Africa's Talking username (`sandbox` for testing) |
| `AT_API_KEY` | yes | Africa's Talking API key. If empty, runs in dry-run mode and only logs messages |
| `AT_SENDER_ID` | no | Alphanumeric sender ID / shortcode for SMS |
| `AT_VOICE_NUMBER` | for voice | Your AT voice number (used for outbound alerts) |
| `USSD_CODE` | yes | Your USSD code, e.g. `*384*1234#`, shown in SMS messages |
| `PUBLIC_URL` | no | Public URL of the instance, used for voice callback URLs |
| `ADMIN_PASSWORD` | recommended | Protects the dashboard, simulator and API |
| `DEFAULT_LANG` | no | `ha` (default) or `en` |
| `WARDS` | no | JSON list of your wards `[{"code","name","lga","lat","lng"}]`. Defaults to sample Kano wards |
| `REWARD_STATUS_UPDATE` | no | NGN airtime for a harvest update (default 50, 0 disables) |
| `REWARD_BOOKING_COMPLETE` | no | NGN airtime to each side for a deal closed with no damage (default 100) |
| `REWARD_DAILY_CAP` | no | Maximum NGN airtime per phone per day (default 300) |
| `REWARD_MIN_FIELD_AGE_DAYS` | no | Days a field must be registered before its harvest update earns airtime (default 3) |
| `VOICE_ALERTS` | no | `true` to also call herders when a field on their route opens |

## Categorization

- **AT products:** USSD, Voice, Bulk SMS, Airtime
- **Industry:** Government (also fits Other: Agriculture)

## Pricing plans

| Plan | Currency | Amount | Frequency | Description |
|---|---|---|---|---|
| Ward Pilot | NGN | 15,000 | Monthly | Up to 10 wards, 500 farmers, dashboard, SMS/voice/airtime flows. Africa's Talking usage is billed to your own AT account. |
| LGA | NGN | 45,000 | Monthly | Unlimited wards in one LGA, unlimited users, mediator alerts and priority support. |
| State Programme | NGN | 400,000 | Yearly | Multiple LGAs for a State Ministry of Agriculture/Livestock, ADP or NGO peace programme. |
