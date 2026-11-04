# Battery Care

**Battery Care** (Computer → Battery Care) stops charging at a limit you choose, so a laptop that is plugged in most of the day keeps its battery healthy for longer. It can also charge to full once for a trip, and pause charging while the battery is warm. The part is called *Battery care* (`chargeLimit`, Settings → Features → Computer) and is off until you switch it on.

## Works with your computer

| | Linux | Windows | macOS |
|---|---|---|---|
| Stop charging at 60, 70, 80 or 90% | ✅ the kernel's own charge thresholds | ↗ the laptop maker's app | ↗ the system (see below) |
| Kept after a restart | ✅ a udev rule | the maker's app keeps it | the system keeps it |
| Full charge for a trip | ✅ | — | — |
| Pause when warm | ✅ where the battery reports its temperature | — | — |

**Linux.** Keeper writes `charge_control_end_threshold` and `charge_control_start_threshold` (or the older `charge_stop_threshold` and `charge_start_threshold`) in `/sys/class/power_supply/BAT*`. Many laptops have them: ThinkPad, ASUS, Framework, Dell, Huawei, LG, MSI, Samsung, System76 and others. Charging starts again 5% below the limit, so the battery does not top up for every percent it loses. Pausing uses `charge_behaviour` (`inhibit-charge`) where the battery has it, and otherwise holds the limit at the current charge.

- **Apply** asks for your administrator password once (pkexec). In the same step Keeper writes `/etc/udev/rules.d/90-keeper-battery-care.rules`, which sets the limit again after a restart (most laptops forget it). *No limit* removes the rule.
- **Let Keeper adjust it by itself** (a tick next to Apply) adds two lines to that rule: the threshold files belong to your group, so a trip charge and pausing while warm work later without a password prompt. Leave it off and only Apply changes the limit.
- A battery without threshold files says so plainly.

**Windows.** Windows has no common interface for a charge limit. Keeper finds your laptop maker's app (Lenovo Vantage, MyASUS, Dell Power Manager or Dell Optimizer, HP Support Assistant, MSI Center, Samsung Settings, Huawei PC Manager, Acer Care Center, LG Control Center, dynabook Settings) in the Start menu and opens it, or opens a Microsoft Store search for it. Surface laptops keep their limit in the firmware (UEFI → Battery Limit), and the page says so.

**macOS.** macOS manages charging itself: Optimised Battery Charging learns when you usually unplug and holds the charge at 80% until then. Some Macs also offer a fixed limit in Battery settings. A fixed limit set by another app would need writes to the Mac's power controller from a helper running as root, through interfaces Apple does not publish. That can harm the battery if it goes wrong and breaks with system updates, so Keeper does not do it (the same line as fan control, docs/MONITOR.md). Battery Care opens Battery settings instead.

## The page

- The charge now, whether it is plugged in, the battery's temperature, and one line about what happens: "Stops charging at 80%", "Full charge until Thu 09:00, then back to 80%" or "Charging paused while the battery is warm (42°C)".
- **Stop charging at**: 60%, 70%, 80%, 90% or No limit, then **Apply**.
- **Full charge for a trip**: charges to 100% until tomorrow at 9:00 (at least 12 hours), then goes back to your limit by itself. Also in the palette: *Charge the Battery to 100% for a Trip*.
- **Pause when warm**: charging waits while the battery is 40°C or warmer (Settings → Battery and speed → Warm means: 35, 40 or 45°C), and starts again once it is 3° cooler, so it does not flip every minute.

## Cost

Nothing while off. On, nothing either, unless a trip charge or pausing while warm is on: then one look a minute at the battery's files (it keeps looking while the screen is locked, since that is when a laptop charges).

## Files

| Part | File |
|---|---|
| Thresholds, write order, udev rule, what to do now, the maker's app | `core/charge-limit.ts` |
| Reading and writing, the schedule | `electron/services/charge-limit.ts` |
| The page | `src/screens/BatteryCare.tsx` |
| Tests | `test/charge-limit.test.ts` (12), `test/e2e/battery-care.cjs` |

## Verified

- **Linux, real app** (`test/e2e/battery-care.cjs` under xvfb, with a stand-in battery in `KEEPER_CHARGE_TEST_ROOT` and a stand-in pkexec): off until switched on; the charge, plugged in and temperature shown; 80% applied under one prompt with the start threshold at 75%; the udev rule written with the group allowed; a trip charge to 100% with no prompt and back on Cancel; charging paused at 44°C and resumed at 35°C; No limit back to 100% with the rule removed; light, dark and 1024×768.
- **Unit tests:** file names old and new, `charge_behaviour`, the write order when raising and lowering, commands built from checked names only, the rule, the plan (trip, heat with its 3° gap), the trip's end, the maker's app.

## Needs a real computer

- Linux laptops: each driver's accepted values (some accept only certain steps; the kernel refuses others and Keeper shows its message).
- Windows: the Start menu names of each maker's app, and opening it.
- macOS: opening Battery settings.
