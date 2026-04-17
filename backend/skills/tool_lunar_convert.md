---
name: lunar_convert
description: Convert between Vietnamese lunar (âm lịch) and solar (dương lịch) calendars. Use for any âm↔dương conversion, today's lunar date, Tết dates, can-chi year/month/day names, leap months. ALWAYS prefer this over web_search for calendar math — it is deterministic and exact.
type: tool
enabled: true
---

## When to use
- "Hôm nay âm lịch là ngày mấy"
- "Ngày X tháng Y âm lịch rơi vào ngày nào dương lịch" (lunar → solar)
- "Ngày X/Y/Z dương lịch là ngày mấy âm lịch" (solar → lunar)
- Tết Nguyên Đán dates, can-chi year names (Giáp Tý, Ất Sửu, …, Bính Ngọ), leap months
- Any question where the answer requires reading a lunar calendar

Do NOT use web_search for these — it is slow, unreliable, and frequently hallucinates. Use this skill.

## Parameters
- `direction` (required): `"solar_to_lunar"`, `"lunar_to_solar"`, or `"today"`
- `year` (int, required for conversions): Gregorian year for solar input, or lunar year for lunar input. Range 1900–2199.
- `month` (int): 1–12.
- `day` (int): 1–31 (solar) or 1–30 (lunar).
- `is_leap` (bool, lunar→solar only): True if the lunar month is a leap month. Default false.
- `timezone` (string, today only): IANA zone, default `Asia/Ho_Chi_Minh`.

## Response shape
Returns a dict containing solar date, lunar date (with `is_leap`), day-of-week, and can-chi year/month/day. If an invalid lunar date is supplied (e.g. day 30 of a 29-day lunar month), returns a clear error message.

## Instructions
1. Call this skill once with the appropriate `direction`.
2. Use the returned structured fields directly — do not recompute or estimate.
3. If the user asks a conversion where the lunar day doesn't exist, the skill tells you so; relay that fact and offer the last valid day of that lunar month.
