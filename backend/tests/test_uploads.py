import io

import pytest


@pytest.mark.anyio
async def test_upload_image(client):
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00"
        b"\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    response = await client.post(
        "/api/uploads",
        files={"file": ("test.png", io.BytesIO(png_bytes), "image/png")},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["id"].startswith("file-")
    assert data["filename"] == "test.png"
    assert data["file_type"] == "image/png"
    assert data["file_size"] > 0


@pytest.mark.anyio
async def test_upload_unsupported_type(client):
    response = await client.post(
        "/api/uploads",
        files={"file": ("test.exe", io.BytesIO(b"binary"), "application/octet-stream")},
    )
    assert response.status_code == 400


@pytest.mark.anyio
async def test_serve_uploaded_file(client):
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00"
        b"\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00"
        b"\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    upload = await client.post(
        "/api/uploads",
        files={"file": ("test.png", io.BytesIO(png_bytes), "image/png")},
    )
    file_id = upload.json()["id"]

    response = await client.get(f"/api/uploads/{file_id}")
    assert response.status_code == 200
    assert "image/png" in response.headers["content-type"]


@pytest.mark.anyio
async def test_upload_requires_auth(anon_client):
    response = await anon_client.post(
        "/api/uploads",
        files={"file": ("test.png", io.BytesIO(b"fake"), "image/png")},
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_serve_nonexistent_file(client):
    response = await client.get("/api/uploads/file-nonexist")
    assert response.status_code == 404
