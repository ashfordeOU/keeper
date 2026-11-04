# Setup

The first time Keeper opens, a short setup asks what you want it for. Nothing is switched on, read or asked until you press **Continue** on the second screen. **Skip setup** keeps the defaults.

1. **Welcome**: what Keeper is, in four lines.
2. **What do you want Keeper for?** Eight picture cards; pick up to three:

   | Card | Turns on |
   |---|---|
   | Find my files | search, what's inside documents and pictures, where downloads came from, Quick Search |
   | Clean my computer | Clean Up, Duplicates, Space Map, Undo History, the Fix-it List, Startup & Apps, Health |
   | Mail & calendar | Mail, Calendar and reminders, Clock, Planner, the next meeting in the Island |
   | Notes | Notes, Journal, Reader |
   | Record my screen | Capture, Studio, Stage, Draw on screen, the photo editor |
   | Stay focused | the Island's focus timer, Focus Blocking, Time Tracking, Planner |
   | Keep it private | Privacy & Security, malware checks for downloads, Network & firewall, VPN checks, Locked folders |
   | Help a family member | Keeper on your other devices, screens and Help mode |

   Their parts are added to the essentials Keeper picks for this computer (light on battery, nothing heavy on a small machine), and to what it found here (developer tools, an Obsidian vault, an AI on this computer), which you can leave out. With no card picked, you get just the essentials. **Choose each part yourself** opens every part by group; **Everything** and **Files only** are there too. The **Also** boxes: open at login and check for updates (ticked), anonymous usage stats (unticked, with **See what's sent**).
3. **Approvals**: only the system permissions the chosen parts need now.
4. **Connect** (optional): Mail, an AI, your other devices, a cloud drive.
5. **You're set**: one shortcut to remember, search from anywhere.

Your goals are kept (`setupGoals` in the settings). **Set up Keeper again** (Settings → General, or the palette) starts at the second screen with them picked and the parts that are on now; nothing changes until you continue. Modes can read the goals later.

## Getting to know Keeper

For the first week after setup, Home shows one short tip a day under its suggestion line: search from anywhere, the **?** on every page, the Fix-it List, then tips for the goals you picked (snoozing a mail, linking notes, quiet hours…). Each tip has one button to try it and **×** to put it away. **No more tips** ends the series; Settings → General → **Getting to know Keeper** turns it on again.

## For developers

- `core/goals.ts`: the goals, `goalParts(recommended, goals, platform)`, the tips and `tipToday()`. Unit tests in `test/goals.test.ts`.
- `src/setup/FirstRun.tsx`: the screens; `src/screens/Home.tsx`: the tip card.
- The real app on Linux (`test/e2e/firstrun.cjs`): the eight cards, the three-card limit, what gets written, the one-shortcut screen and the first tip on Home.
