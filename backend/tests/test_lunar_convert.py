import pytest

from app.skills.executors import execute_lunar_convert


@pytest.mark.anyio
async def test_solar_to_lunar_user_original_today():
    # User's session: 17/04/2026 dương = mùng 1 tháng 3 âm, năm Bính Ngọ
    r = await execute_lunar_convert(
        direction="solar_to_lunar", year=2026, month=4, day=17
    )
    src = r["sources"][0]
    assert src["lunar"] == {"year": 2026, "month": 3, "day": 1, "is_leap_month": False}
    assert src["can_chi_year"] == "Bính Ngọ"


@pytest.mark.anyio
async def test_lunar_to_solar_user_original_question():
    # User asked: 30 tháng 4 âm lịch 2026 là ngày mấy dương?
    # Tháng 4 âm 2026 only has 29 days — day 30 doesn't exist.
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=2026, month=4, day=30
    )
    assert r["sources"] == []
    assert "không tồn tại" in r["content"]
    # Fallback should point to the last valid day (29/4 âm = 14/06/2026 dương)
    assert "29" in r["content"]
    assert "14/06/2026" in r["content"]


@pytest.mark.anyio
async def test_lunar_to_solar_last_day_of_lunar_month():
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=2026, month=4, day=29
    )
    src = r["sources"][0]
    assert src["solar"] == {"year": 2026, "month": 6, "day": 14}


@pytest.mark.anyio
async def test_lunar_to_solar_first_day_next_lunar_month():
    # 1/5 âm 2026 = 15/06/2026 dương
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=2026, month=5, day=1
    )
    src = r["sources"][0]
    assert src["solar"] == {"year": 2026, "month": 6, "day": 15}


@pytest.mark.anyio
async def test_tet_2026_is_bing_wu():
    # Tết Bính Ngọ (2026) = 17/02/2026 dương
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=2026, month=1, day=1
    )
    src = r["sources"][0]
    assert src["solar"] == {"year": 2026, "month": 2, "day": 17}
    assert src["can_chi_year"] == "Bính Ngọ"


@pytest.mark.anyio
async def test_tet_2024_is_giap_thin():
    # Tết Giáp Thìn (2024) = 10/02/2024 dương
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=2024, month=1, day=1
    )
    src = r["sources"][0]
    assert src["solar"] == {"year": 2024, "month": 2, "day": 10}
    assert src["can_chi_year"] == "Giáp Thìn"


@pytest.mark.anyio
async def test_tet_2025_is_at_ty():
    # Tết Ất Tỵ (2025) = 29/01/2025 dương
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=2025, month=1, day=1
    )
    src = r["sources"][0]
    assert src["solar"] == {"year": 2025, "month": 1, "day": 29}
    assert src["can_chi_year"] == "Ất Tỵ"


@pytest.mark.anyio
async def test_leap_month_2023():
    # 2023 has leap tháng 2. 1st day of nhuận tháng 2 = 22/03/2023 dương.
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=2023, month=2, day=1, is_leap=True
    )
    src = r["sources"][0]
    assert src["solar"] == {"year": 2023, "month": 3, "day": 22}
    assert src["lunar"]["is_leap_month"] is True


@pytest.mark.anyio
async def test_invalid_lunar_year():
    r = await execute_lunar_convert(
        direction="lunar_to_solar", year=1800, month=1, day=1
    )
    assert r["sources"] == []
    assert "Invalid lunar date" in r["content"]


@pytest.mark.anyio
async def test_invalid_direction():
    r = await execute_lunar_convert(direction="sideways")
    assert r["sources"] == []
    assert "Unknown direction" in r["content"]


@pytest.mark.anyio
async def test_today_returns_valid_structure():
    r = await execute_lunar_convert(direction="today")
    assert r["sources"], "today should always return a source"
    src = r["sources"][0]
    assert "solar" in src and "lunar" in src and "can_chi_year" in src
